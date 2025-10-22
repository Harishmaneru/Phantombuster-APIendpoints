const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const mongoose = require('mongoose');

// Import domain registration function from Namecheap API
const { registerDomainWithNamecheap } = require('../domainManagementAPI/nameCheapDomainApi');

// Import simple file logging system
const fileLogger = require('../loggingSystem/fileLogger');

const getStripeInstance = (isSandbox = false) => {
    if (isSandbox) {
        const stripe = require('stripe')(process.env.STRIPE_SANDBOX_SECRET_KEY);
        console.log(' Using SANDBOX Stripe instance');
        return stripe;
    } else {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        console.log('🚀 Using PRODUCTION Stripe instance');
        return stripe;
    }
};

// Helper function to check if request is sandbox mode
const isSandboxMode = (req) => {
    return req.body.sandbox === true || req.query.sandbox === 'true';
};

// Middleware to parse JSON for all routes except /webhook
router.use((req, res, next) => {
    if (req.originalUrl === '/api/stripe/webhook') {
        next();
    } else {
        express.json()(req, res, next);
    }
});

// Establish MongoDB connection
const connectToMongoDB = async () => {
    try {
        if (mongoose.connection.readyState === 1) {
            console.log('MongoDB already connected');
            return;
        }

        await mongoose.connect(process.env.ONEPGR_MONGO_URI, {
            // useNewUrlParser: true,
            // useUnifiedTopology: true,
            dbName: 'onepgr_apps'
        });
        console.log('Connected to MongoDB onepgr_apps database');
    } catch (error) {
        console.error('MongoDB connection error:', error);
    }
};


const subscriptionSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    customerId: { type: String, required: true },
    subscriptionId: { type: String, required: true },
    status: { type: String, default: 'active' },
    sessionId: { type: String },
    amount: { type: Number },
    currency: { type: String },
    paymentStatus: { type: String },
    planName: { type: String },
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true },
    refundAmount: { type: Number, default: 0 },
    refundDate: { type: Date, default: null },
    defaultPaymentMethodId: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'user_subscriptions' });


const Subscription = mongoose.model('Subscription', subscriptionSchema);

// Customer model for managing users who have cards but no subscriptions yet
const customerSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    customerId: { type: String, required: true },
    app: { type: String, default: 'default' },
    email: { type: String, required: true },
    defaultPaymentMethodId: { type: String, default: null },
    environment: { type: String, enum: ['sandbox', 'production'], default: 'production' },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'customers' });

// Add compound unique index to ensure one customer per userId per environment
customerSchema.index({ userId: 1, environment: 1 }, { unique: true });

const Customer = mongoose.model('Customer', customerSchema);



router.post(
    '/webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
        const sig = req.headers['stripe-signature'];
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        // Log raw webhook data for debugging
        console.log('[stripeRoutes.js] Raw webhook data:', req.body.toString());

        let event;
        try {
            event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
            console.log(
                '[stripeRoutes.js] Webhook verified:',
                event.id,
                event.type
            );
            console.log(
                '[stripeRoutes.js] Webhook event data:',
                JSON.stringify(event.data.object, null, 2)
            );
        } catch (err) {
            console.error(
                '[stripeRoutes.js] Webhook signature verification failed:',
                err.message
            );
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        try {
            switch (event.type) {
                case 'invoice.created': {
                    const invoice = event.data.object;

                    // Check if this is for a domain purchase (not subscription)
                    if (!invoice.subscription && invoice.metadata?.purchaseType === 'domain') {
                        console.log('[stripeRoutes.js] Domain purchase invoice created:', invoice.id);

                    }
                    break;
                }

                case 'checkout.session.completed': {
                    const session = event.data.object;
                    const {
                        customer,
                        subscription: subscriptionId,
                        metadata,
                        id: sessionId,
                        payment_status,
                        amount_total,
                        currency,
                        invoice // This will now contain the invoice ID for domain purchases
                    } = session;
                    const userId = metadata?.userId || 'unknown';
                    const subscriptionStatus = session.status || 'active';

                    await connectToMongoDB();

                    // Skip one-time payments (domain purchases are handled in /domain/process-success-payment endpoint)
                    if (!subscriptionId) {
                        console.log('[checkout.session.completed] One-time payment detected (non-domain)');
                        break;
                    }
                    // Retrieve full subscription object
                    let stripeSubscription;
                    try {
                        stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
                    } catch (subscriptionError) {
                        console.error(`[stripeRoutes.js] Failed to retrieve subscription ${subscriptionId}:`, subscriptionError.message);
                        break;
                    }

                    // Compute current period dates
                    const startUnix = stripeSubscription.current_period_start || stripeSubscription.start_date;
                    const endUnix = stripeSubscription.current_period_end;

                    const currentPeriodStartFormatted = new Date(startUnix * 1000);
                    const currentPeriodEndFormatted = new Date(endUnix * 1000);

                    const price = stripeSubscription.items.data[0]?.price;
                    const product = price && (await stripe.products.retrieve(price.product));
                    const planName = (product && product.name) || price.nickname || 'Unknown Plan';

                    const subscriptionData = {
                        userId,
                        customerId: customer,
                        subscriptionId,
                        status: subscriptionStatus,
                        sessionId,
                        amount: amount_total / 100,
                        currency,
                        paymentStatus: payment_status,
                        planName,
                        currentPeriodStart: currentPeriodStartFormatted,
                        currentPeriodEnd: currentPeriodEndFormatted,
                        billingCycleAnchor: stripeSubscription.billing_cycle_anchor
                            ? new Date(stripeSubscription.billing_cycle_anchor * 1000).toLocaleString('en-US')
                            : null,
                        created: new Date(stripeSubscription.created * 1000).toLocaleString('en-US'),
                        trialStart: stripeSubscription.trial_start
                            ? new Date(stripeSubscription.trial_start * 1000).toLocaleString('en-US')
                            : null,
                        trialEnd: stripeSubscription.trial_end
                            ? new Date(stripeSubscription.trial_end * 1000).toLocaleString('en-US')
                            : null,
                        planId: price?.id || null,
                        productId: price?.product || null,
                        interval: price?.recurring?.interval || null,
                        intervalCount: price?.recurring?.interval_count || null,
                        lastInvoice: stripeSubscription.latest_invoice || null,
                        metadata: stripeSubscription.metadata
                    };

                    // ✅ Upsert subscription record
                    try {
                        await Subscription.updateOne(
                            { subscriptionId },
                            { $set: subscriptionData },
                            { upsert: true }
                        );
                        console.log(`[stripeRoutes.js] Subscription upserted for user ${userId}`);
                    } catch (dbError) {
                        console.error('[stripeRoutes.js] Database save error:', dbError);
                    }

                    // ✅ Create or update customer record for subscription purchases
                    try {
                        if (customer && userId && userId !== 'unknown') {
                            // Get customer details from Stripe
                            const stripeCustomer = await stripe.customers.retrieve(customer);

                            // Determine environment from customer metadata or webhook source
                            const environment = stripeCustomer.metadata?.environment ||
                                (stripeCustomer.id.startsWith('cus_') ? 'production' : 'sandbox');

                            await Customer.updateOne(
                                { userId, environment },
                                {
                                    $set: {
                                        customerId: customer,
                                        app: metadata?.app || 'default',
                                        email: stripeCustomer.email || null,
                                        environment: environment,
                                        updatedAt: new Date()
                                    }
                                },
                                { upsert: true }
                            );
                            console.log(`[stripeRoutes.js] Customer record created/updated for subscription user ${userId} in ${environment} environment`);
                        }
                    } catch (customerError) {
                        console.error('[stripeRoutes.js] Customer record creation error:', customerError);
                    }
                    break;
                }

                case 'customer.created': {
                    const customer = event.data.object;
                    await connectToMongoDB();

                    // Extract userId from metadata if available
                    const userId = customer.metadata?.userId;
                    const app = customer.metadata?.app || 'default';
                    const createdVia = customer.metadata?.createdVia;

                    // Determine environment from customer metadata
                    const environment = customer.metadata?.environment ||
                        (customer.id.startsWith('cus_') ? 'production' : 'sandbox');

                    if (userId) {
                        try {
                            await Customer.updateOne(
                                { userId, environment },
                                {
                                    $set: {
                                        customerId: customer.id,
                                        app: app,
                                        email: customer.email || null,
                                        environment: environment,
                                        createdAt: new Date()
                                    }
                                },
                                { upsert: true }
                            );
                            console.log(`[stripeRoutes.js] Customer record created for user ${userId} via ${createdVia || 'unknown'} in ${environment} environment`);
                        } catch (dbError) {
                            console.error('[stripeRoutes.js] Customer record creation error:', dbError);
                        }
                    } else {
                        console.log(`[stripeRoutes.js] Customer created without userId in metadata: ${customer.id}`);
                    }
                    break;
                }

                case 'invoice.payment_succeeded': {
                    const invoice = event.data.object;
                    const subscriptionId = invoice.subscription;

                    if (subscriptionId) {
                        await connectToMongoDB();

                        // Retrieve subscription with metadata
                        const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
                            expand: ['items.data.price.product'],
                        });
                        const currentPriceId = subscription.items.data[0]?.price?.id;
                        const appFromMetadata = subscription.metadata?.app;

                        // Define your combo and $4 plan price IDs
                        const COMBO_MONTHLY_PRICE_ID = process.env.STRIPE_COMBO_MONTHLY; // $19
                        const EMAIL_MONTHLY_PRICE_ID = process.env.STRIPE_EMAIL_MONTHLY; // $4

                        const COMBO_YEARLY_PRICE_ID = process.env.STRIPE_COMBO_YEARLY; // $55
                        const EMAIL_YEARLY_PRICE_ID = process.env.STRIPE_EMAIL_YEARLY; // $40

                        if (appFromMetadata === "kampaignai") {
                            // monthly downgrade
                            if (currentPriceId === COMBO_MONTHLY_PRICE_ID) {
                                await stripe.subscriptions.update(subscriptionId, {
                                    items: [{ id: subscription.items.data[0].id, price: EMAIL_MONTHLY_PRICE_ID }],
                                    billing_cycle_anchor: 'unchanged',
                                    proration_behavior: 'none',
                                });
                            }

                            // yearly downgrade
                            if (currentPriceId === COMBO_YEARLY_PRICE_ID) {
                                await stripe.subscriptions.update(subscriptionId, {
                                    items: [{ id: subscription.items.data[0].id, price: EMAIL_YEARLY_PRICE_ID }],
                                    billing_cycle_anchor: 'unchanged',
                                    proration_behavior: 'none',
                                });
                            }
                        }


                        // Your existing DB update logic (unaffected)
                        const lineItem = invoice.lines.data[0];
                        let startUnix = lineItem?.period?.start;
                        let endUnix = lineItem?.period?.end;
                        const currentPeriodStartFormatted = startUnix
                            ? new Date(startUnix * 1000).toLocaleString('en-US')
                            : new Date().toLocaleString('en-US');
                        const currentPeriodEndFormatted = endUnix
                            ? new Date(endUnix * 1000).toLocaleString('en-US')
                            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleString('en-US');

                        await Subscription.updateOne(
                            { subscriptionId },
                            {
                                paymentStatus: 'paid',
                                currentPeriodStart: currentPeriodStartFormatted,
                                currentPeriodEnd: currentPeriodEndFormatted,
                                lastInvoice: invoice.id,
                                hostedInvoiceUrl: invoice.hosted_invoice_url,
                            }
                        );

                        console.log(`[stripeRoutes.js] Updated subscription ${subscriptionId} for paid invoice`);
                    }
                    break;
                }


                case 'customer.subscription.deleted': {
                    const subscription = event.data.object;
                    try {
                        await connectToMongoDB();
                        await Subscription.updateOne(
                            { subscriptionId: subscription.id },
                            { status: 'canceled' }
                        );
                        console.log(`[stripeRoutes.js] Marked subscription ${subscription.id} as canceled`);
                    } catch (dbError) {
                        console.error('[stripeRoutes.js] Database update error:', dbError);
                    }
                    break;
                }
                case 'charge.refunded': {
                    const charge = event.data.object;
                    const refund = charge.refunds?.data?.[0];
                    if (refund && charge.invoice) {
                        await connectToMongoDB();
                        const invoice = await stripe.invoices.retrieve(charge.invoice);
                        const subscriptionId = invoice.subscription;
                        if (subscriptionId) {
                            await Subscription.updateOne(
                                { subscriptionId },
                                {
                                    $set: {
                                        paymentStatus: 'refunded',
                                        refundAmount: refund.amount / 100,
                                        refundDate: new Date(refund.created * 1000),
                                        refundReason: refund.reason || null
                                    }
                                }
                            );

                            console.log(`[stripeRoutes.js] Refund recorded for subscription ${subscriptionId}`);
                        }
                    }
                    break;
                }

                case 'customer.subscription.created': {
                    const subscription = event.data.object;
                    await connectToMongoDB();

                    const price = subscription.items.data[0]?.price;
                    const product = price && (await stripe.products.retrieve(price.product));
                    const planName = (product && product.name) || price.nickname || 'Unknown Plan';

                    const subscriptionData = {
                        userId: subscription.metadata?.userId || 'unknown',
                        customerId: subscription.customer,
                        subscriptionId: subscription.id,
                        status: subscription.status,
                        amount: price?.unit_amount ? price.unit_amount / 100 : null,
                        currency: price?.currency,
                        planName,
                        currentPeriodStart: new Date(subscription.current_period_start * 1000).toLocaleString('en-US'),
                        currentPeriodEnd: new Date(subscription.current_period_end * 1000).toLocaleString('en-US'),
                        planId: price?.id || null,
                        productId: price?.product || null,
                        interval: price?.recurring?.interval || null,
                        intervalCount: price?.recurring?.interval_count || null,
                        created: new Date(subscription.created * 1000).toLocaleString('en-US'),
                        trialStart: subscription.trial_start ? new Date(subscription.trial_start * 1000).toLocaleString('en-US') : null,
                        trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000).toLocaleString('en-US') : null,
                        metadata: subscription.metadata
                    };

                    await Subscription.updateOne(
                        { subscriptionId: subscription.id },
                        { $set: subscriptionData },
                        { upsert: true }
                    );

                    console.log(`[stripeRoutes.js] Subscription created: ${subscription.id}`);
                    break;
                }

                case 'customer.subscription.updated': {
                    const subscription = event.data.object;
                    await connectToMongoDB();

                    const price = subscription.items.data[0]?.price;
                    const product = price && (await stripe.products.retrieve(price.product));
                    const planName = (product && product.name) || price.nickname || 'Unknown Plan';

                    const updateData = {
                        status: subscription.status,
                        currentPeriodStart: new Date(subscription.current_period_start * 1000).toLocaleString('en-US'),
                        currentPeriodEnd: new Date(subscription.current_period_end * 1000).toLocaleString('en-US'),
                        planName,
                        planId: price?.id || null,
                        productId: price?.product || null,
                        interval: price?.recurring?.interval || null,
                        intervalCount: price?.recurring?.interval_count || null,
                        trialStart: subscription.trial_start ? new Date(subscription.trial_start * 1000).toLocaleString('en-US') : null,
                        trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000).toLocaleString('en-US') : null,
                        metadata: subscription.metadata
                    };

                    await Subscription.updateOne(
                        { subscriptionId: subscription.id },
                        { $set: updateData },
                        { upsert: true }
                    );

                    console.log(`[stripeRoutes.js] Subscription updated: ${subscription.id}`);
                    break;
                }

                default: {
                    console.log(`[stripeRoutes.js] Unhandled event type: ${event.type}`);
                }
            }

            res.json({ received: true, message: 'Webhook processed successfully' });
        } catch (error) {
            console.error('[stripeRoutes.js] Webhook Error:', error.message);
            res.status(500).json({ error: error.message });
        }
    }
);

router.post('/create-payment-intent', async (req, res) => {
    try {
        const {
            userId,
            domainName,
            unitPrice,
            currency,
            // Contact information for registration
            firstName,
            lastName,
            email,
            phone,
            address1,
            address2 = '',
            city,
            stateProvince,
            country,
            postalCode,
            years = '1',
            enablePrivacy = false,
            // quantity = 1
        } = req.body;

        console.log('Domain payment intent request received:', {
            userId: userId,
            domainName: domainName,
            unitPrice: unitPrice,
            currency: currency,
            hasContactInfo: !!(firstName && lastName && email),
            timestamp: new Date().toISOString()
        });

        // Validate inputs
        if (!userId || !domainName || !unitPrice) {
            return res.status(400).json({ error: 'userId, domainName, and unitPrice are required' });
        }

        // Validate contact information
        if (!firstName || !lastName || !email || !phone || !address1 || !city || !stateProvince || !country || !postalCode) {
            return res.status(400).json({
                error: 'Complete contact information is required for domain registration',
                required: ['firstName', 'lastName', 'email', 'phone', 'address1', 'city', 'stateProvince', 'country', 'postalCode']
            });
        }

        const price = Number(unitPrice);
        if (isNaN(price) || price <= 0) {
            return res.status(400).json({ error: 'Invalid price amount' });
        }

        // Store all metadata (including contact info)
        const metadata = {
            userId,
            domainName,
            purchaseType: 'domain',
            years: years.toString(),
            enablePrivacy: enablePrivacy.toString(),
            // Contact information
            firstName,
            lastName,
            email,
            phone,
            address1,
            address2,
            city,
            stateProvince,
            country,
            postalCode
        };

        // Determine sandbox mode and get appropriate Stripe instance
        const isSandbox = isSandboxMode(req);
        const stripe = getStripeInstance(isSandbox);

        // Check for existing customer in database by userId and environment, create new one if not found
        let customer;
        try {
            await connectToMongoDB();
            const environment = isSandbox ? 'sandbox' : 'production';

            // First check for customer with environment field
            let existingCustomerRecord = await Customer.findOne({ userId, environment });

            // If not found, check for legacy customer without environment field
            if (!existingCustomerRecord) {
                const legacyCustomer = await Customer.findOne({ userId, environment: { $exists: false } });
                if (legacyCustomer) {
                    console.log(`🔄 Found legacy customer record for user ${userId}, migrating to ${environment} environment`);
                    // Update the legacy record to include environment
                    await Customer.updateOne(
                        { _id: legacyCustomer._id },
                        { $set: { environment: environment } }
                    );
                    existingCustomerRecord = { ...legacyCustomer, environment: environment };
                }
            }

            if (existingCustomerRecord && existingCustomerRecord.customerId) {
                // User has existing customer record, verify it still exists in Stripe
                try {
                    customer = await stripe.customers.retrieve(existingCustomerRecord.customerId);
                    console.log(`✅ Reusing existing customer ${customer.id} for userId ${userId}`);

                    // Update customer metadata and address if needed
                    await stripe.customers.update(customer.id, {
                        metadata: {
                            ...customer.metadata,
                            userId: userId,
                            lastDomainPurchase: domainName,
                            lastUpdated: new Date().toISOString()
                        },
                        address: {
                            line1: address1,
                            line2: address2,
                            city: city,
                            state: stateProvince,
                            postal_code: postalCode,
                            country: country
                        }
                    });
                } catch (stripeError) {
                    console.log(`⚠️ Existing customer ${existingCustomerRecord.customerId} not found in Stripe, will create new one`);
                    // Customer doesn't exist in Stripe anymore, will create new one below
                }
            }

            // If no existing customer found, create new one
            if (!customer) {
                customer = await stripe.customers.create({
                    email: email,
                    name: `${firstName} ${lastName}`,
                    phone: phone,
                    metadata: {
                        userId: userId,
                        domainName: domainName,
                        createdAt: new Date().toISOString()
                    },
                    address: {
                        line1: address1,
                        line2: address2,
                        city: city,
                        state: stateProvince,
                        postal_code: postalCode,
                        country: country
                    }
                });
                console.log(`🆕 Created new customer ${customer.id} for email ${email}`);

                // Create customer record in our database
                const environment = isSandbox ? 'sandbox' : 'production';
                await Customer.create({
                    userId: userId,
                    customerId: customer.id,
                    app: 'default',
                    email: email,
                    environment: environment,
                    createdAt: new Date()
                });
            }
        } catch (error) {
            console.error('Error handling customer creation/lookup:', error);
            return res.status(500).json({ error: 'Failed to process customer information' });
        }

        // Create Checkout Session WITH invoice creation
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            line_items: [{
                price_data: {
                    currency: currency || 'usd',
                    product_data: {
                        name: 'Domain Registration Service',
                        description: `Registration for ${domainName}`,
                        metadata: {
                            type: 'domain_service',
                            actualDomain: domainName,
                            userId: userId
                        }
                    },
                    unit_amount: Math.round(price * 100),
                },
                quantity: 1
            }],
            success_url: 'https://kampaign.onepgr.com/domain-success?session_id={CHECKOUT_SESSION_ID}',
            cancel_url: 'https://kampaign.onepgr.com/cancel',
            metadata: metadata,
            customer: customer.id, // Use the created customer
            invoice_creation: {
                enabled: true, // This enables invoice generation
                invoice_data: {
                    metadata: metadata,
                    footer: `Thank you for registering ${domainName}`,
                    custom_fields: [
                        {
                            name: 'Domain Name',
                            value: domainName
                        },
                        {
                            name: 'Registration Period',
                            value: `${years} year(s)`
                        }
                    ]
                }
            }
        });

        // Log the domain purchase initiation
        try {
            fileLogger.logDomainPurchase({
                userId: userId,
                userEmail: email,
                domainName: domainName,
                amount: price,
                currency: currency || 'usd',
                status: 'pending',
                stripeSessionId: session.id,
                stripeCustomerId: customer.id, // Store customer ID
                registrationYears: parseInt(years),
                enablePrivacy: enablePrivacy,
                contactInfo: {
                    firstName,
                    lastName,
                    email,
                    phone,
                    address1,
                    address2,
                    city,
                    stateProvince,
                    country,
                    postalCode
                },
                ipAddress: req.ip,
                userAgent: req.get('User-Agent'),
                apiEndpoint: '/create-payment-intent',
                requestMethod: 'POST',
                metadata: {
                    years: years.toString(),
                    enablePrivacy: enablePrivacy.toString()
                }
            });
        } catch (logError) {
            console.error('Error logging domain purchase initiation:', logError);
            // Don't fail the request if logging fails
        }

        res.json({
            url: session.url,
            sessionId: session.id

        });

    } catch (err) {
        console.error("Stripe error:", err);
        res.status(500).json({ error: "Payment failed. Please try again." });
    }
});

router.post('/create-checkout-session', async (req, res) => {
    try {
        const { userId, priceId } = req.body;

        // Determine success URL based on environment
        let successUrl;

        if (process.env.NODE_ENV === 'production') {
            // Use PRODUCTION_SUCCESS_URL, falling back to record.onepgr.com if unset
            successUrl = process.env.PRODUCTION_SUCCESS_URL
                ?? 'https://record.onepgr.com/success?session_id={CHECKOUT_SESSION_ID}';
        }
        else if (process.env.NODE_ENV === 'development' && process.env.IS_VERCEL_DEPLOYMENT === 'true') {
            successUrl = 'http://localhost:4200/success?session_id={CHECKOUT_SESSION_ID}';
        }
        else {
            successUrl = 'http://localhost:4200/success?session_id={CHECKOUT_SESSION_ID}';
        }


        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: successUrl,
            cancel_url: 'https://record.onepgr.com/pricing',
            metadata: { userId }
        });

        res.json({ url: session.url });
    } catch (err) {
        console.error("Stripe error:", {
            statusCode: err.statusCode,
            code: err.code,
            message: err.message,
            request_log_url: err.request_log_url
        });
        // send both HTTP status and the raw message back
        return res
            .status(err.statusCode || 500)
            .json({ error: err.message });
    }
});


router.post('/domain/create-checkout-session', async (req, res) => {
    try {
        const {
            userId,
            domainName,
            unitPrice,
            currency,
            // Contact information for registration
            firstName,
            lastName,
            email,
            phone,
            address1,
            address2 = '',
            city,
            stateProvince,
            country,
            postalCode,
            years = '1',
            enablePrivacy = false
        } = req.body;

        const isSandbox = isSandboxMode(req);
        const stripe = getStripeInstance(isSandbox);

        console.log('Domain checkout request received:', {
            userId: userId,
            domainName: domainName,
            unitPrice: unitPrice,
            currency: currency,
            hasContactInfo: !!(firstName && lastName && email),
            timestamp: new Date().toISOString()
        });

        // Validate inputs
        if (!userId || !domainName || !unitPrice) {
            return res.status(400).json({ error: 'userId, domainName, and unitPrice are required' });
        }

        // Validate contact information
        if (!firstName || !lastName || !email || !phone || !address1 || !city || !stateProvince || !country || !postalCode) {
            return res.status(400).json({
                error: 'Complete contact information is required for domain registration',
                required: ['firstName', 'lastName', 'email', 'phone', 'address1', 'city', 'stateProvince', 'country', 'postalCode']
            });
        }

        const price = Number(unitPrice);
        if (isNaN(price) || price <= 0) {
            return res.status(400).json({ error: 'Invalid price amount' });
        }

        // Create a dynamic product for this domain
        const product = await stripe.products.create({
            name: `Domain: ${domainName}`,
            description: `Registration for ${domainName}`,
            metadata: { type: 'domain', userId, domainName }
        });

        // Store contact information in metadata
        const metadata = {
            userId,
            domainName,
            purchaseType: 'domain',
            years: years.toString(),
            enablePrivacy: enablePrivacy.toString(),
            // Contact information
            firstName,
            lastName,
            email,
            phone,
            address1,
            address2,
            city,
            stateProvince,
            country,
            postalCode
        };

        // Create a customer first (required for invoices)
        const customer = await stripe.customers.create({
            email: email,
            name: `${firstName} ${lastName}`,
            phone: phone,
            metadata: {
                userId: userId,
                domainName: domainName
            },
            address: {
                line1: address1,
                line2: address2,
                city: city,
                state: stateProvince,
                postal_code: postalCode,
                country: country
            }
        });

        // Stripe Checkout Session WITH invoice creation
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            line_items: [{
                price_data: {
                    currency: currency || 'usd',
                    product_data: {  // Embed product data directly
                        name: `Domain: ${domainName}`,
                        description: `Registration for ${domainName}`,
                        metadata: { type: 'domain', userId, domainName }
                    },
                    unit_amount: Math.round(price * 100),
                },
                quantity: 1,
            }],
            success_url: 'https://kampaign.onepgr.com//domain-success?session_id={CHECKOUT_SESSION_ID}',
            cancel_url: 'https://kampaign.onepgr.com//cancel',
            metadata: metadata,
            customer: customer.id, // Use the created customer
            invoice_creation: {
                enabled: true, // This enables invoice generation
                invoice_data: {
                    metadata: metadata,
                    footer: `Thank you for registering ${domainName}`,
                    custom_fields: [
                        {
                            name: 'Domain Name',
                            value: domainName
                        },
                        {
                            name: 'Registration Period',
                            value: `${years} year(s)`
                        }
                    ]
                }
            }
        });

        // Log the domain purchase initiation
        try {
            fileLogger.logDomainPurchase({
                userId: userId,
                userEmail: email,
                domainName: domainName,
                amount: price,
                currency: currency || 'usd',
                status: 'pending',
                stripeSessionId: session.id,
                stripeCustomerId: customer.id, // Store customer ID
                registrationYears: parseInt(years),
                enablePrivacy: enablePrivacy,
                contactInfo: {
                    firstName,
                    lastName,
                    email,
                    phone,
                    address1,
                    address2,
                    city,
                    stateProvince,
                    country,
                    postalCode
                },
                ipAddress: req.ip,
                userAgent: req.get('User-Agent'),
                apiEndpoint: '/domain/create-checkout-session',
                requestMethod: 'POST',
                metadata: {
                    productId: product.id,
                    years: years.toString(),
                    enablePrivacy: enablePrivacy.toString()
                }
            });
        } catch (logError) {
            console.error('Error logging domain purchase initiation:', logError);
            // Don't fail the request if logging fails
        }

        res.json({
            url: session.url,
            sessionId: session.id
        });

    } catch (err) {
        console.error("Stripe error:", err);
        res.status(500).json({ error: "Payment failed. Please try again." });
    }
});

// Get Subscription Details from Checkout Session ID
router.post('/get-subscription-from-session', async (req, res) => {
    const { sessionId } = req.body;
    const isSandbox = isSandboxMode(req);
    const stripe = getStripeInstance(isSandbox);

    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }

    try {
        console.log('[get-subscription-from-session] Retrieving session:', sessionId, 'Sandbox:', isSandbox);

        // Retrieve the session with expanded subscription data
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['subscription', 'customer', 'line_items']
        });

        console.log('[get-subscription-from-session] Session retrieved:', {
            id: session.id,
            status: session.status,
            payment_status: session.payment_status,
            mode: session.mode,
            hasSubscription: !!session.subscription,
            subscriptionId: session.subscription?.id || null,
            metadata: session.metadata
        });

        // Check if this is a subscription or one-time payment
        if (session.mode === 'payment') {
            // This is a one-time payment (like domain purchase)
            console.log('[get-subscription-from-session] One-time payment detected');

            // Check if this is a domain purchase
            const isDomainPurchase = session.metadata?.purchaseType === 'domain' ||
                session.metadata?.purchaseType === 'domain_registration';

            if (isDomainPurchase) {
                // Return structured domain purchase information
                return res.status(200).json({
                    sessionType: 'domain-purchase',
                    session: {
                        id: session.id,
                        status: session.status,
                        paymentStatus: session.payment_status,
                        amount: session.amount_total ? session.amount_total / 100 : null,
                        currency: session.currency,
                        createdAt: new Date(session.created * 1000).toISOString()
                    },
                    domain: {
                        name: session.metadata.domainName,
                        purchaseType: session.metadata.purchaseType,
                        years: session.metadata.years,
                        enablePrivacy: session.metadata.enablePrivacy === 'true',
                        unitPrice: parseFloat(session.metadata.unitPrice) || null
                    },
                    customer: {
                        firstName: session.metadata.firstName,
                        lastName: session.metadata.lastName,
                        email: session.metadata.email,
                        phone: session.metadata.phone,
                        address: {
                            address1: session.metadata.address1,
                            address2: session.metadata.address2 || '',
                            city: session.metadata.city,
                            stateProvince: session.metadata.stateProvince,
                            country: session.metadata.country,
                            postalCode: session.metadata.postalCode
                        }
                    },
                    userId: session.metadata.userId,
                    message: 'This is a domain purchase.'
                });

                // Log the domain purchase response
                try {
                    fileLogger.logDomainPurchase({
                        userId: session.metadata.userId || 'unknown',
                        userEmail: session.metadata.email || 'unknown',
                        domainName: session.metadata.domainName,
                        amount: session.amount_total ? session.amount_total / 100 : null,
                        currency: session.currency || 'usd',
                        status: 'completed',
                        stripeSessionId: session.id,
                        paymentIntentId: session.payment_intent || null,
                        customerId: typeof session.customer === 'object' ? session.customer.id : session.customer,
                        registrationYears: session.metadata.years,
                        enablePrivacy: session.metadata.enablePrivacy === 'true',
                        contactInfo: {
                            firstName: session.metadata.firstName,
                            lastName: session.metadata.lastName,
                            email: session.metadata.email,
                            phone: session.metadata.phone,
                            address: {
                                address1: session.metadata.address1,
                                address2: session.metadata.address2 || '',
                                city: session.metadata.city,
                                stateProvince: session.metadata.stateProvince,
                                country: session.metadata.country,
                                postalCode: session.metadata.postalCode
                            }
                        },
                        ipAddress: req.ip || req.connection.remoteAddress,
                        userAgent: req.get('User-Agent'),
                        apiEndpoint: '/get-subscription-from-session',
                        requestMethod: 'POST',
                        metadata: {
                            sessionType: 'domain-purchase',
                            purchaseType: session.metadata.purchaseType,
                            unitPrice: session.metadata.unitPrice
                        }
                    });
                } catch (logError) {
                    console.error('[get-subscription-from-session] Error logging domain purchase data:', logError);
                }
            } else {
                // Generic one-time payment
                // Log the one-time payment response
                try {
                    fileLogger.logSubscriptionPayment({
                        userId: session.metadata?.userId || 'unknown',
                        userEmail: session.metadata?.email || 'unknown',
                        amount: session.amount_total ? session.amount_total / 100 : null,
                        currency: session.currency || 'usd',
                        status: 'completed',
                        stripeSessionId: session.id,
                        paymentIntentId: session.payment_intent || null,
                        customerId: typeof session.customer === 'object' ? session.customer.id : session.customer,
                        ipAddress: req.ip || req.connection.remoteAddress,
                        userAgent: req.get('User-Agent'),
                        apiEndpoint: '/get-subscription-from-session',
                        requestMethod: 'POST',
                        metadata: {
                            sessionType: 'one-time-payment',
                            paymentStatus: session.payment_status,
                            sessionStatus: session.status
                        }
                    });
                } catch (logError) {
                    console.error('[get-subscription-from-session] Error logging one-time payment data:', logError);
                }

                return res.status(400).json({
                    error: 'This session is for a one-time payment, not a subscription',
                    sessionType: 'one-time-payment',
                    sessionData: {
                        id: session.id,
                        status: session.status,
                        paymentStatus: session.payment_status,
                        amount: session.amount_total ? session.amount_total / 100 : null,
                        currency: session.currency,
                        metadata: session.metadata
                    }
                });
            }
        }

        if (!session.subscription) {
            console.log('[get-subscription-from-session] No subscription found in session');

            // Log the no subscription found response
            try {
                fileLogger.logFailedPayment({
                    userId: session.metadata?.userId || 'unknown',
                    userEmail: session.metadata?.email || 'unknown',
                    amount: session.amount_total ? session.amount_total / 100 : null,
                    currency: session.currency || 'usd',
                    status: 'failed',
                    stripeSessionId: session.id,
                    paymentIntentId: session.payment_intent || null,
                    customerId: typeof session.customer === 'object' ? session.customer.id : session.customer,
                    errorMessage: 'No subscription found in this session',
                    errorCode: 'NO_SUBSCRIPTION',
                    ipAddress: req.ip || req.connection.remoteAddress,
                    userAgent: req.get('User-Agent'),
                    apiEndpoint: '/get-subscription-from-session',
                    requestMethod: 'POST',
                    metadata: {
                        sessionType: 'no-subscription',
                        sessionStatus: session.status,
                        paymentStatus: session.payment_status,
                        mode: session.mode
                    }
                });
            } catch (logError) {
                console.error('[get-subscription-from-session] Error logging no subscription data:', logError);
            }

            return res.status(404).json({
                error: 'No subscription found in this session',
                sessionData: {
                    id: session.id,
                    status: session.status,
                    paymentStatus: session.payment_status,
                    mode: session.mode,
                    metadata: session.metadata
                }
            });
        }

        console.log('[get-subscription-from-session] Retrieving subscription:', session.subscription.id);

        // Retrieve the subscription with expanded price and product data
        const subscription = await stripe.subscriptions.retrieve(session.subscription.id, {
            expand: ['items.data.price.product', 'customer']
        });

        console.log('[get-subscription-from-session] Subscription retrieved:', {
            id: subscription.id,
            status: subscription.status,
            hasItems: subscription.items?.data?.length > 0
        });

        // Check for credit notes (refunds)
        let refundInfo = null;
        let invoiceInfo = null;
        try {
            const invoices = await stripe.invoices.list({
                subscription: subscription.id,
                limit: 1
            });

            if (invoices.data.length > 0) {
                const latestInvoice = invoices.data[0];
                invoiceInfo = {
                    id: latestInvoice.id,
                    hosted_invoice_url: latestInvoice.hosted_invoice_url,
                    invoice_pdf: latestInvoice.invoice_pdf,
                    status: latestInvoice.status,
                    amount_paid: latestInvoice.amount_paid ? latestInvoice.amount_paid / 100 : null,
                    currency: latestInvoice.currency
                };

                const creditNotes = await stripe.creditNotes.list({
                    invoice: latestInvoice.id
                });

                if (creditNotes.data.length > 0) {
                    const refund = creditNotes.data[0];
                    refundInfo = {
                        amount: refund.amount / 100,
                        reason: refund.reason,
                        date: new Date(refund.created * 1000).toISOString(),
                        memo: refund.memo || ''
                    };
                }
            }
        } catch (creditNoteError) {
            console.warn('Could not retrieve credit notes:', creditNoteError);
        }

        // Helper function to safely format dates
        const safeFormatDate = (timestamp) => {
            if (!timestamp) return null;
            try {
                const date = new Date(timestamp * 1000);
                return {
                    iso: date.toISOString(),
                    formatted: date.toDateString()
                };
            } catch (e) {
                console.warn(`Invalid date conversion for timestamp: ${timestamp}`);
                return null;
            }
        };

        // Get price and product details
        const priceData = subscription.items.data[0]?.price;
        if (!priceData) {
            console.error('[get-subscription-from-session] No price data found in subscription items');
            return res.status(404).json({ error: 'No price data found in subscription' });
        }

        const productData = priceData.product; // This is the expanded product object

        // Get interval information - with safety checks
        let interval = 'one-time';
        if (priceData.recurring &&
            priceData.recurring.interval_count &&
            priceData.recurring.interval) {
            interval = `${priceData.recurring.interval_count} ${priceData.recurring.interval}`;
        }

        // Include payment information from the session
        const paymentInfo = {
            paymentStatus: session.payment_status || 'unknown',
            paymentMethod: session.payment_method_types?.[0] || null,
            amountTotal: session.amount_total ? session.amount_total / 100 : null
        };

        // Enhanced debugging for subscription dates
        console.log('[get-subscription-from-session] Subscription date fields:', {
            current_period_start: subscription.current_period_start,
            current_period_end: subscription.current_period_end,
            trial_end: subscription.trial_end,
            created: subscription.created,
            billing_cycle_anchor: subscription.billing_cycle_anchor,
            start_date: subscription.start_date,
            status: subscription.status
        });

        // Safe date formatting with enhanced fallbacks
        let nextBillingDate = safeFormatDate(subscription.current_period_end);
        let currentPeriodStart = safeFormatDate(subscription.current_period_start);
        let currentPeriodEnd = safeFormatDate(subscription.current_period_end);

        // Enhanced fallback logic for current_period_start
        if (!currentPeriodStart) {
            if (subscription.billing_cycle_anchor) {
                currentPeriodStart = safeFormatDate(subscription.billing_cycle_anchor);
                console.log('[get-subscription-from-session] Using billing_cycle_anchor for current_period_start');
            } else if (subscription.start_date) {
                currentPeriodStart = safeFormatDate(subscription.start_date);
                console.log('[get-subscription-from-session] Using start_date for current_period_start');
            } else if (subscription.created) {
                currentPeriodStart = safeFormatDate(subscription.created);
                console.log('[get-subscription-from-session] Using created date for current_period_start');
            }
        }

        // Enhanced fallback logic for current_period_end and nextBillingDate
        if (!currentPeriodEnd && currentPeriodStart && priceData.recurring) {
            try {
                const startDate = new Date(currentPeriodStart.iso);
                const interval = priceData.recurring.interval;
                const intervalCount = priceData.recurring.interval_count || 1;

                let endDate = new Date(startDate);
                if (interval === 'year') {
                    endDate.setFullYear(endDate.getFullYear() + intervalCount);
                } else if (interval === 'month') {
                    endDate.setMonth(endDate.getMonth() + intervalCount);
                } else if (interval === 'week') {
                    endDate.setDate(endDate.getDate() + 7 * intervalCount);
                } else if (interval === 'day') {
                    endDate.setDate(endDate.getDate() + intervalCount);
                }

                currentPeriodEnd = {
                    iso: endDate.toISOString(),
                    formatted: endDate.toDateString()
                };
                nextBillingDate = currentPeriodEnd;
                console.log('[get-subscription-from-session] Calculated period end date:', currentPeriodEnd);
            } catch (e) {
                console.warn('Could not calculate period end date:', e);
            }
        }

        // Final fallback: if still no dates, use session creation date
        if (!currentPeriodStart && session.created) {
            currentPeriodStart = safeFormatDate(session.created);
            console.log('[get-subscription-from-session] Using session created date as fallback');
        }

        // Additional fallback for pending subscriptions
        if (subscription.status === 'incomplete' || subscription.status === 'incomplete_expired') {
            console.log('[get-subscription-from-session] Subscription is in incomplete state, using session dates');
            if (!currentPeriodStart && session.created) {
                currentPeriodStart = safeFormatDate(session.created);
            }
            if (!currentPeriodEnd && currentPeriodStart && priceData.recurring) {
                // Calculate end date based on interval
                try {
                    const startDate = new Date(currentPeriodStart.iso);
                    const interval = priceData.recurring.interval;
                    const intervalCount = priceData.recurring.interval_count || 1;

                    let endDate = new Date(startDate);
                    if (interval === 'year') {
                        endDate.setFullYear(endDate.getFullYear() + intervalCount);
                    } else if (interval === 'month') {
                        endDate.setMonth(endDate.getMonth() + intervalCount);
                    } else if (interval === 'week') {
                        endDate.setDate(endDate.getDate() + 7 * intervalCount);
                    } else if (interval === 'day') {
                        endDate.setDate(endDate.getDate() + intervalCount);
                    }

                    currentPeriodEnd = {
                        iso: endDate.toISOString(),
                        formatted: endDate.toDateString()
                    };
                    nextBillingDate = currentPeriodEnd;
                } catch (e) {
                    console.warn('Could not calculate period end date for incomplete subscription:', e);
                }
            }
        }

        const trialEnd = safeFormatDate(subscription.trial_end);
        const createdAt = safeFormatDate(subscription.created);

        console.log('[get-subscription-from-session] Building response for subscription:', subscription.id);

        // Build comprehensive response with safe null checks
        const response = {
            checkout: {
                id: session.id,
                status: session.status || 'unknown',
                paymentStatus: session.payment_status || 'unknown'
            },
            subscription: {
                id: subscription.id,
                status: subscription.status || 'unknown',
                plan: {
                    id: priceData.id,
                    name: productData?.name || priceData.nickname || 'Standard Plan',
                    description: productData?.description || '',
                    amount: priceData.unit_amount ? priceData.unit_amount / 100 : 0,
                    currency: priceData.currency || 'usd',
                    interval: interval,
                    planType: priceData.metadata["Plan"] || priceData.metadata["plan"] || "standard"
                },
                billing: {
                    nextBillingDate: nextBillingDate?.iso || null,
                    nextBillingDateFormatted: nextBillingDate?.formatted || 'N/A',
                    currentPeriodStart: currentPeriodStart?.iso || null,
                    currentPeriodEnd: currentPeriodEnd?.iso || null,
                    cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
                    trialEnd: trialEnd?.iso || null,
                    invoice: invoiceInfo
                },
                customer: subscription.customer ? {
                    id: typeof subscription.customer === 'object' ?
                        subscription.customer.id : subscription.customer,
                    email: typeof subscription.customer === 'object' ?
                        subscription.customer.email : null,
                    name: typeof subscription.customer === 'object' ?
                        subscription.customer.name : null
                } : null,
                payment: paymentInfo,
                refund: refundInfo,
                invoice: invoiceInfo,
                createdAt: createdAt?.iso || null
            }
        };

        console.log('[get-subscription-from-session] Successfully returning subscription data');

        // Log the subscription retrieval response
        try {
            fileLogger.logSubscriptionPayment({
                userId: session.metadata?.userId || 'unknown',
                userEmail: session.metadata?.email || 'unknown',
                amount: session.amount_total ? session.amount_total / 100 : null,
                currency: session.currency || 'usd',
                status: 'completed',
                stripeSessionId: session.id,
                paymentIntentId: session.payment_intent || null,
                customerId: typeof session.customer === 'object' ? session.customer.id : session.customer,
                invoiceId: invoiceInfo?.id || null,
                hostedInvoiceUrl: invoiceInfo?.hosted_invoice_url || null,
                invoicePdf: invoiceInfo?.invoice_pdf || null,
                subscriptionId: subscription.id,
                ipAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.get('User-Agent'),
                apiEndpoint: '/get-subscription-from-session',
                requestMethod: 'POST',
                metadata: {
                    sessionType: 'subscription',
                    subscriptionStatus: subscription.status,
                    paymentStatus: session.payment_status,
                    planName: productData?.name || 'Unknown Plan',
                    interval: interval,
                    refundInfo: refundInfo
                }
            });
        } catch (logError) {
            console.error('[get-subscription-from-session] Error logging subscription data:', logError);
        }

        res.json(response);

    } catch (error) {
        console.error("Error in get-subscription-from-session:", error);

        // Log the error response
        try {
            fileLogger.logFailedPayment({
                userId: req.body.sessionId ? 'unknown' : 'unknown',
                userEmail: 'unknown',
                amount: null,
                currency: 'usd',
                status: 'failed',
                stripeSessionId: req.body.sessionId || null,
                paymentIntentId: null,
                customerId: null,
                errorMessage: error.message || "Failed to fetch subscription",
                errorCode: error.type || 'UNKNOWN_ERROR',
                errorStack: error.stack,
                ipAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.get('User-Agent'),
                apiEndpoint: '/get-subscription-from-session',
                requestMethod: 'POST',
                metadata: {
                    sessionType: 'error',
                    errorType: error.type,
                    sessionId: req.body.sessionId
                }
            });
        } catch (logError) {
            console.error('[get-subscription-from-session] Error logging error data:', logError);
        }

        // Provide more specific error messages
        if (error.type === 'StripeInvalidRequestError') {
            if (error.message.includes('No such checkout.session')) {
                return res.status(404).json({
                    error: 'Session not found',
                    details: 'The provided session ID does not exist in Stripe'
                });
            }
            if (error.message.includes('No such subscription')) {
                return res.status(404).json({
                    error: 'Subscription not found',
                    details: 'The subscription associated with this session no longer exists'
                });
            }
            return res.status(404).json({
                error: 'Session or subscription not found',
                details: error.message
            });
        }

        res.status(500).json({
            error: error.message || "Failed to fetch subscription",
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});



function getSessionRecommendations(session) {
    const recommendations = [];

    if (session.mode === 'payment') {
        recommendations.push('This is a one-time payment session, not a subscription. Use /get-domain-purchase endpoint instead.');
    }

    if (!session.subscription && session.mode === 'subscription') {
        recommendations.push('Session is in subscription mode but has no subscription. Payment may have failed or subscription creation is pending.');
    }

    if (session.status === 'expired') {
        recommendations.push('Session has expired. Create a new checkout session.');
    }

    if (session.payment_status === 'unpaid') {
        recommendations.push('Payment was not completed. User may have cancelled or payment failed.');
    }

    return recommendations;
}

// Get all subscriptions for a user
router.get('/users/:userId/subscriptions', async (req, res) => {
    const { userId } = req.params;

    // Basic validation
    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    try {
        // Fetch subscription records from MongoDB using the provided userId
        const userSubscriptions = await Subscription.find({ userId }).lean();
        //  console.log('userSubscriptions', userSubscriptions);
        if (!userSubscriptions || userSubscriptions.length === 0) {
            return res.status(404).json({
                status: "-1",
                error: 'No subscriptions found',
                userId
            });
        }

        // Helper function to convert Unix timestamps to US formatted date strings.
        // Timezone: America/New_York.
        const safeDateConvert = (timestamp) => {
            if (!timestamp) return null;
            const date = new Date(timestamp * 1000);
            return isNaN(date.getTime())
                ? null
                : date.toLocaleString('en-US', { timeZone: 'America/New_York' });
        };

        // For each subscription record stored in Mongo, retrieve the up-to-date details from Stripe
        const stripeSubscriptions = await Promise.all(userSubscriptions.map(async (record) => {
            try {
                // Add safety check for null subscriptionId
                if (!record.subscriptionId) {
                    console.warn(`Skipping subscription record with null subscriptionId for user ${record.userId}`);
                    return null;
                }

                const stripeSub = await stripe.subscriptions.retrieve(record.subscriptionId, {
                    expand: ['items.data.price.product', 'customer', 'latest_invoice']
                });
                // console.log('Subscription Items:', stripeSub);
                // console.log('Subscription Items:', JSON.stringify(stripeSub.items.data, null, 2));

                if (!stripeSub) return null;

                // Get price and product details
                const priceItem = stripeSub.items.data[0];
                const price = priceItem.price;
                const product = typeof price.product === 'string'
                    ? { id: price.product, name: 'Unknown Product' }
                    : price.product;

                // Determine the current billing period dates from the subscription item
                const currentPeriodStart = priceItem.current_period_start;
                const currentPeriodEnd = priceItem.current_period_end;

                // Build a minimal invoice object (if available)
                const invoiceData = stripeSub.latest_invoice
                    ? {
                        id: stripeSub.latest_invoice.id,
                        createdAt: safeDateConvert(stripeSub.latest_invoice.created),
                        hosted_invoice_url: stripeSub.latest_invoice.hosted_invoice_url,
                        invoice_pdf: stripeSub.latest_invoice.invoice_pdf
                    }
                    : null;

                // Extract proration adjustments for potential upgrade/downgrade details.
                const subscriptionChanges =
                    stripeSub.latest_invoice &&
                        stripeSub.latest_invoice.lines &&
                        Array.isArray(stripeSub.latest_invoice.lines.data)
                        ? stripeSub.latest_invoice.lines.data
                            .filter(line =>
                                line.parent &&
                                line.parent.subscription_item_details &&
                                line.parent.subscription_item_details.proration === true
                            )
                            .map(line => ({
                                id: line.id,
                                description: line.description,
                                // Convert cents to dollars
                                amount: line.amount / 100,
                                currency: line.currency,
                                period: {
                                    start: safeDateConvert(line.period.start),
                                    end: safeDateConvert(line.period.end)
                                }
                            }))
                        : [];

                // Build and return the formatted subscription details
                return {
                    id: stripeSub.id,
                    customerId: stripeSub.customer.id,
                    status: stripeSub.status,
                    plan: {
                        id: price.id,
                        name: product.name || price.nickname || 'Standard Plan',
                        amount: price.unit_amount / 100,
                        currency: price.currency,
                        interval: price.recurring
                            ? `${price.recurring.interval_count} ${price.recurring.interval}`
                            : 'one-time',
                        planType: price.metadata["Plan"] || price.metadata["plan"] || "standard",
                        quantity: priceItem.quantity || 1,
                        totalAmount: (price.unit_amount / 100) * (priceItem.quantity || 1)
                    },
                    billing: {
                        nextBillingDate: safeDateConvert(currentPeriodEnd),
                        currentPeriodStart: safeDateConvert(currentPeriodStart),
                        currentPeriodEnd: safeDateConvert(currentPeriodEnd),
                        billingAnchor: safeDateConvert(stripeSub.billing_cycle_anchor),
                        startDate: safeDateConvert(stripeSub.start_date),
                        cancelAtPeriodEnd: stripeSub.cancel_at_period_end
                    },
                    invoice: invoiceData,
                    subscriptionChanges,
                    createdAt: safeDateConvert(stripeSub.created),
                    customer: {
                        id: stripeSub.customer.id,
                        email: stripeSub.customer.email,
                        name: stripeSub.customer.name || ''
                    }
                };
            } catch (e) {
                console.error(`Error retrieving subscription with ID ${record.subscriptionId}:`, e.message);
                return null; // Skip any subscription that cannot be retrieved
            }
        }));

        // Filter out any subscriptions that failed retrieval
        const validSubscriptions = stripeSubscriptions.filter(sub => sub !== null);

        res.json({
            status: '1',
            count: validSubscriptions.length,
            subscriptions: validSubscriptions
        });
    } catch (error) {
        console.error(`Failed to fetch subscriptions for user ${userId}:`, error);
        res.status(500).json({
            error: 'Failed to retrieve subscriptions',
            userId,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});


// Create a Billing Portal session to manage subscription
router.post('/create-billing-portal-session', async (req, res) => {
    // Extract customerId and userId from the body
    const { customerId, userId } = req.body;

    try {
        // Ensure MongoDB connection is established
        await connectToMongoDB();

        // Optionally verify that the customer exists in your database
        const subscriptionRecord = await Subscription.findOne({ customerId });
        if (!subscriptionRecord && userId) {
            console.log(`Warning: Creating portal for customer ${customerId} not in our database`);
        }

        // Create a Billing Portal session to manage subscription
        const portalSession = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: 'https://record.onepgr.com/profile',
        });

        // Respond with the portal session URL
        res.json({
            url: portalSession.url
        });
    } catch (error) {
        console.error('Error creating billing portal session:', error.message);
        res.status(500).json({ error: error.message });
    }
});


// Get Invoice Details

router.post('/get-invoice', async (req, res) => {
    const { invoiceId, customerId, subscriptionId, limit = 10 } = req.body;

    try {
        await connectToMongoDB();

        // Case 1: Specific invoice
        if (invoiceId) {
            const invoice = await stripe.invoices.retrieve(invoiceId, {
                expand: ['customer', 'subscription', 'charge', 'payment_intent']
            });
            return res.json({ invoice: formatInvoiceResponse(invoice) });
        }

        // Case 2: All invoices by subscriptionId
        if (subscriptionId) {
            const invoices = await stripe.invoices.list({
                subscription: subscriptionId,
                limit: limit
            });

            return res.json({
                invoices: invoices.data.map(formatInvoiceResponse),
                hasMore: invoices.has_more,
                totalCount: invoices.data.length
            });
        }

        // Case 3: All invoices by customerId
        if (customerId) {
            const invoices = await stripe.invoices.list({
                customer: customerId,
                limit: limit
            });

            return res.json({
                invoices: invoices.data.map(formatInvoiceResponse),
                hasMore: invoices.has_more,
                totalCount: invoices.data.length
            });
        }

        return res.status(400).json({
            error: 'Please provide invoiceId, customerId, or subscriptionId.'
        });

    } catch (error) {
        console.error('Error in /get-invoice:', error);
        if (error.type === 'StripeInvalidRequestError') {
            return res.status(404).json({ error: 'Invoice not found in Stripe' });
        }
        res.status(500).json({ error: error.message });
    }
});
function formatInvoiceResponse(invoice) {
    return {
        id: invoice.id,
        status: invoice.status,
        amount_due: invoice.amount_due / 100,
        currency: invoice.currency,
        created: new Date(invoice.created * 1000).toISOString(),
        paid: invoice.paid,
        hosted_invoice_url: invoice.hosted_invoice_url,
        invoice_pdf: invoice.invoice_pdf,
        customer: typeof invoice.customer === 'object' ? {
            id: invoice.customer.id,
            name: invoice.customer.name,
            email: invoice.customer.email
        } : { id: invoice.customer },
        subscription: typeof invoice.subscription === 'object' ? {
            id: invoice.subscription.id
        } : { id: invoice.subscription }
    };
}

router.post('/check-refund-status', async (req, res) => {
    const { subscriptionId } = req.body;

    if (!subscriptionId) {
        return res.status(400).json({ error: 'subscriptionId is required' });
    }

    try {
        // First check our database
        await connectToMongoDB();
        const dbSubscription = await Subscription.findOne({ subscriptionId });

        if (dbSubscription && dbSubscription.refundAmount > 0) {
            return res.json({
                hasRefund: true,
                amount: dbSubscription.refundAmount,
                date: dbSubscription.refundDate,
                source: 'database'
            });
        }

        // If not in database, check Stripe directly
        const invoices = await stripe.invoices.list({
            subscription: subscriptionId,
            limit: 1
        });

        if (invoices.data.length > 0) {
            const creditNotes = await stripe.creditNotes.list({
                invoice: invoices.data[0].id
            });

            if (creditNotes.data.length > 0) {
                const refund = creditNotes.data[0];
                return res.json({
                    hasRefund: true,
                    amount: refund.amount / 100,
                    date: new Date(refund.created * 1000).toISOString(),
                    reason: refund.reason,
                    source: 'stripe'
                });
            }
        }

        res.json({ hasRefund: false });
    } catch (error) {
        console.error('Error checking refund status:', error);
        res.status(500).json({ error: error.message });
    }
});



// Get invoice by session ID (for any type of purchase)
router.get('/invoice/session/:sessionId', async (req, res) => {
    const { sessionId } = req.params;

    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }

    try {
        // Retrieve the session with expanded invoice data
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['invoice', 'customer']
        });

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        let invoiceData = null;
        let customerData = null;

        // Extract customer information
        if (session.customer && typeof session.customer === 'object') {
            customerData = {
                id: session.customer.id,
                email: session.customer.email,
                name: session.customer.name
            };
        }

        // Handle invoice data
        if (session.invoice && typeof session.invoice === 'object') {
            // Use expanded invoice data
            invoiceData = {
                id: session.invoice.id,
                hostedInvoiceUrl: session.invoice.hosted_invoice_url,
                invoicePdf: session.invoice.invoice_pdf,
                receiptUrl: session.invoice.receipt_url,
                status: session.invoice.status,
                amount: session.invoice.amount_paid ? session.invoice.amount_paid / 100 : null,
                currency: session.invoice.currency
            };
        } else if (session.invoice && typeof session.invoice === 'string') {
            // Fetch invoice by ID
            try {
                const invoice = await stripe.invoices.retrieve(session.invoice);
                invoiceData = {
                    id: invoice.id,
                    hostedInvoiceUrl: invoice.hosted_invoice_url,
                    invoicePdf: invoice.invoice_pdf,
                    receiptUrl: invoice.receipt_url,
                    status: invoice.status,
                    amount: invoice.amount_paid ? invoice.amount_paid / 100 : null,
                    currency: invoice.currency
                };
            } catch (invoiceError) {
                console.warn(`Could not retrieve invoice ${session.invoice}:`, invoiceError.message);
            }
        }

        // Determine purchase type from metadata
        const purchaseType = session.metadata?.purchaseType || 'unknown';
        const isDomainPurchase = purchaseType === 'domain';

        res.json({
            sessionId: session.id,
            status: session.status,
            paymentStatus: session.payment_status,
            amount: session.amount_total ? session.amount_total / 100 : null,
            currency: session.currency,
            purchaseType: purchaseType,
            isDomainPurchase: isDomainPurchase,
            customer: customerData,
            invoice: invoiceData,
            metadata: session.metadata,
            createdAt: new Date(session.created * 1000).toISOString()
        });

    } catch (error) {
        console.error(`Error retrieving invoice for session ${sessionId}:`, error);
        res.status(500).json({
            error: 'Failed to retrieve invoice',
            sessionId,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Get all invoices for a user (any type of purchase)
router.get('/invoices/user/:userId', async (req, res) => {
    const { userId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    try {
        // Get all checkout sessions for this user
        const sessions = await stripe.checkout.sessions.list({
            limit: parseInt(limit),
            starting_after: offset > 0 ? offset : undefined,
            expand: ['data.invoice', 'data.customer']
        });

        // Filter sessions for this user
        const userSessions = sessions.data.filter(session =>
            session.metadata?.userId === userId
        );

        if (!userSessions || userSessions.length === 0) {
            return res.json({
                userId,
                totalSessions: 0,
                sessions: [],
                message: 'No sessions found for this user'
            });
        }

        // Process each session to get invoice information
        const sessionInvoices = await Promise.all(userSessions.map(async (session) => {
            let invoiceData = null;
            let customerData = null;

            // Extract customer information
            if (session.customer && typeof session.customer === 'object') {
                customerData = {
                    id: session.customer.id,
                    email: session.customer.email,
                    name: session.customer.name
                };
            }

            // Handle invoice data
            if (session.invoice && typeof session.invoice === 'object') {
                invoiceData = {
                    id: session.invoice.id,
                    hostedInvoiceUrl: session.invoice.hosted_invoice_url,
                    invoicePdf: session.invoice.invoice_pdf,
                    receiptUrl: session.invoice.receipt_url,
                    status: session.invoice.status,
                    amount: session.invoice.amount_paid ? session.invoice.amount_paid / 100 : null,
                    currency: session.invoice.currency
                };
            } else if (session.invoice && typeof session.invoice === 'string') {
                try {
                    const invoice = await stripe.invoices.retrieve(session.invoice);
                    invoiceData = {
                        id: invoice.id,
                        hostedInvoiceUrl: invoice.hosted_invoice_url,
                        invoicePdf: invoice.invoice_pdf,
                        receiptUrl: invoice.receipt_url,
                        status: invoice.status,
                        amount: invoice.amount_paid ? invoice.amount_paid / 100 : null,
                        currency: invoice.currency
                    };
                } catch (invoiceError) {
                    console.warn(`Could not retrieve invoice ${session.invoice}:`, invoiceError.message);
                }
            }

            return {
                sessionId: session.id,
                status: session.status,
                paymentStatus: session.payment_status,
                amount: session.amount_total ? session.amount_total / 100 : null,
                currency: session.currency,
                purchaseType: session.metadata?.purchaseType || 'unknown',
                isDomainPurchase: session.metadata?.purchaseType === 'domain',
                customer: customerData,
                invoice: invoiceData,
                metadata: session.metadata,
                createdAt: new Date(session.created * 1000).toISOString()
            };
        }));

        res.json({
            userId,
            totalSessions: userSessions.length,
            sessions: sessionInvoices
        });

    } catch (error) {
        console.error(`Error retrieving invoices for user ${userId}:`, error);
        res.status(500).json({
            error: 'Failed to retrieve invoices',
            userId,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});



// Get clean domain invoices for a user
router.get('/users/:userId/domain-invoices', async (req, res) => {
    const { userId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    try {
        await connectToMongoDB();

        // Import the NamecheapDomain model to query the correct collection
        const { NamecheapDomain } = require('../domainManagementAPI/nameCheapDomainApi');

        // Query the namecheap_domains collection for this user
        const userDomains = await NamecheapDomain.find({ userId })
            .limit(parseInt(limit))
            .skip(parseInt(offset))
            .lean();

        if (!userDomains || userDomains.length === 0) {
            return res.json({
                success: true,
                userId,
                data: [],
                message: 'No domains found for this user'
            });
        }

        // Extract clean invoice information
        const domainInvoices = userDomains
            .filter(domain => domain.stripePayment && domain.stripePayment.invoiceId)
            .map(domain => ({
                domain: domain.domain,
                invoiceId: domain.stripePayment.invoiceId,
                hostedInvoiceUrl: domain.stripePayment.hostedInvoiceUrl,
                invoicePdf: domain.stripePayment.invoicePdf,
                paymentDate: domain.stripePayment.paymentDate,
                amountPaid: domain.stripePayment.amountPaid,
                currency: domain.stripePayment.currency,
                paymentStatus: domain.stripePayment.paymentStatus
            }));

        res.json({
            success: true,
            userId,
            totalInvoices: domainInvoices.length,
            data: domainInvoices
        });

    } catch (error) {
        console.error('[Domain Invoices API] Error fetching user domain invoices:', {
            error: error.message,
            userId,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            userId,
            error: error.message,
            details: 'Failed to fetch user domain invoices'
        });
    }
});

// Get all domain purchases for a user
router.get('/users/:userId/domain-purchases', async (req, res) => {
    const { userId } = req.params;

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    try {
        // Search for checkout sessions with domain purchase metadata
        const sessions = await stripe.checkout.sessions.list({
            limit: 100,
            expand: ['data.line_items', 'data.customer']
        });

        // Filter sessions for this user and domain purchases
        const userDomainPurchases = sessions.data.filter(session =>
            session.metadata?.userId === userId &&
            (session.metadata?.purchaseType === 'domain_registration' ||
                session.metadata?.purchaseType === 'domain')
        );

        // Get detailed information for each purchase
        const purchaseDetails = await Promise.all(userDomainPurchases.map(async (session) => {
            let productDetails = null;
            const lineItem = session.line_items?.data?.[0];

            if (lineItem?.price?.product) {
                try {
                    productDetails = await stripe.products.retrieve(lineItem.price.product);
                } catch (error) {
                    console.warn('Could not retrieve product details:', error.message);
                }
            }

            return {
                sessionId: session.id,
                status: session.status,
                paymentStatus: session.payment_status,
                domainName: session.metadata.domainName,
                amount: session.amount_total / 100,
                currency: session.currency,
                unitPrice: parseFloat(session.metadata.unitPrice) || null,
                product: productDetails ? {
                    id: productDetails.id,
                    name: productDetails.name,
                    metadata: productDetails.metadata
                } : null,
                createdAt: new Date(session.created * 1000).toISOString()
            };
        }));

        res.json({
            userId,
            totalPurchases: purchaseDetails.length,
            purchases: purchaseDetails
        });

    } catch (error) {
        console.error('Error retrieving user domain purchases:', error);
        res.status(500).json({ error: 'Failed to retrieve domain purchases' });
    }
});

// webhook status
router.get('/webhook-status', async (req, res) => {
    try {
        // First check if we can access the webhook endpoints
        try {
            const webhooks = await stripe.webhookEndpoints.list();

            // Find our webhook endpoint
            const ourWebhook = webhooks.data.find(webhook =>
                webhook.url.includes('/api/stripe/webhook')
            );

            if (!ourWebhook) {
                return res.status(404).json({
                    status: 'not_found',
                    message: 'No webhook endpoint found for /api/stripe/webhook'
                });
            }

            // Try to get recent events, but don't fail if we can't
            let recentEvents = [];
            try {
                const events = await stripe.events.list({
                    limit: 5,
                    type: 'webhook.*'
                });
                recentEvents = events.data.map(event => ({
                    id: event.id,
                    type: event.type,
                    created: new Date(event.created * 1000).toISOString(),
                    status: event.data.object.status
                }));
            } catch (eventError) {
                console.warn('Could not fetch recent events:', eventError.message);
            }

            res.json({
                status: 'active',
                webhook: {
                    id: ourWebhook.id,
                    url: ourWebhook.url,
                    status: ourWebhook.status,
                    enabled_events: ourWebhook.enabled_events,
                    created: new Date(ourWebhook.created * 1000).toISOString()
                },
                recent_events: recentEvents,
                message: recentEvents.length === 0 ? 'Webhook is configured but recent events could not be fetched. Check your API key permissions.' : null
            });
        } catch (webhookError) {
            // If we can't access webhooks, return a more helpful error
            if (webhookError.type === 'StripePermissionError') {
                return res.status(403).json({
                    status: 'error',
                    message: 'API key does not have required permissions. Please use a secret key (sk_live_ or sk_test_) with webhook read permissions.',
                    error: webhookError.message
                });
            }
            throw webhookError;
        }
    } catch (error) {
        console.error('Error checking webhook status:', error);
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// Process successful payment and register domain
router.post('/domain/process-success-payment', async (req, res) => {
    try {
        const { sessionId, userId } = req.body;

        // Validate required fields
        if (!sessionId || !userId) {
            return res.status(400).json({
                success: false,
                error: 'sessionId and userId are required'
            });
        }

        // Step 1: Verify payment and extract data in parallel
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['line_items', 'customer', 'invoice']
        });

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Payment session not found'
            });
        }

        // Quick validation checks
        if (session.payment_status !== 'paid') {
            return res.status(400).json({
                success: false,
                error: 'Payment not completed',
                paymentStatus: session.payment_status,
                sessionStatus: session.status
            });
        }

        if (session.metadata?.purchaseType !== 'domain') {
            return res.status(400).json({
                success: false,
                error: 'This session is not a domain purchase'
            });
        }

        if (session.metadata?.userId !== userId) {
            return res.status(400).json({
                success: false,
                error: 'User ID mismatch'
            });
        }

        const domainName = session.metadata?.domainName;
        if (!domainName) {
            return res.status(400).json({
                success: false,
                error: 'Domain name not found in session metadata',
                sessionMetadata: session.metadata
            });
        }

        // Extract contact information
        const contactInfo = {
            firstName: session.metadata?.firstName || null,
            lastName: session.metadata?.lastName || null,
            email: session.metadata?.email || null,
            phone: session.metadata?.phone || null,
            address1: session.metadata?.address1 || null,
            address2: session.metadata?.address2 || '',
            city: session.metadata?.city || null,
            stateProvince: session.metadata?.stateProvince || null,
            country: session.metadata?.country || null,
            postalCode: session.metadata?.postalCode || null
        };
        console.log("contactInfo", contactInfo);
        // Validate required contact information
        const requiredFields = ['firstName', 'lastName', 'email', 'phone', 'address1', 'city', 'stateProvince', 'country', 'postalCode'];
        const missingFields = requiredFields.filter(field => !contactInfo[field]);

        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Missing required contact information for domain registration',
                missingFields,
                contactInfo: {
                    firstName: contactInfo.firstName || null,
                    lastName: contactInfo.lastName || null,
                    email: contactInfo.email || null,
                    phone: contactInfo.phone || null,
                    hasAddress: !!(contactInfo.address1 && contactInfo.city && contactInfo.stateProvince && contactInfo.country && contactInfo.postalCode)
                }
            });
        }

        // Step 2: Enhanced invoice processing with expanded data
        let hostedInvoiceUrl = null;
        let invoicePdf = null;
        let invoiceId = null;
        let receiptUrl = null;

        // Use expanded invoice data if available (new invoice-enabled sessions)
        if (session.invoice && typeof session.invoice === 'object') {
            const invoice = session.invoice;
            invoiceId = invoice.id;
            hostedInvoiceUrl = invoice.hosted_invoice_url || null;
            invoicePdf = invoice.invoice_pdf || null;
            receiptUrl = invoice.receipt_url || null;
            console.log(`[process-success-payment] Using expanded invoice data: ${invoiceId}`);
        }
        // Fallback to invoice ID lookup (legacy sessions)
        else if (session.invoice && typeof session.invoice === 'string') {
            invoiceId = session.invoice;
            try {
                const invoice = await stripe.invoices.retrieve(invoiceId);
                hostedInvoiceUrl = invoice.hosted_invoice_url || null;
                invoicePdf = invoice.invoice_pdf || null;
                receiptUrl = invoice.receipt_url || null;
                console.log(`[process-success-payment] Retrieved invoice from ID: ${invoiceId}`);
            } catch (error) {
                console.warn(`[process-success-payment] Could not retrieve invoice ${invoiceId}:`, error.message);
            }
        }
        // Last resort: try payment intent (very old sessions)
        else if (session.payment_intent) {
            try {
                const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
                if (paymentIntent.invoice) {
                    invoiceId = paymentIntent.invoice;
                    const invoice = await stripe.invoices.retrieve(invoiceId);
                    hostedInvoiceUrl = invoice.hosted_invoice_url || null;
                    invoicePdf = invoice.invoice_pdf || null;
                    receiptUrl = invoice.receipt_url || null;
                    console.log(`[process-success-payment] Retrieved invoice from payment intent: ${invoiceId}`);
                }
            } catch (error) {
                console.warn(`[process-success-payment] Could not retrieve invoice from payment intent:`, error.message);
            }
        }

        // Fallback receipt URL if no invoice URL available
        if (!hostedInvoiceUrl && session.payment_intent) {
            hostedInvoiceUrl = `https://dashboard.stripe.com/payments/${session.payment_intent}`;
        }

        const stripePaymentInfo = {
            sessionId: session.id,
            subscriptionId: session.subscription || null,
            hostedInvoiceUrl: hostedInvoiceUrl,
            invoicePdf: invoicePdf,
            receiptUrl: receiptUrl, // Use the retrieved receipt URL
            paymentIntentId: session.payment_intent || null,
            customerId: session.customer ? (typeof session.customer === 'object' ? session.customer.id : session.customer) : null,
            paymentStatus: session.payment_status || 'unknown',
            amountPaid: session.amount_total ? session.amount_total / 100 : 0,
            currency: session.currency || 'usd',
            paymentMethod: session.payment_method_types?.[0] || 'card',
            paymentDate: new Date(session.created * 1000),
            invoiceId: invoiceId
        };

        // Step 3: Register domain with Namecheap
        const registrationResult = await registerDomainWithNamecheap({
            userId,
            domain: domainName,
            firstName: contactInfo.firstName,
            lastName: contactInfo.lastName,
            email: contactInfo.email,
            phone: contactInfo.phone,
            address1: contactInfo.address1,
            address2: contactInfo.address2,
            city: contactInfo.city,
            stateProvince: contactInfo.stateProvince,
            country: contactInfo.country,
            postalCode: contactInfo.postalCode,
            years: session.metadata.years || '1',
            enablePrivacy: session.metadata.enablePrivacy === 'true',
            customNameservers: null,
            useNamecheapDNS: false,
            acceptPremiumPricing: true,
            stripePaymentInfo
        });
        console.log("registrationResult", registrationResult);
        // Step 4: Async logging (don't wait for it)
        setImmediate(() => {
            try {
                fileLogger.logDomainPurchase({
                    userId: userId,
                    userEmail: contactInfo.email,
                    domainName: domainName,
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    status: 'completed',
                    stripeSessionId: session.id,
                    paymentIntentId: session.payment_intent,
                    customerId: session.customer ? (typeof session.customer === 'object' ? session.customer.id : session.customer) : null,
                    invoiceId: stripePaymentInfo.invoiceId,
                    hostedInvoiceUrl: stripePaymentInfo.hostedInvoiceUrl,
                    invoicePdf: stripePaymentInfo.invoicePdf,
                    receiptUrl: stripePaymentInfo.receiptUrl,
                    registrationYears: parseInt(session.metadata.years || '1'),
                    enablePrivacy: session.metadata.enablePrivacy === 'true',
                    domainId: registrationResult.data?.registration?.domainId,
                    orderId: registrationResult.data?.registration?.orderId,
                    transactionId: registrationResult.data?.registration?.transactionId,
                    expirationDate: registrationResult.data?.registration?.expirationDate,
                    contactInfo: {
                        firstName: contactInfo.firstName,
                        lastName: contactInfo.lastName,
                        email: contactInfo.email,
                        phone: contactInfo.phone,
                        address1: contactInfo.address1,
                        address2: contactInfo.address2,
                        city: contactInfo.city,
                        stateProvince: contactInfo.stateProvince,
                        country: contactInfo.country,
                        postalCode: contactInfo.postalCode
                    },
                    ipAddress: req.ip,
                    userAgent: req.get('User-Agent'),
                    apiEndpoint: '/domain/process-success-payment',
                    requestMethod: 'POST',
                    metadata: {
                        registrationSuccess: true,
                        databaseRecordId: registrationResult.data?.databaseRecord?._id
                    }
                });
            } catch (logError) {
                console.error('Error logging successful domain purchase:', logError);
            }
        });

        // Step 5: Prepare and send response
        const paymentDetails = {
            sessionId: session.id,
            status: session.status,
            paymentStatus: session.payment_status,
            amount: session.amount_total / 100,
            currency: session.currency,
            customer: {
                id: session.customer ? (typeof session.customer === 'object' ? session.customer.id : session.customer) : null,
                email: session.customer ? (typeof session.customer === 'object' ? session.customer.email : null) : session.customer_details?.email || null,
                name: session.customer ? (typeof session.customer === 'object' ? session.customer.name : null) : session.customer_details?.name || null
            },
            createdAt: new Date(session.created * 1000).toISOString(),
            paymentMethod: session.payment_method_types?.[0] || 'card'
        };

        res.json({
            success: true,
            message: 'Domain purchased and registered successfully',
            data: {
                payment: paymentDetails,
                registration: registrationResult,
                domain: domainName,
                registrationYears: session.metadata.years,
                userId: userId,
                invoice: {
                    id: stripePaymentInfo.invoiceId,
                    hostedUrl: stripePaymentInfo.hostedInvoiceUrl,
                    pdfUrl: stripePaymentInfo.invoicePdf,
                    receiptUrl: stripePaymentInfo.receiptUrl
                },
                combinedRecord: {
                    stripePaymentStored: true,
                    domainRegistered: true,
                    databaseRecordId: registrationResult.data?.databaseRecord?._id
                }
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Domain success processing error:', error);

        // Async error logging
        setImmediate(() => {
            try {
                fileLogger.logDomainPurchase({
                    userId: req.body.userId,
                    userEmail: req.body.email || null,
                    domainName: req.body.domainName || null,
                    amount: 0,
                    currency: 'usd',
                    status: 'error',
                    stripeSessionId: req.body.sessionId,
                    ipAddress: req.ip,
                    userAgent: req.get('User-Agent'),
                    apiEndpoint: '/domain/process-success-payment',
                    requestMethod: 'POST',
                    errorDetails: {
                        errorMessage: error.message,
                        errorCode: 'PROCESSING_ERROR',
                        errorStack: error.stack
                    },
                    metadata: {
                        registrationSuccess: false,
                        errorType: error.name
                    }
                });
            } catch (logError) {
                console.error('Error logging processing error:', logError);
            }
        });

        res.status(500).json({
            success: false,
            error: 'Failed to process successful domain payment',
            details: error.message
        });
    }
});

function extractHtmlErrorMessage(html) {
    // Try to extract <title> or <body> content for a user-friendly error
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    if (titleMatch) return titleMatch[1];
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) return bodyMatch[1].replace(/<[^>]+>/g, '').trim();
    return html.slice(0, 200); // fallback: first 200 chars
}


router.get('/invoice/:paymentIntentId', async (req, res) => {
    const { paymentIntentId } = req.params;

    try {
        // Option A: Retrieve PI and expand invoice
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
            expand: ['invoice'],
        });
        if (pi.invoice) {
            return res.json({ invoice: pi.invoice });
        }

        // Option B: Fallback to list invoices
        const invList = await stripe.invoices.list({
            payment_intent: paymentIntentId,
            limit: 1,
        });
        if (invList.data.length > 0) {
            return res.json({ invoice: invList.data[0] });
        }

        return res.status(404).json({ error: 'Invoice not found for that PaymentIntent.' });
    } catch (err) {
        console.error('Error fetching invoice:', err);
        return res.status(400).json({ error: err.message });
    }
});


// router.post('/create-checkout-session-by-app', async (req, res) => {
//     try {
//         // 1. Destructure all parameters including trialPeriodDays
//         const { userId, priceId, app, quantity = 1, planType, trialPeriodDays } = req.body;
//         const isSandbox = isSandboxMode(req);
//         const stripe = getStripeInstance(isSandbox);

//         console.log(`[${isSandbox ? 'SANDBOX' : 'PRODUCTION'}] create-checkout-session-by-app called for user:`, userId, 'app:', app, 'planType:', planType, 'trialDays:', trialPeriodDays);

//         // 1) App URL map + validation - Different URLs for sandbox vs production
//         const appUrlMap = isSandbox ? {
//             // Sandbox URLs - Localhost for testing
//             kampaignai: 'https://kampaign.onepgr.com',
//             gps: 'http://localhost:4200',
//             getsalesgpt: 'http://localhost:4200',
//         } : {
//             // Production URLs
//             kampaignai: 'https://kampaign.onepgr.com',
//             gps: 'https://gps.onepgr.com',
//             getsalesgpt: 'https://sales.onepgr.com',
//         };

//         if (!app || !appUrlMap[app]) {
//             return res.status(400).json({ error: 'Invalid or missing app parameter' });
//         }
//         if (!priceId) {
//             return res.status(400).json({ error: 'Missing priceId' });
//         }
//         if (!quantity || quantity < 1) {
//             return res.status(400).json({ error: 'Quantity must be at least 1' });
//         }
//         if (trialPeriodDays && (trialPeriodDays < 0 || trialPeriodDays > 365)) {
//             return res.status(400).json({ error: 'Trial period days must be between 0 and 365' });
//         }

//         await connectToMongoDB();

//         // 2) Find or create customer record for user - filter by environment
//         const environment = isSandbox ? 'sandbox' : 'production';

//         // First check for customer with environment field
//         let customerRecord = await Customer.findOne({ userId, environment });

//         // If not found, check for legacy customer without environment field
//         if (!customerRecord) {
//             const legacyCustomer = await Customer.findOne({ userId, environment: { $exists: false } });
//             if (legacyCustomer) {
//                 console.log(`🔄 Found legacy customer record for user ${userId}, migrating to ${environment} environment`);
//                 // Update the legacy record to include environment
//                 await Customer.updateOne(
//                     { _id: legacyCustomer._id },
//                     { $set: { environment: environment } }
//                 );
//                 customerRecord = { ...legacyCustomer, environment: environment };
//             }
//         }

//         let customerId;

//         if (!customerRecord) {
//             console.log(`[${isSandbox ? 'SANDBOX' : 'PRODUCTION'}] No customer record found for user ${userId} - will create new customer during checkout`);

//             // Create new customer in Stripe for this user
//             try {
//                 const customer = await stripe.customers.create({
//                     email: null, // No email provided
//                     metadata: {
//                         userId,
//                         app,
//                         planType: planType || 'unknown', // 🆕 Store plan type
//                         environment: isSandbox ? 'sandbox' : 'production',
//                         createdVia: 'subscription_checkout',
//                         createdAt: new Date().toISOString(),
//                         trialPeriodDays: trialPeriodDays || 0 // Log it for reference
//                     }
//                 });
//                 customerId = customer.id;

//                 // Create customer record in our database
//                 await Customer.updateOne(
//                     { userId, environment },
//                     {
//                         $set: {
//                             customerId: customer.id,
//                             app: app,
//                             planType: planType || 'unknown', // 🆕 Store plan type
//                             email: null, // No email provided
//                             environment: environment, // 🆕 Store environment
//                             createdAt: new Date()
//                         }
//                     },
//                     { upsert: true }
//                 );

//                 console.log(`[${isSandbox ? 'SANDBOX' : 'PRODUCTION'}] 🆕 Created new customer ${customerId} for user ${userId}`);
//             } catch (customerError) {
//                 console.error(`[${isSandbox ? 'SANDBOX' : 'PRODUCTION'}] Error creating customer for user ${userId}:`, customerError);
//                 // Continue without customer ID - Stripe will create one during checkout
//                 customerId = null;
//             }
//         } else {
//             customerId = customerRecord.customerId;
//             console.log(`[${isSandbox ? 'SANDBOX' : 'PRODUCTION'}] ✅ Found existing customer ${customerId} for user ${userId}`);
//         }

//         const getSuccessUrl = (app, planType, isSandbox) => {
//             // 🆕 Use sandbox URLs when in sandbox mode
//             const baseUrl = isSandbox ? getSandboxUrl(app) : appUrlMap[app];

//             if (!baseUrl) return `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`;

//             switch (planType) {
//                 case 'email/warmup':
//                     return `${baseUrl}/email-success?session_id={CHECKOUT_SESSION_ID}`;
//                 case 'kampaign-main':
//                     return `${baseUrl}/kampaign-success?session_id={CHECKOUT_SESSION_ID}`;
//                 case 'gps':
//                     return `${baseUrl}/gps-success?session_id={CHECKOUT_SESSION_ID}`;
//                 case 'getsalesgpt':
//                     return `${baseUrl}/salesgpt-success?session_id={CHECKOUT_SESSION_ID}`;
//                 case 'onboarding-kai':
//                     return `${baseUrl}/get-started/success?session_id={CHECKOUT_SESSION_ID}`;
//                 default:
//                     return `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`;
//             }
//         };

//         // �� Helper function to get sandbox URLs
//         const getSandboxUrl = (app) => {
//             const sandboxUrls = {
//                 kampaignai: 'https://kampaign.onepgr.com',
//                 gps: 'http://localhost:4200',
//                 getsalesgpt: 'http://localhost:4200'
//             };
//             return sandboxUrls[app] || 'https://kampaign.onepgr.com';
//         };

//         // 🆕 Update Cancel URL function too
//         const getCancelUrl = (app, planType, isSandbox) => {
//             const baseUrl = isSandbox ? getSandboxUrl(app) : appUrlMap[app];

//             if (!baseUrl) return `${baseUrl}/cancel`;

//             switch (planType) {
//                 case 'email/warmup':
//                     return `${baseUrl}/cancel`;
//                 case 'kampaign-main':
//                     return `${baseUrl}/cancel`;
//                 case 'gps':
//                     return `${baseUrl}/cancel`;
//                 case 'getsalesgpt':
//                     return `${baseUrl}/cancelg`;
//                 case 'onboarding-kai':
//                     return `${baseUrl}/cancel`;
//                 default:
//                     return `${baseUrl}/pricing`;
//             }
//         };

//         // 3) Create Checkout session with customer if available
//         const sessionPayload = {
//             mode: 'subscription',
//             payment_method_types: ['card'],
//             line_items: [{ price: priceId, quantity }],
//             success_url: getSuccessUrl(app, planType, isSandbox), // 🆕 Dynamic success URL
//             cancel_url: getCancelUrl(app, planType, isSandbox),   // �� Dynamic cancel URL
//             metadata: {
//                 userId,
//                 app,
//                 planType: planType || 'unknown', // 🆕 Store plan type
//                 environment: isSandbox ? 'sandbox' : 'production',
//                 sandbox: isSandbox,
//                 trialPeriodDays: trialPeriodDays || 0 // Log it for reference
//             },
//             allow_promotion_codes: true, // optional
//         };

//         // 4) 🔥 Add free trial configuration if specified
//         if (trialPeriodDays && trialPeriodDays > 0) {
//             sessionPayload.subscription_data = {
//                 trial_period_days: trialPeriodDays
//             };
//             console.log(`[${isSandbox ? 'SANDBOX' : 'PRODUCTION'}] Adding free trial of ${trialPeriodDays} days to checkout`);
//         }

//         // If we have a customer ID, attach them so saved cards show up
//         if (customerId) {
//             sessionPayload.customer = customerId;
//             console.log(`[${isSandbox ? 'SANDBOX' : 'PRODUCTION'}] Attaching existing customer ${customerId} to checkout session`);
//         } else {
//             console.log(`[${isSandbox ? 'SANDBOX' : 'PRODUCTION'}] 📝 No customer ID available, Stripe will create new customer during checkout`);
//         }

//         const session = await stripe.checkout.sessions.create(sessionPayload);

//         // Store checkout session info for tracking
//         if (customerId) {
//             await Customer.updateOne(
//                 { userId, environment },
//                 { $set: { lastCheckoutSessionId: session.id } }
//             );
//             console.log(`[${isSandbox ? 'SANDBOX' : 'PRODUCTION'}] 📝 Updated customer record with checkout session ${session.id}`);
//         } else {
//             // If no customer ID, we'll need to update it later when the webhook processes
//             console.log(`[${isSandbox ? 'SANDBOX' : 'PRODUCTION'}] ⏳ Customer record will be updated when webhook processes checkout completion`);
//         }

//         return res.json({
//             mode: 'checkout',
//             url: session.url,
//             environment: isSandbox ? 'sandbox' : 'production',
//             customerId: customerId,
//             planType: planType || 'unknown',
//             trialPeriodDays: trialPeriodDays || 0, // Inform the frontend
//             successUrl: getSuccessUrl(app, planType, isSandbox),
//             cancelUrl: getCancelUrl(app, planType, isSandbox),
//             appUrls: appUrlMap
//         });
//     } catch (err) {
//         console.error(`[${isSandboxMode(req) ? 'SANDBOX' : 'PRODUCTION'}] Stripe error:`, err);
//         res.status(500).json({ error: err.message });
//     }
// });


router.post('/create-checkout-session-by-app', async (req, res) => {
    try {
        // 1. Destructure all parameters including optional array of priceIds
        const { userId, priceId, priceIds, app, quantity = 1, planType, trialPeriodDays } = req.body;
        const isSandbox = isSandboxMode(req);
        const stripe = getStripeInstance(isSandbox);

        console.log(`[${isSandbox ? 'SANDBOX' : 'PRODUCTION'}] create-checkout-session-by-app called for user:`, userId, 'app:', app, 'planType:', planType, 'trialDays:', trialPeriodDays);

        // 2) App URL map + validation
        const appUrlMap = isSandbox ? {
            kampaignai: 'https://kampaign.onepgr.com',
            gps: 'http://localhost:4200',
            getsalesgpt: 'http://localhost:4200',
        } : {
            kampaignai: 'https://kampaign.onepgr.com',
            gps: 'https://gps.onepgr.com',
            getsalesgpt: 'https://sales.onepgr.com',
        };

        if (!app || !appUrlMap[app]) return res.status(400).json({ error: 'Invalid or missing app parameter' });
        if ((!priceId && (!priceIds || priceIds.length === 0))) return res.status(400).json({ error: 'Missing priceId(s)' });
        if (!quantity || quantity < 1) return res.status(400).json({ error: 'Quantity must be at least 1' });
        if (trialPeriodDays && (trialPeriodDays < 0 || trialPeriodDays > 365)) return res.status(400).json({ error: 'Trial period days must be between 0 and 365' });

        await connectToMongoDB();

        const environment = isSandbox ? 'sandbox' : 'production';

        // 3) Find or create customer record
        let customerRecord = await Customer.findOne({ userId, environment });
        if (!customerRecord) {
            const legacyCustomer = await Customer.findOne({ userId, environment: { $exists: false } });
            if (legacyCustomer) {
                await Customer.updateOne({ _id: legacyCustomer._id }, { $set: { environment } });
                customerRecord = { ...legacyCustomer, environment };
            }
        }

        let customerId;
        if (!customerRecord) {
            try {
                const customer = await stripe.customers.create({
                    email: null,
                    metadata: { userId, app, planType: planType || 'unknown', environment, createdVia: 'subscription_checkout', createdAt: new Date().toISOString(), trialPeriodDays: trialPeriodDays || 0 }
                });
                customerId = customer.id;

                await Customer.updateOne(
                    { userId, environment },
                    { $set: { customerId: customer.id, app, planType: planType || 'unknown', email: null, environment, createdAt: new Date() } },
                    { upsert: true }
                );
            } catch (customerError) {
                console.error(`[${isSandbox ? 'SANDBOX' : 'PRODUCTION'}] Error creating customer:`, customerError);
                customerId = null;
            }
        } else {
            customerId = customerRecord.customerId;
        }

        // 4) Helper functions for URLs
        const getSandboxUrl = (app) => {
            const sandboxUrls = { kampaignai: 'https://kampaign.onepgr.com', gps: 'http://localhost:4200', getsalesgpt: 'http://localhost:4200' };
            return sandboxUrls[app] || 'https://kampaign.onepgr.com';
        };
        const getSuccessUrl = (app, planType, isSandbox) => {
            const baseUrl = isSandbox ? getSandboxUrl(app) : appUrlMap[app];
            switch (planType) {
                case 'email/warmup': return `${baseUrl}/email-success?session_id={CHECKOUT_SESSION_ID}`;
                case 'kampaign-main': return `${baseUrl}/kampaign-success?session_id={CHECKOUT_SESSION_ID}`;
                case 'gps': return `${baseUrl}/gps-success?session_id={CHECKOUT_SESSION_ID}`;
                case 'getsalesgpt': return `${baseUrl}/sales-success?session_id={CHECKOUT_SESSION_ID}`;
                case 'onboarding-kai': return `${baseUrl}/get-started/success?session_id={CHECKOUT_SESSION_ID}`;
                default: return `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`;
            }
        };
        const getCancelUrl = (app, planType, isSandbox) => {
            const baseUrl = isSandbox ? getSandboxUrl(app) : appUrlMap[app];
            switch (planType) {
                case 'getsalesgpt': return `${baseUrl}/cancelg`;
                default: return `${baseUrl}/cancel`;
            }
        };

        // 5) Build line items (supports both single and multiple priceIds)
        const lineItems = Array.isArray(priceIds) && priceIds.length > 0
            ? priceIds.map(p => ({ price: p, quantity }))
            : [{ price: priceId, quantity }];

        // 6) Create checkout session payload
        const sessionPayload = {
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: lineItems,
            success_url: getSuccessUrl(app, planType, isSandbox),
            cancel_url: getCancelUrl(app, planType, isSandbox),
            metadata: { userId, app, planType: planType || 'unknown', environment, sandbox: isSandbox, trialPeriodDays: trialPeriodDays || 0 },
            allow_promotion_codes: true
        };

        // Add free trial if specified
        if (trialPeriodDays && trialPeriodDays > 0) {
            sessionPayload.subscription_data = { trial_period_days: trialPeriodDays };
        }

        if (customerId) sessionPayload.customer = customerId;

        // 7) Create session
        const session = await stripe.checkout.sessions.create(sessionPayload);

        // Store session info in DB
        if (customerId) {
            await Customer.updateOne({ userId, environment }, { $set: { lastCheckoutSessionId: session.id } });
        }

        return res.json({
            mode: 'checkout',
            url: session.url,
            environment: isSandbox ? 'sandbox' : 'production',
            customerId,
            planType: planType || 'unknown',
            trialPeriodDays: trialPeriodDays || 0,
            successUrl: getSuccessUrl(app, planType, isSandbox),
            cancelUrl: getCancelUrl(app, planType, isSandbox),
            appUrls: appUrlMap
        });

    } catch (err) {
        console.error(`[${isSandboxMode(req) ? 'SANDBOX' : 'PRODUCTION'}] Stripe error:`, err);
        res.status(500).json({ error: err.message });
    }
});


// Create a Billing Portal session to manage subscription
router.post('/create-billing-portal-session-by-app', async (req, res) => {
    // Extract customerId, userId, and app from the body
    const { customerId, userId, app } = req.body;

    try {
        // Determine sandbox mode and get appropriate Stripe instance
        const isSandbox = isSandboxMode(req);
        const stripe = getStripeInstance(isSandbox);
        const environment = isSandbox ? 'sandbox' : 'production';

        console.log(`[${isSandbox ? 'SANDBOX' : 'PRODUCTION'}] create-billing-portal-session-by-app called for customer:`, customerId, 'app:', app);

        // Ensure MongoDB connection is established
        await connectToMongoDB();

        // Optionally verify that the customer exists in your database
        const subscriptionRecord = await Subscription.findOne({ customerId });
        if (!subscriptionRecord && userId) {
            console.log(`Warning: Creating portal for customer ${customerId} not in our database`);
        }

        // Map app names to their base URLs - Different URLs for sandbox vs production
        const appUrlMap = isSandbox ? {
            // Sandbox URLs - Localhost for testing
            kampaignai: 'https://kampaign.onepgr.com',
            gps: 'http://localhost:4200',
            getsalesgpt: 'http://localhost:4200',
        } : {
            // Production URLs
            kampaignai: 'https://kampaign.onepgr.com',
            gps: 'https://gps.onepgr.com',
            getsalesgpt: 'https://sales.onepgr.com',
        };

        // Determine return URL based on app type
        let returnUrl;
        if (app && appUrlMap[app]) {
            returnUrl = `${appUrlMap[app]}/profile`;
        }

        // Create a Billing Portal session to manage subscription
        const portalSession = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl,
        });

        // Respond with the portal session URL
        res.json({
            url: portalSession.url,
            app: app || 'default',
            returnUrl: returnUrl,
            environment: environment
        });
    } catch (error) {
        console.error(`[${isSandboxMode(req) ? 'SANDBOX' : 'PRODUCTION'}] Error creating billing portal session:`, error.message);
        res.status(500).json({ error: error.message });
    }
});


//________________saved card with payment method API and auto debit monthly/yearly________________________

// Sync endpoint for direct Stripe usage - keeps database and Stripe in sync
router.post('/sync-payment-method', async (req, res) => {
    try {
        const { userId, paymentMethodId, email, app = 'default' } = req.body;

        if (!userId || !paymentMethodId || !email) {
            return res.status(400).json({
                error: 'Missing required parameters: userId, paymentMethodId, and email'
            });
        }

        const isSandbox = isSandboxMode(req);
        const stripe = getStripeInstance(isSandbox);
        const environment = isSandbox ? 'sandbox' : 'production';

        await connectToMongoDB();

        // Find or create customer record (separate from subscriptions) - filter by environment
        let customerRecord = await Customer.findOne({ userId, environment });
        let customerId;



        if (!customerRecord) {
            console.log(`[${isSandbox ? 'SANDBOX' : 'PRODUCTION'}] No existing customer found for user ${userId} in ${environment} environment`);

            try {
                const customer = await stripe.customers.create({
                    email: null, // No email provided
                    metadata: {
                        userId,
                        app,
                        planType: planType || 'unknown',
                        environment: environment,
                        createdVia: 'subscription_checkout',
                        timestamp: new Date().toISOString()
                    }
                });

                customerId = customer.id;

                // Create customer record in our database with environment
                await Customer.create({
                    userId,
                    customerId: customer.id,
                    app: app,
                    planType: planType || 'unknown',
                    email: null,
                    environment: environment, // 🆕 Store environment
                    createdAt: new Date()
                });

                console.log(`[${isSandbox ? 'SANDBOX' : 'PRODUCTION'}] 🆕 Created new customer ${customerId} for user ${userId} in ${environment} environment`);
            } catch (customerError) {
                console.error(`[${isSandbox ? 'SANDBOX' : 'PRODUCTION'}] Error creating customer for user ${userId}:`, customerError);
                return res.status(500).json({
                    error: 'Failed to create customer',
                    details: customerError.message
                });
            }
        } else {
            customerId = customerRecord.customerId;
            console.log(`[${isSandbox ? 'SANDBOX' : 'PRODUCTION'}] Found existing customer ${customerId} for user ${userId} in ${environment} environment`);
        }

        // if (!customerRecord) {
        //     // Create new customer in Stripe
        //     const customer = await stripe.customers.create({
        //         email,
        //         metadata: { userId, app, environment }
        //     });
        //     customerId = customer.id;

        //     // Create customer record (NOT subscription record)
        //     customerRecord = await Customer.create({
        //         userId,
        //         app,
        //         customerId,
        //         email,
        //         environment,
        //         createdAt: new Date()
        //     });

        //     console.log(`🆕 Created new customer ${customerId} for user ${userId}`);
        // } else {
        //     customerId = customerRecord.customerId;
        //     console.log(`✅ Found existing customer ${customerId} for user ${userId}`);
        // }

        // Verify the payment method exists and belongs to this customer
        let paymentMethod;
        try {
            paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

            if (paymentMethod.customer && paymentMethod.customer !== customerId) {
                // Payment method belongs to different customer, attach it to this customer
                await stripe.paymentMethods.attach(paymentMethodId, {
                    customer: customerId
                });
                console.log(`🔗 Attached payment method ${paymentMethodId} to customer ${customerId}`);
            } else if (!paymentMethod.customer) {
                // Payment method not attached to any customer, attach it
                await stripe.paymentMethods.attach(paymentMethodId, {
                    customer: customerId
                });
                console.log(`🔗 Attached payment method ${paymentMethodId} to customer ${customerId}`);
            }
        } catch (error) {
            return res.status(400).json({
                error: 'Invalid payment method ID or payment method not found'
            });
        }

        // Check if this is the user's first card
        const existingPaymentMethods = await stripe.paymentMethods.list({
            customer: customerId,
            type: 'card'
        });

        const isFirstCard = existingPaymentMethods.data.length === 1; // This card only

        if (isFirstCard) {
            console.log(`🆕 First card detected - auto-setting as default`);

            // Set as default in Stripe
            await stripe.customers.update(customerId, {
                invoice_settings: { default_payment_method: paymentMethodId }
            });

            // Update database
            customerRecord.defaultPaymentMethodId = paymentMethodId;
            await customerRecord.save();

            console.log(`✅ Payment method ${paymentMethodId} set as default for customer ${customerId}`);
        }

        // Get updated payment method details
        const updatedPM = await stripe.paymentMethods.retrieve(paymentMethodId);

        res.json({
            success: true,
            message: "Payment method synced successfully",
            customerId: customerId,
            isNewUser: true, // Customer record exists, so user has added payment method
            isFirstCard: isFirstCard,
            autoSetAsDefault: isFirstCard,
            card: {
                id: updatedPM.id,
                brand: updatedPM.card.brand,
                last4: updatedPM.card.last4,
                expMonth: updatedPM.card.exp_month,
                expYear: updatedPM.card.exp_year,
                isDefault: isFirstCard
            },
            syncDetails: {
                customerAttached: true,
                defaultSet: isFirstCard,
                totalCards: existingPaymentMethods.data.length
            }
        });

    } catch (err) {
        console.error("Error syncing payment method:", err);
        res.status(500).json({ error: err.message });
    }
});






// Get customer information for a user
router.get('/customer/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const isSandbox = isSandboxMode(req);
        const stripe = getStripeInstance(isSandbox);
        const environment = isSandbox ? 'sandbox' : 'production';

        await connectToMongoDB();

        // Find customer record - filter by environment
        const customerRecord = await Customer.findOne({ userId, environment });

        if (!customerRecord) {
            return res.status(404).json({
                error: 'No customer found for this user',
                hasCustomer: false
            });
        }

        // Get customer details from Stripe
        const stripeCustomer = await stripe.customers.retrieve(customerRecord.customerId);

        // Get payment methods count
        const paymentMethods = await stripe.paymentMethods.list({
            customer: customerRecord.customerId,
            type: 'card'
        });

        res.json({
            success: true,
            hasCustomer: true,
            customer: {
                id: customerRecord.customerId,
                userId: customerRecord.userId,
                email: customerRecord.email,
                app: customerRecord.app,
                defaultPaymentMethodId: customerRecord.defaultPaymentMethodId,
                createdAt: customerRecord.createdAt,
                stripeCustomer: {
                    id: stripeCustomer.id,
                    email: stripeCustomer.email,
                    name: stripeCustomer.name,
                    phone: stripeCustomer.phone,
                    defaultPaymentMethod: stripeCustomer.invoice_settings?.default_payment_method,
                    metadata: stripeCustomer.metadata
                },
                paymentMethods: {
                    count: paymentMethods.data.length,
                    hasDefault: !!customerRecord.defaultPaymentMethodId
                }
            }
        });

    } catch (error) {
        console.error('Error fetching customer info:', error);
        res.status(500).json({
            error: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Check if user has customer record (lightweight check)
router.post('/check-customer', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const isSandbox = isSandboxMode(req);
        const environment = isSandbox ? 'sandbox' : 'production';

        await connectToMongoDB();

        const customerRecord = await Customer.findOne({ userId, environment });

        res.json({
            hasCustomer: !!customerRecord,
            customerId: customerRecord?.customerId || null,
            email: customerRecord?.email || null,
            hasDefaultPaymentMethod: !!customerRecord?.defaultPaymentMethodId
        });

    } catch (error) {
        console.error('Error checking customer:', error);
        res.status(500).json({ error: error.message });
    }
});

// ___________Fetch User Payment Info (Cards + Billing History + Next Billing+manageSubscription)______________
router.post('/get-subscription-info-by-app', async (req, res) => {
    try {
        const { userId, app, features = [] } = req.body;

        const isSandbox = isSandboxMode(req);
        const stripe = getStripeInstance(isSandbox);
        const environment = isSandbox ? 'sandbox' : 'production';

        await connectToMongoDB();

        // Find customer record for this user (separate from subscriptions) - filter by environment
        const customerRecord = await Customer.findOne({ userId, environment });
        if (!customerRecord) {
            return res.status(200).json({
                error: 'No customer found for this user',
                hasCustomer: false,
                message: 'User has not added any payment methods yet'
            });
        }

        const customerId = customerRecord.customerId;

        let result = {};

        // 1️⃣ Saved Cards
        if (features.includes('cards')) {
            // Get customer's default payment method
            const customer = await stripe.customers.retrieve(customerId);
            const defaultPmId = customer.invoice_settings?.default_payment_method;

            const paymentMethods = await stripe.paymentMethods.list({
                customer: customerId,
                type: 'card',
            });

            result.cards = paymentMethods.data.map(pm => ({
                id: pm.id,
                brand: pm.card.brand,
                last4: pm.card.last4,
                exp_month: pm.card.exp_month,
                exp_year: pm.card.exp_year,
                isDefault: pm.id === defaultPmId,
            }));
        }

        // 2️⃣ Billing History (Invoices)
        if (features.includes('billingHistory')) {
            const invoices = await stripe.invoices.list({
                customer: customerId,
                limit: 10,
            });

            result.billingHistory = invoices.data.map(inv => ({
                id: inv.id,
                amount: inv.amount_paid / 100,
                currency: inv.currency,
                status: inv.status,
                date: new Date(inv.created * 1000),
            }));
        }

        // 3️⃣ Next Billing Info
        if (features.includes('nextBilling')) {
            // Get active subscriptions for this customer
            const subscriptions = await stripe.subscriptions.list({
                customer: customerId,
                status: 'active',
                limit: 1
            });

            if (subscriptions.data.length > 0) {
                const subscription = subscriptions.data[0];
                result.nextBilling = {
                    subscriptionId: subscription.id,
                    customerId: customerId,
                    status: subscription.status,
                    currentPeriodStart: subscription.current_period_start,
                    currentPeriodEnd: subscription.current_period_end,
                    nextInvoiceDate: subscription.current_period_end,
                    plan: subscription.items.data.map(i => ({
                        priceId: i.price.id,
                        interval: i.price.recurring.interval,
                        amount: i.price.unit_amount / 100,
                        currency: i.price.currency,
                        quantity: i.quantity || 1,
                        totalAmount: (i.price.unit_amount / 100) * (i.quantity || 1)
                    })),
                };
            }
        }

        // 4️⃣ Manage Subscription (Billing Portal)
        if (features.includes('manageSubscription')) {
            const appUrlMap = {
                kampaignai: 'https://kampaign.onepgr.com',
                // kampaignai: 'http://localhost:4200',
                gps: 'https://gps.onepgr.com',
                getsalesgpt: 'https://sales.onepgr.com',
            };

            let returnUrl = appUrlMap[app] ? `${appUrlMap[app]}/profile` : 'https://onepgr.com';

            const portalSession = await stripe.billingPortal.sessions.create({
                customer: customerId,
                return_url: returnUrl,
            });

            result.manageSubscription = {
                portalUrl: portalSession.url,
                returnUrl,
            };
        }

        res.json(result);

    } catch (err) {
        console.error("Error fetching subscription info:", err);
        res.status(500).json({ error: err.message });
    }
});



// Fetch user payment info (cards, billing history, next billing, subscription)

// Fetch user payment info (cards, billing history, next billing, subscription)
router.post('/get-user-payment-info', async (req, res) => {
    try {
        const { userId, features } = req.body;

        if (!userId || !features || !Array.isArray(features)) {
            return res.status(400).json({ error: 'Missing required parameters: userId and features array' });
        }

        const isSandbox = isSandboxMode(req);
        const stripe = getStripeInstance(isSandbox);
        const environment = isSandbox ? 'sandbox' : 'production';

        await connectToMongoDB();

        // Find customer record for this user (separate from subscriptions) - filter by environment
        const customerRecord = await Customer.findOne({ userId, environment });
        if (!customerRecord) {
            return res.status(200).json({
                error: 'No customer found for this user',
                hasCustomer: false,
                message: 'User has not added any payment methods yet'
            });
        }

        const customerId = customerRecord.customerId;
        let response = {
            customerId: customerId, // Include customerId in response for clarity
            userId: userId // Include userId for reference
        };

        // Fetch customer & ALL active subscriptions with expanded data
        const customer = await stripe.customers.retrieve(customerId);

        // Get subscriptions - normal approach for most users
        let subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            status: 'active',
            limit: 100,
            expand: ['data.latest_invoice', 'data.default_payment_method']
        });

        // Special handling ONLY for User 1486 (consolidated customer)
        if (userId === "1486" && subscriptions.data.length === 1) {
            console.log(`🔗 Special handling for consolidated user 1486`);
            const dbSubscriptions = await Subscription.find({ userId });
            if (dbSubscriptions.length > 1) {
                // Fetch all subscriptions individually for this user
                const stripeSubscriptions = await Promise.all(
                    dbSubscriptions.map(async (dbSub) => {
                        try {
                            return await stripe.subscriptions.retrieve(dbSub.subscriptionId, {
                                expand: ['latest_invoice', 'default_payment_method']
                            });
                        } catch (error) {
                            console.warn(`Could not retrieve subscription ${dbSub.subscriptionId}:`, error.message);
                            return null;
                        }
                    })
                );
                subscriptions = { data: stripeSubscriptions.filter(sub => sub !== null) };
            }
        }

        // Helper function to safely format dates from Stripe timestamps
        const formatStripeDate = (timestamp) => {
            if (!timestamp) return null;
            try {
                const date = new Date(timestamp * 1000);
                return date.toLocaleDateString("en-US", {
                    month: "short",
                    day: "2-digit",
                    year: "numeric"
                });
            } catch (error) {
                console.error('Date formatting error:', error);
                return null;
            }
        };

        // Get the primary subscription (most recent active subscription)
        const primarySub = subscriptions.data.sort((a, b) => b.created - a.created)[0];

        // Figure out default payment method
        let defaultPmId = customerRecord.defaultPaymentMethodId ||
            (primarySub?.default_payment_method ?
                (typeof primarySub.default_payment_method === "string" ?
                    primarySub.default_payment_method :
                    primarySub.default_payment_method.id) : null) ||
            customer.invoice_settings?.default_payment_method;

        // 🪪 Fetch Cards
        if (features.includes("cards")) {
            const paymentMethods = await stripe.paymentMethods.list({
                customer: customerId,
                type: 'card'
            });

            response.cards = paymentMethods.data.map(pm => ({
                id: pm.id,
                brand: pm.card.brand,
                last4: pm.card.last4,
                expMonth: pm.card.exp_month,
                expYear: pm.card.exp_year,
                isDefault: pm.id === defaultPmId
            }));
        }

        // 📜 Fetch Billing History
        if (features.includes("billingHistory")) {
            let invoices = [];

            // For consolidated customers, get invoices by subscription IDs
            if (userId === "1486") {
                console.log(`🔗 Fetching billing history for consolidated user 1486`);

                // Get all subscription IDs for this user
                const dbSubscriptions = await Subscription.find({ userId });
                const subscriptionIds = dbSubscriptions.map(sub => sub.subscriptionId);

                console.log(`🔗 Found ${subscriptionIds.length} subscriptions:`, subscriptionIds);

                // Fetch invoices for each subscription
                for (const subId of subscriptionIds) {
                    try {
                        const subscriptionInvoices = await stripe.invoices.list({
                            subscription: subId,
                            status: 'paid',
                            limit: 5
                        });

                        if (subscriptionInvoices.data.length > 0) {
                            invoices = invoices.concat(subscriptionInvoices.data);
                            console.log(`✅ Fetched ${subscriptionInvoices.data.length} invoices for subscription ${subId}`);
                        }
                    } catch (error) {
                        console.warn(`Could not fetch invoices for subscription ${subId}:`, error.message);
                    }
                }

                // Remove duplicates and sort by date
                invoices = invoices.filter((inv, index, self) =>
                    index === self.findIndex(t => t.id === inv.id)
                ).sort((a, b) => b.created - a.created);

                console.log(`🔗 Total invoices found: ${invoices.length}`);

            } else {
                // Normal flow for other users
                const customerInvoices = await stripe.invoices.list({
                    customer: customerId,
                    limit: 10,
                    status: 'paid'
                });
                invoices = customerInvoices.data;
            }

            response.billingHistory = invoices.map(inv => ({
                id: inv.id,
                amount: inv.amount_paid / 100,
                currency: inv.currency.toUpperCase(),
                status: inv.status,
                date: formatStripeDate(inv.created),
                invoiceUrl: inv.hosted_invoice_url,
                description: inv.lines?.data[0]?.description || 'Subscription payment'
            }));
        }

        // Function to get accurate subscription period dates
        const getSubscriptionPeriodDates = async (subscription) => {
            let currentPeriodStart = subscription.current_period_start;
            let currentPeriodEnd = subscription.current_period_end;

            // If period dates are missing, try to calculate them from billing cycle anchor
            if (!currentPeriodStart || !currentPeriodEnd) {
                console.log(`Subscription ${subscription.id} missing period dates, calculating...`);

                if (subscription.billing_cycle_anchor) {
                    const plan = subscription.items.data[0].price;
                    const anchorDate = new Date(subscription.billing_cycle_anchor * 1000);
                    const now = new Date();

                    // Calculate current period based on billing cycle anchor and interval
                    if (plan.recurring.interval === 'month') {
                        const intervalCount = plan.recurring.interval_count || 1;

                        // Find the most recent period start before now
                        let periodStart = new Date(anchorDate);
                        let periodEnd = new Date(periodStart);
                        periodEnd.setMonth(periodEnd.getMonth() + intervalCount);

                        while (periodEnd <= now) {
                            periodStart = new Date(periodEnd);
                            periodEnd.setMonth(periodEnd.getMonth() + intervalCount);
                        }

                        currentPeriodStart = Math.floor(periodStart.getTime() / 1000);
                        currentPeriodEnd = Math.floor(periodEnd.getTime() / 1000);
                    }
                }
            }

            return { currentPeriodStart, currentPeriodEnd };
        };

        // 📅 Next Billing + Subscription Info
        if (features.includes("nextBilling") || features.includes("subscription")) {
            if (primarySub) {
                const plan = primarySub.items.data[0].price;

                // Get accurate period dates
                const { currentPeriodStart, currentPeriodEnd } = await getSubscriptionPeriodDates(primarySub);

                // Get next payment date - use current_period_end if available
                let nextPaymentDate = currentPeriodEnd ? formatStripeDate(currentPeriodEnd) : null;
                let nextPaymentAmount = (plan.unit_amount / 100) * (primarySub.items.data[0].quantity || 1);

                // Try to get upcoming invoice for more accurate next payment info
                try {
                    const upcomingInvoices = await stripe.invoices.list({
                        customer: customerId,
                        status: 'open',
                        limit: 1
                    });

                    if (upcomingInvoices.data.length > 0) {
                        const upcomingInvoice = upcomingInvoices.data[0];
                        if (upcomingInvoice.due_date) {
                            nextPaymentDate = formatStripeDate(upcomingInvoice.due_date);
                            nextPaymentAmount = upcomingInvoice.amount_due / 100;
                        } else if (upcomingInvoice.period_end) {
                            nextPaymentDate = formatStripeDate(upcomingInvoice.period_end);
                            nextPaymentAmount = upcomingInvoice.amount_due / 100;
                        }

                        // Ensure nextPaymentAmount accounts for quantity if not from upcoming invoice
                        if (!nextPaymentAmount || nextPaymentAmount === 0) {
                            nextPaymentAmount = (plan.unit_amount / 100) * (primarySub.items.data[0].quantity || 1);
                        }
                    }
                } catch (err) {
                    console.log("No upcoming invoices found:", err.message);
                }

                response.nextBilling = {
                    status: primarySub.status,
                    nextPaymentDate,
                    nextPaymentAmount,
                    plan: {
                        priceId: plan.id,
                        productId: plan.product,
                        name: plan.nickname || `$${plan.unit_amount / 100}/${plan.recurring.interval}`,
                        interval: plan.recurring.interval,
                        intervalCount: plan.recurring.interval_count || 1,
                        amount: plan.unit_amount / 100,
                        currency: plan.currency.toUpperCase(),
                        quantity: primarySub.items.data[0].quantity || 1,
                        totalAmount: (plan.unit_amount / 100) * (primarySub.items.data[0].quantity || 1)
                    }
                };

                response.subscription = {
                    subscriptionId: primarySub.id,
                    customerId: customerId,
                    status: primarySub.status,
                    startDate: formatStripeDate(primarySub.start_date),
                    currentPeriodEnd: formatStripeDate(currentPeriodEnd),
                    currentPeriodStart: formatStripeDate(currentPeriodStart),
                    trialEnd: formatStripeDate(primarySub.trial_end),
                    cancelAtPeriodEnd: primarySub.cancel_at_period_end || false,
                    canceledAt: primarySub.canceled_at ? formatStripeDate(primarySub.canceled_at) : null,
                    endedAt: primarySub.ended_at ? formatStripeDate(primarySub.ended_at) : null,
                    created: formatStripeDate(primarySub.created),
                    billingCycleAnchor: formatStripeDate(primarySub.billing_cycle_anchor),
                    plan: {
                        priceId: plan.id,
                        productId: plan.product,
                        name: plan.nickname || `$${plan.unit_amount / 100}/${plan.recurring.interval}`,
                        interval: plan.recurring.interval,
                        intervalCount: plan.recurring.interval_count || 1,
                        amount: plan.unit_amount / 100,
                        currency: plan.currency.toUpperCase(),
                        quantity: primarySub.items.data[0].quantity || 1,
                        totalAmount: (plan.unit_amount / 100) * (primarySub.items.data[0].quantity || 1)
                    }
                };
            }

            // Add ALL active subscriptions if requested
            if (features.includes("allSubscriptions") || subscriptions.data.length > 1) {
                response.allSubscriptions = await Promise.all(
                    subscriptions.data.map(async (sub) => {
                        const plan = sub.items.data[0].price;

                        // Get accurate period dates for each subscription
                        const { currentPeriodStart, currentPeriodEnd } = await getSubscriptionPeriodDates(sub);

                        return {
                            subscriptionId: sub.id,
                            customerId: customerId,
                            status: sub.status,
                            startDate: formatStripeDate(sub.start_date),
                            currentPeriodStart: formatStripeDate(currentPeriodStart),
                            currentPeriodEnd: formatStripeDate(currentPeriodEnd),
                            trialEnd: formatStripeDate(sub.trial_end),
                            cancelAtPeriodEnd: sub.cancel_at_period_end || false,
                            canceledAt: sub.canceled_at ? formatStripeDate(sub.canceled_at) : null,
                            endedAt: sub.ended_at ? formatStripeDate(sub.ended_at) : null,
                            plan: {
                                priceId: plan.id,
                                productId: plan.product,
                                name: plan.nickname || `$${plan.unit_amount / 100}/${plan.recurring.interval}`,
                                interval: plan.recurring.interval,
                                intervalCount: plan.recurring.interval_count || 1,
                                amount: plan.unit_amount / 100,
                                currency: plan.currency.toUpperCase(),
                                quantity: sub.items.data[0].quantity || 1,
                                totalAmount: (plan.unit_amount / 100) * (sub.items.data[0].quantity || 1)
                            }
                        };
                    })
                );
            }
        }

        // Add summary with total amounts across all subscriptions
        if (subscriptions.data.length > 0) {
            const totalMonthlyAmount = subscriptions.data.reduce((total, sub) => {
                const item = sub.items.data[0];
                return total + ((item.price.unit_amount / 100) * (item.quantity || 1));
            }, 0);

            response.summary = {
                totalActiveSubscriptions: subscriptions.data.length,
                totalMonthlyAmount: Math.round(totalMonthlyAmount * 100) / 100, // Round to 2 decimal places
                currency: subscriptions.data[0]?.items.data[0]?.price.currency?.toUpperCase() || 'USD'
            };
        }

        res.json(response);

    } catch (err) {
        console.error("Error fetching user payment info:", err);
        res.status(200).json({
            // error: 'Internal server error',
            message: err.message
        });
    }
});


// Set default payment method for customer + subscription
router.post('/set-default-card', async (req, res) => {
    try {
        const { userId, paymentMethodId } = req.body;

        const isSandbox = isSandboxMode(req);
        const stripe = getStripeInstance(isSandbox);
        const environment = isSandbox ? 'sandbox' : 'production';

        await connectToMongoDB();

        // Find customer record for this user - filter by environment
        const customerRecord = await Customer.findOne({ userId, environment });
        if (!customerRecord) {
            return res.status(400).json({ error: 'No customer found for this user' });
        }

        const customerId = customerRecord.customerId;

        // 🔹 1. Attach the card to customer (safety check, in case it's not already attached)
        await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId }).catch(err => {
            if (err.code !== 'resource_already_exists') throw err;
        });

        // 🔹 2. Update customer's default
        await stripe.customers.update(customerId, {
            invoice_settings: { default_payment_method: paymentMethodId }
        });

        // 🔹 3. Update subscription's default only if user has active subscriptions
        const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            status: 'active',
            limit: 1
        });

        if (subscriptions.data.length > 0) {
            try {
                const updatedSub = await stripe.subscriptions.update(subscriptions.data[0].id, {
                    default_payment_method: paymentMethodId
                });
                console.log(`✅ Updated subscription ${subscriptions.data[0].id} default payment method`);
            } catch (subError) {
                console.warn("Could not update subscription default PM:", subError.message);
            }
        }

        // 🔹 4. Save in DB so you can fetch faster
        customerRecord.defaultPaymentMethodId = paymentMethodId;
        await customerRecord.save();

        res.json({ success: true, message: "Default card updated successfully" });

    } catch (err) {
        console.error("Error setting default card:", err);
        res.status(500).json({ error: err.message });
    }
});



// Delete a card
router.post('/delete-card', async (req, res) => {
    try {
        const { userId, paymentMethodId } = req.body;

        const isSandbox = isSandboxMode(req);
        const stripe = getStripeInstance(isSandbox);
        const environment = isSandbox ? 'sandbox' : 'production';

        await connectToMongoDB();

        // Find customer record for this user - filter by environment
        const customerRecord = await Customer.findOne({ userId, environment });
        if (!customerRecord) {
            return res.status(400).json({ error: 'No customer found for this user' });
        }

        const customerId = customerRecord.customerId;

        // Verify the payment method belongs to this customer
        const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
        if (paymentMethod.customer !== customerId) {
            return res.status(403).json({ error: 'Payment method does not belong to this customer' });
        }

        // Check if this is the default payment method
        const customer = await stripe.customers.retrieve(customerId);
        const defaultPmId = customer.invoice_settings?.default_payment_method || null;
        const isDefaultCard = defaultPmId === paymentMethodId;

        // Don't allow deletion of the only/default card
        if (isDefaultCard) {
            // Check if customer has other cards
            const paymentMethods = await stripe.paymentMethods.list({
                customer: customerId,
                type: 'card'
            });

            if (paymentMethods.data.length <= 1) {
                return res.status(400).json({
                    error: 'Cannot delete the only payment method. Please add another card first.'
                });
            }

            // If there are other cards, set a new default before deleting
            const otherCard = paymentMethods.data.find(pm => pm.id !== paymentMethodId);
            if (otherCard) {
                // Update customer default
                await stripe.customers.update(customerId, {
                    invoice_settings: { default_payment_method: otherCard.id }
                });

                // Update database
                customerRecord.defaultPaymentMethodId = otherCard.id;
                await customerRecord.save();

                console.log(`🔄 Auto-switched default to: ${otherCard.id}`);
            }
        }

        // Detach (delete) the payment method
        await stripe.paymentMethods.detach(paymentMethodId);

        res.json({
            success: true,
            message: "Card deleted successfully",
            ...(isDefaultCard && { newDefault: defaultPmId !== paymentMethodId ? defaultPmId : null })
        });

    } catch (err) {
        console.error("Error deleting card:", err);
        res.status(500).json({ error: err.message });
    }
});



// Cancel subscription
router.post('/cancel-subscription', async (req, res) => {
    try {
        const { userId, subscriptionId, cancelAtPeriodEnd = true } = req.body;

        await connectToMongoDB();

        // Find customer record for this user
        const customerRecord = await Customer.findOne({
            userId
        });

        if (!customerRecord) {
            return res.status(400).json({
                error: 'No customer found for this user'
            });
        }

        // Verify the subscription exists in Stripe
        let subscription;
        try {
            subscription = await stripe.subscriptions.retrieve(subscriptionId);
        } catch (stripeError) {
            return res.status(400).json({
                error: 'Invalid subscription ID or subscription not found in Stripe'
            });
        }

        // Verify the subscription belongs to this customer
        if (subscription.customer !== customerRecord.customerId) {
            return res.status(400).json({
                error: 'Subscription does not belong to this customer'
            });
        }

        // Check current subscription status

        if (subscription.status === 'canceled') {
            return res.status(400).json({ error: 'Subscription is already canceled' });
        }

        if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
            return res.status(400).json({
                error: 'Cannot cancel subscription in past_due or unpaid status'
            });
        }

        let cancelResult;

        if (cancelAtPeriodEnd) {
            // Cancel at the end of the current billing period
            cancelResult = await stripe.subscriptions.update(subscriptionId, {
                cancel_at_period_end: true
            });

            // Update database - update subscription status in Subscription collection if it exists
            try {
                await Subscription.updateOne(
                    { subscriptionId },
                    { status: 'canceled' }
                );
            } catch (dbError) {
                console.warn('Could not update subscription record in database:', dbError.message);
            }

            res.json({
                success: true,
                message: "Subscription will be canceled at the end of the current billing period",
                userMessage: `Your subscription will remain active until ${new Date(cancelResult.current_period_end * 1000).toLocaleDateString("en-US")}. You will continue to have access to all features until then.`,
                subscription: {
                    id: cancelResult.id,
                    status: cancelResult.status,
                    cancelAtPeriodEnd: cancelResult.cancel_at_period_end,
                    currentPeriodEnd: new Date(cancelResult.current_period_end * 1000).toLocaleDateString("en-US"),
                    cancelAt: new Date(cancelResult.cancel_at * 1000).toLocaleDateString("en-US"),
                    nextBillingDate: new Date(cancelResult.current_period_end * 1000).toLocaleDateString("en-US")
                }
            });
        } else {
            // Cancel immediately
            cancelResult = await stripe.subscriptions.cancel(subscriptionId);

            // Update database - update subscription status in Subscription collection if it exists
            try {
                await Subscription.updateOne(
                    { subscriptionId },
                    { status: 'canceled' }
                );
            } catch (dbError) {
                console.warn('Could not update subscription record in database:', dbError.message);
            }

            res.json({
                success: true,
                message: "Subscription canceled immediately",
                userMessage: "Your subscription has been canceled immediately. You will lose access to all features right away.",
                subscription: {
                    id: cancelResult.id,
                    status: cancelResult.status,
                    cancelAtPeriodEnd: cancelResult.cancel_at_period_end,
                    canceledAt: new Date(cancelResult.canceled_at * 1000).toLocaleDateString("en-US"),
                    immediateCancellation: true
                }
            });
        }

    } catch (err) {
        console.error("Error canceling subscription:", err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;