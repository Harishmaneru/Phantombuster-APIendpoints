const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const mongoose = require('mongoose');

// Import domain registration function from Namecheap API
const { registerDomainWithNamecheap } = require('../domainManagementAPI/nameCheapDomainApi');

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
    createdAt: { type: Date, default: Date.now }
}, { collection: 'user_subscriptions' });


const Subscription = mongoose.model('Subscription', subscriptionSchema);



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
                case 'checkout.session.completed': {
                    const session = event.data.object;
                    const {
                        customer,
                        subscription: subscriptionId,
                        metadata,
                        id: sessionId,
                        payment_status,
                        amount_total,
                        currency
                    } = session;
                    const userId = metadata?.userId || 'unknown';
                    const subscriptionStatus = session.status || 'active';

                    await connectToMongoDB();

                    // Check if this is a subscription payment or one-time payment
                    if (!subscriptionId) {
                        // This is a one-time payment (e.g., domain purchase)
                        console.log('[checkout.session.completed] One-time payment detected, skipping subscription processing');

                        // You might want to store one-time payment records in a different collection
                        // For now, we'll just log it and continue
                        console.log('[checkout.session.completed] One-time payment details:', {
                            sessionId,
                            userId,
                            amount: amount_total / 100,
                            currency,
                            paymentStatus: payment_status,
                            purchaseType: metadata?.purchaseType || 'unknown'
                        });
                        break;
                    }

                    // Retrieve the complete subscription object from Stripe
                    let stripeSubscription;
                    try {
                        stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
                        console.log('checkout.session.completed event data:', stripeSubscription);
                    } catch (subscriptionError) {
                        console.error(`[stripeRoutes.js] Failed to retrieve subscription ${subscriptionId}:`, subscriptionError.message);
                        // Log the error but don't fail the webhook - this could be a temporary Stripe issue
                        console.log('[stripeRoutes.js] Webhook will continue processing other events');
                        break;
                    }

                    // Compute current period dates
                    let startUnix =
                        stripeSubscription.current_period_start || stripeSubscription.start_date;
                    let endUnix = stripeSubscription.current_period_end;
                    if (!endUnix && startUnix) {
                        // Fallback computation based on plan interval if needed
                        const subscriptionItem = stripeSubscription.items.data[0];
                        const recurring = subscriptionItem.price.recurring;
                        const interval = recurring?.interval || 'month';
                        const intervalCount = recurring?.interval_count || 1;
                        let startDate = new Date(startUnix * 1000);
                        if (interval === 'year') {
                            startDate.setFullYear(startDate.getFullYear() + intervalCount);
                        } else if (interval === 'month') {
                            startDate.setMonth(startDate.getMonth() + intervalCount);
                        } else if (interval === 'week') {
                            startDate.setDate(startDate.getDate() + 7 * intervalCount);
                        } else if (interval === 'day') {
                            startDate.setDate(startDate.getDate() + intervalCount);
                        } else {
                            // Fallback: add 30 days
                            startDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);
                        }
                        endUnix = Math.floor(startDate.getTime() / 1000);
                    }

                    // Convert Unix timestamps to US-formatted date strings
                    const currentPeriodStartFormatted = new Date(startUnix * 1000).toLocaleString('en-US');
                    const currentPeriodEndFormatted = new Date(endUnix * 1000).toLocaleString('en-US');

                    // Retrieve plan details from subscription items
                    const price = stripeSubscription.items.data[0]?.price;
                    const product = price && (await stripe.products.retrieve(price.product));
                    const planName = (product && product.name) || price.nickname || 'Unknown Plan';

                    // Build a comprehensive data object to store—all fields as desired
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
                        // Add any additional metadata if necessary (e.g., discount details, custom fields, etc.)
                        metadata: stripeSubscription.metadata
                    };

                    console.log('[checkout.session.completed] Raw Stripe period dates:', {
                        current_period_start: startUnix,
                        current_period_end: endUnix,
                        subscriptionId: stripeSubscription.id,
                        customerId: customer,
                        eventId: event.id
                    });

                    try {
                        await Subscription.create(subscriptionData);
                        console.log(`[stripeRoutes.js] Subscription stored for user ${userId}`);
                    } catch (dbError) {
                        console.error('[stripeRoutes.js] Database save error:', dbError);
                        // Continue processing even if database save fails.
                    }
                    break;
                }

                // In your invoice.payment_succeeded and customer.subscription.updated cases,
                // you can likewise extract additional fields from the event data and update your document.
                // For example, for invoice.payment_succeeded you could extract:
                // - The invoice's effective period (start and end)
                // - The hosted_invoice_url
                // - Payment details from the invoice lines.
                // And then update the Subscription record accordingly.
                case 'invoice.payment_succeeded': {
                    const invoice = event.data.object;
                    const subscriptionId = invoice.subscription;
                    if (subscriptionId) {
                        await connectToMongoDB();

                        const lineItem = invoice.lines.data[0];
                        let startUnix = lineItem?.period?.start;
                        let endUnix = lineItem?.period?.end;
                        const currentPeriodStartFormatted = startUnix
                            ? new Date(startUnix * 1000).toLocaleString('en-US')
                            : new Date().toLocaleString('en-US');
                        const currentPeriodEndFormatted = endUnix
                            ? new Date(endUnix * 1000).toLocaleString('en-US')
                            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleString('en-US');

                        try {
                            await Subscription.updateOne(
                                { subscriptionId },
                                {
                                    paymentStatus: 'paid',
                                    currentPeriodStart: currentPeriodStartFormatted,
                                    currentPeriodEnd: currentPeriodEndFormatted,
                                    // You might also store invoice-related data here:
                                    lastInvoice: invoice.id,
                                    hostedInvoiceUrl: invoice.hosted_invoice_url
                                }
                            );
                            console.log(`[stripeRoutes.js] Updated subscription ${subscriptionId} for paid invoice`);
                        } catch (dbError) {
                            console.error('[stripeRoutes.js] Database update error:', dbError);
                        }
                    }
                    break;
                }

                // Other event types remain similar – extend them as needed:
                case 'customer.subscription.updated': {
                    // Extract and update additional fields as shown above.
                    // ...
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
                                        refundDate: new Date(refund.created * 1000)
                                    }
                                }
                            );
                            console.log(`[stripeRoutes.js] Refund recorded for subscription ${subscriptionId}`);
                        }
                    }
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
        const { userId, domainName, unitPrice, currency } = req.body;
        console.log('Domain checkout request received:', {
            userId: userId,
            domainName: domainName,
            unitPrice: unitPrice,
            currency: currency,
            timestamp: new Date().toISOString()
        });
        // Validate inputs
        if (!userId || !domainName || !unitPrice) {
            return res.status(400).json({ error: 'userId, domainName, and unitPrice are required' });
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

        // Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment', // One-time payment (not subscription)
            line_items: [{
                price_data: {
                    currency: currency || 'usd',
                    product: product.id,
                    unit_amount: Math.round(price * 100), // Convert to cents
                },
                quantity: 1,
            }],
            success_url: 'http://localhost:4200/success?session_id={CHECKOUT_SESSION_ID}',
            cancel_url: 'http://localhost:4200/cancel',
            metadata: { userId, domainName, purchaseType: 'domain' }
        });

        res.json({ url: session.url, sessionId: session.id });

    } catch (err) {
        console.error("Stripe error:", err);
        res.status(500).json({ error: "Payment failed. Please try again." });
    }
});

// Get Subscription Details from Checkout Session ID
router.post('/get-subscription-from-session', async (req, res) => {
    const { sessionId } = req.body;

    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }

    try {
        console.log('[get-subscription-from-session] Retrieving session:', sessionId);

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
            } else {
                // Generic one-time payment
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
                    interval: interval
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
        res.json(response);

    } catch (error) {
        console.error("Error in get-subscription-from-session:", error);

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
                    status: stripeSub.status,
                    plan: {
                        id: price.id,
                        name: product.name || price.nickname || 'Standard Plan',
                        amount: price.unit_amount / 100,
                        currency: price.currency,
                        interval: price.recurring
                            ? `${price.recurring.interval_count} ${price.recurring.interval}`
                            : 'one-time'
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
    // Extract customerId and subscriptionId (if available) from the body
    const { customerId, subscriptionId, userId } = req.body;

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

        // Retrieve upcoming invoice details to show additional proration/credit info
        // Note: subscriptionId is helpful here; if not provided, you may try to retrieve it from your subscriptionRecord.
        let upcomingInvoice = null;
        if (subscriptionId) {
            upcomingInvoice = await stripe.invoices.retrieveUpcoming({
                customer: customerId,
                subscription: subscriptionId,
            });
        } else {
            // Optional: If subscriptionId is not provided, you could retrieve the latest subscription record 
            // and use its subscriptionId field (if available)
            console.warn('Subscription ID not provided; skipping upcoming invoice retrieval');
        }

        // Respond with both the portal session URL and the upcoming invoice details.
        res.json({
            url: portalSession.url,
            upcomingInvoice  // This object contains line items, amount_due, credits, etc.
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

// Simple domain checkout with contact info in metadata
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

        console.log('Simple domain checkout request received:', {
            userId,
            domainName,
            unitPrice,
            currency,
            hasContactInfo: !!(firstName && lastName && email),
            timestamp: new Date().toISOString()
        });

        // Validate inputs
        if (!userId || !domainName || !unitPrice) {
            return res.status(400).json({
                error: 'userId, domainName, and unitPrice are required'
            });
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
            metadata: {
                type: 'domain',
                userId,
                domainName
            }
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

        // Create Stripe Checkout Session with success URL that will handle registration
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            line_items: [{
                price_data: {
                    currency: currency || 'usd',
                    product: product.id,
                    unit_amount: Math.round(price * 100),
                },
                quantity: 1,
            }],
            success_url: `http://localhost:4200/domain-success?session_id={CHECKOUT_SESSION_ID}&domain=${encodeURIComponent(domainName)}`,
            cancel_url: 'http://localhost:4200/cancel',
            metadata: metadata,
            customer_creation: 'always'
        });

        res.json({
            url: session.url,
            sessionId: session.id,
            message: 'Checkout session created. Call /domain/process-success-payment after successful payment to register domain.'
        });

    } catch (err) {
        console.error("Simple domain checkout error:", err);
        res.status(500).json({ error: "Payment setup failed. Please try again." });
    }
});

// Process successful payment and register domain
router.post('/domain/process-success-payment', async (req, res) => {
    try {
        const { sessionId, userId } = req.body;

        console.log('Processing successful domain payment:', {
            sessionId,
            userId,
            timestamp: new Date().toISOString()
        });

        // Validate required fields
        if (!sessionId || !userId) {
            return res.status(400).json({
                success: false,
                error: 'sessionId and userId are required'
            });
        }

        // Step 1: Verify payment was successful
        console.log('Step 1: Verifying payment status...');
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['line_items', 'customer']
        });

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Payment session not found'
            });
        }

        // Check if payment was successful
        if (session.payment_status !== 'paid') {
            return res.status(400).json({
                success: false,
                error: 'Payment not completed',
                paymentStatus: session.payment_status,
                sessionStatus: session.status
            });
        }

        // Verify this is a domain purchase
        const isDomainPurchase = session.metadata?.purchaseType === 'domain';

        if (!isDomainPurchase) {
            return res.status(400).json({
                success: false,
                error: 'This session is not a domain purchase'
            });
        }

        // Verify user matches
        if (session.metadata?.userId !== userId) {
            return res.status(400).json({
                success: false,
                error: 'User ID mismatch'
            });
        }

        console.log('Step 1 Complete: Payment verified successfully');

        // Step 2: Extract contact information from session metadata
        const domainName = session.metadata.domainName;
        const contactInfo = {
            firstName: session.metadata.firstName,
            lastName: session.metadata.lastName,
            email: session.metadata.email,
            phone: session.metadata.phone,
            address1: session.metadata.address1,
            address2: session.metadata.address2 || '',
            city: session.metadata.city,
            stateProvince: session.metadata.stateProvince,
            country: session.metadata.country,
            postalCode: session.metadata.postalCode
        };

        // Step 3: Register domain with Namecheap
        console.log('Step 2: Registering domain with Namecheap...');

        try {
            // Prepare Stripe payment information for database storage
            const stripePaymentInfo = {
                sessionId: session.id,
                subscriptionId: session.subscription,
                hostedInvoiceUrl: session.hosted_invoice_url,
                invoicePdf: session.invoice_pdf,
                paymentIntentId: session.payment_intent,
                customerId: typeof session.customer === 'object' ? session.customer.id : session.customer,
                paymentStatus: session.payment_status,
                amountPaid: session.amount_total / 100,
                currency: session.currency,
                paymentMethod: session.payment_method_types?.[0] || 'card',
                paymentDate: new Date(session.created * 1000),
                receiptUrl: session.receipt_email ? `Receipt sent to ${session.receipt_email}` : null,
                invoiceId: session.invoice
            };

            // Call the domain registration function
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

            console.log('Step 2 Complete: Domain registered successfully');

            // Step 4: Prepare comprehensive response
            const paymentDetails = {
                sessionId: session.id,
                status: session.status,
                paymentStatus: session.payment_status,
                amount: session.amount_total / 100,
                currency: session.currency,
                customer: {
                    id: typeof session.customer === 'object' ? session.customer.id : session.customer,
                    email: typeof session.customer === 'object' ? session.customer.email : session.customer_details?.email || null,
                    name: typeof session.customer === 'object' ? session.customer.name : session.customer_details?.name || null
                },
                createdAt: new Date(session.created * 1000).toISOString(),
                paymentMethod: session.payment_method_types?.[0] || 'card'
            };

            // Return combined response
            res.json({
                success: true,
                message: 'Domain purchased and registered successfully',
                data: {
                    payment: paymentDetails,
                    registration: registrationResult,
                    domain: domainName,
                    userId: userId,
                    combinedRecord: {
                        stripePaymentStored: true,
                        domainRegistered: true,
                        databaseRecordId: registrationResult.data?.databaseRecord?._id
                    }
                },
                timestamp: new Date().toISOString()
            });

        } catch (namecheapError) {
            console.error('Namecheap registration failed:', namecheapError.message);

            if (namecheapError.isHtmlResponse) {
                return res.status(502).json({
                    success: false,
                    error: 'Namecheap API returned an unexpected HTML response',
                    details: namecheapError.message,
                    recoveryOptions: [
                        'Check Namecheap API status page for outages',
                        'Retry after a few minutes',
                        'Check your API credentials and IP whitelist',
                        'Contact support if the issue persists'
                    ],
                    timestamp: new Date().toISOString()
                });
            }

            return res.status(500).json({
                success: false,
                error: 'Domain registration failed after successful payment',
                paymentDetails: {
                    sessionId: session.id,
                    status: session.status,
                    paymentStatus: session.payment_status,
                    amount: session.amount_total / 100,
                    currency: session.currency
                },
                registrationError: {
                    message: namecheapError.message
                },
                nextSteps: [
                    'Contact support for manual domain registration',
                    'Payment was successful and recorded in Stripe'
                ]
            });
        }

    } catch (error) {
        console.error('Domain success processing error:', error);
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

// Updated endpoint for app-specific success/cancel URLs (no custom URLs, new app names)
router.post('/create-checkout-session-by-app', async (req, res) => {
    try {
        const { userId, priceId, app } = req.body;

        // Map app names to their base URLs
        const appUrlMap = {
            kampaignai: 'http://localhost:4200',
            gps: 'https://gps.onepgr.com',
            getsalesgpt: 'https://sales.onepgr.com',
        };

        // Determine URLs
        let successUrl, cancelUrl;
        if (app && appUrlMap[app]) {
            successUrl = `${appUrlMap[app]}/success?session_id={CHECKOUT_SESSION_ID}`;
            cancelUrl = `${appUrlMap[app]}/cancel`;
        } else {
            if (!app || !appUrlMap[app]) {
                return res.status(400).json({ error: 'Invalid or missing app parameter' });
            }
        }

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: { userId, app }
        });

        res.json({ url: session.url });
    } catch (err) {
        console.error("Stripe error (by-app):", {
            statusCode: err.statusCode,
            code: err.code,
            message: err.message,
            request_log_url: err.request_log_url
        });
        return res
            .status(err.statusCode || 500)
            .json({ error: err.message });
    }
});

//________________fetcing billing history API________________________



module.exports = router;