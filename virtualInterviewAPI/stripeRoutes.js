const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const mongoose = require('mongoose');

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

                    // Retrieve the complete subscription object from Stripe
                    const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
                    console.log('checkout.session.completed event data:', stripeSubscription);

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
            successUrl = 'https://virtual-interview-qgvo2.vercel.app/success?session_id={CHECKOUT_SESSION_ID}';
        }
        else {
            successUrl = 'http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}';
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


// Get Subscription Details from Checkout Session ID
router.post('/get-subscription-from-session', async (req, res) => {
    const { sessionId } = req.body;

    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }

    try {
        // Retrieve the session with expanded subscription data
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['subscription', 'customer']
        });

        if (!session || !session.subscription) {
            return res.status(404).json({ error: 'No subscription found in this session' });
        }

        // Retrieve the subscription with expanded price and product data
        const subscription = await stripe.subscriptions.retrieve(session.subscription.id, {
            expand: ['items.data.price.product', 'customer']
        });

        console.log('[stripeRoutes.js] subscription', JSON.stringify(subscription, null, 2));

        // Check for credit notes (refunds)
        let refundInfo = null;
        try {
            const invoices = await stripe.invoices.list({
                subscription: subscription.id,
                limit: 1
            });

            if (invoices.data.length > 0) {
                const creditNotes = await stripe.creditNotes.list({
                    invoice: invoices.data[0].id
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

        // Safe date formatting
        const nextBillingDate = safeFormatDate(subscription.current_period_end);
        const currentPeriodStart = safeFormatDate(subscription.current_period_start);
        const currentPeriodEnd = safeFormatDate(subscription.current_period_end);
        const trialEnd = safeFormatDate(subscription.trial_end);
        const createdAt = safeFormatDate(subscription.created);

        // Build comprehensive response with safe null checks
        res.json({
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
                    trialEnd: trialEnd?.iso || null
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
                createdAt: createdAt?.iso || null
            }
        });
    } catch (error) {
        console.error("Error in get-subscription-from-session:", error);
        if (error.type === 'StripeInvalidRequestError') {
            return res.status(404).json({ error: 'Session or subscription not found' });
        }
        res.status(500).json({ error: error.message || "Failed to fetch subscription" });
    }
});



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

// webhook status
router.get('/webhook-status', async (req, res) => {
    try {
        // Get webhook endpoints from Stripe
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

        // Get recent webhook events
        const events = await stripe.events.list({
            limit: 5,
            type: 'webhook.*'
        });

        res.json({
            status: 'active',
            webhook: {
                id: ourWebhook.id,
                url: ourWebhook.url,
                status: ourWebhook.status,
                enabled_events: ourWebhook.enabled_events,
                created: new Date(ourWebhook.created * 1000).toISOString()
            },
            recent_events: events.data.map(event => ({
                id: event.id,
                type: event.type,
                created: new Date(event.created * 1000).toISOString(),
                status: event.data.object.status
            }))
        });
    } catch (error) {
        console.error('Error checking webhook status:', error);
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

module.exports = router;