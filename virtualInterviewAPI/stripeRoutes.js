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
            useNewUrlParser: true,
            useUnifiedTopology: true,
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
    createdAt: { type: Date, default: Date.now }
}, { collection: 'user_subscriptions' });


const Subscription = mongoose.model('Subscription', subscriptionSchema);

// Webhook to capture customerId and subscriptionId
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        console.log('[stripeRoutes.js] Webhook verified:', event.id, event.type);
    } catch (err) {
        console.error('[stripeRoutes.js] Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        // Handle different event types
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const { customer, subscription: subscriptionId, metadata, id: sessionId, payment_status, amount_total, currency } = session;
                const userId = metadata?.userId || 'unknown';
                const subscriptionStatus = session.status || 'active';

                await connectToMongoDB();

                const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
                const price = stripeSubscription.items.data[0]?.price;
                const product = await stripe.products.retrieve(price.product);

                const planName = product.name || price.nickname || 'Unknown Plan';

                // Improved date handling with fallbacks
                const currentPeriodStart = stripeSubscription.current_period_start
                    ? new Date(stripeSubscription.current_period_start * 1000)
                    : new Date();

                const currentPeriodEnd = stripeSubscription.current_period_end
                    ? new Date(stripeSubscription.current_period_end * 1000)
                    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

                // Log raw subscription data for debugging
                console.log('Raw Stripe subscription:', {
                    current_period_start: stripeSubscription.current_period_start,
                    current_period_end: stripeSubscription.current_period_end,
                    subscriptionId,
                    customerId: customer
                });

                try {
                    await Subscription.create({
                        userId,
                        customerId: customer,
                        subscriptionId,
                        status: subscriptionStatus,
                        sessionId,
                        amount: amount_total / 100,
                        currency,
                        paymentStatus: payment_status,
                        planName,
                        currentPeriodStart,
                        currentPeriodEnd
                    });

                    console.log(`[stripeRoutes.js] Subscription stored for user ${userId}`);
                } catch (dbError) {
                    console.error('[stripeRoutes.js] Database save error:', dbError);
                    // Continue processing - don't return here
                }
                break;
            }

            case 'invoice.payment_succeeded': {
                const invoice = event.data.object;
                const subscriptionId = invoice.subscription;

                if (subscriptionId) {
                    await connectToMongoDB();

                    try {
                        await Subscription.updateOne(
                            { subscriptionId },
                            {
                                paymentStatus: 'paid',
                                currentPeriodStart: new Date(invoice.period_start * 1000),
                                currentPeriodEnd: new Date(invoice.period_end * 1000)
                            }
                        );
                        console.log(`[stripeRoutes.js] Updated subscription ${subscriptionId} for paid invoice`);
                    } catch (dbError) {
                        console.error('[stripeRoutes.js] Database update error:', dbError);
                    }
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

            case 'customer.subscription.updated': {
                const subscription = event.data.object;
                try {
                    await connectToMongoDB();
                    await Subscription.updateOne(
                        { subscriptionId: subscription.id },
                        {
                            status: subscription.status,
                            currentPeriodStart: new Date(subscription.current_period_start * 1000),
                            currentPeriodEnd: new Date(subscription.current_period_end * 1000)
                        }
                    );
                    console.log(`[stripeRoutes.js] Updated subscription ${subscription.id}`);
                } catch (dbError) {
                    console.error('[stripeRoutes.js] Database update error:', dbError);
                }
                break;
            }

            default: {
                console.log(`[stripeRoutes.js] Unhandled event type: ${event.type}`);
            }
        }

        // Single response at the end
        res.json({ received: true, message: 'Webhook processed successfully' });
    } catch (error) {
        console.error('[stripeRoutes.js] Webhook Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

router.post('/create-checkout-session', async (req, res) => {
    const { userId, priceId } = req.body;

    const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: 'https://www.recordedinterview.com/success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'https://www.recordedinterview.com/cancel',
        metadata: { userId }
    });

    res.json({ url: session.url });
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
        // console.log('session', session);
        if (!session || !session.subscription) {
            return res.status(404).json({ error: 'No subscription found in this session' });
        }

        // Retrieve the subscription with expanded price and product data
        const subscription = await stripe.subscriptions.retrieve(session.subscription.id, {
            expand: ['items.data.price.product', 'customer']
        });

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



// Get Subscription Details
router.post('/get-subscription', async (req, res) => {
    const { subscriptionId } = req.body;

    if (!subscriptionId) {
        return res.status(400).json({ error: 'subscriptionId is required' });
    }

    try {
        // Retrieve the subscription with expanded data
        const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ['items.data.price.product', 'customer']
        });

        // console.log('[stripeRoutes.js] subscription', subscription);

        if (!subscription) {
            return res.status(404).json({ error: 'Subscription not found in Stripe' });
        }

        // Extract price and product data
        const priceItem = subscription.items.data[0];
        const price = priceItem.price;
        const product = typeof price.product === 'string'
            ? { id: price.product, name: 'Unknown Product' }
            : price.product;

        // Helper function to safely convert Stripe timestamps
        const safeDateConvert = (timestamp) => {
            if (!timestamp) return null;
            const date = new Date(timestamp * 1000);
            return isNaN(date.getTime()) ? null : date.toISOString();
        };

        // Build the response object
        const response = {
            subscription: {
                id: subscription.id,
                status: subscription.status,
                plan: {
                    id: price.id,
                    name: product.name || price.nickname || 'Standard Plan',
                    description: product.description || '',
                    amount: price.unit_amount ? price.unit_amount / 100 : 0,
                    currency: price.currency,
                    interval: price.recurring ?
                        `${price.recurring.interval_count} ${price.recurring.interval}` : 'one-time'
                },
                billing: {
                    nextBillingDate: safeDateConvert(subscription.current_period_end),
                    currentPeriodStart: safeDateConvert(subscription.current_period_start),
                    currentPeriodEnd: safeDateConvert(subscription.current_period_end),
                    cancelAtPeriodEnd: subscription.cancel_at_period_end
                },
                customer: {
                    id: subscription.customer.id,
                    email: subscription.customer.email,
                    name: subscription.customer.name || ''
                },
                createdAt: safeDateConvert(subscription.created)
            }
        };

        res.json(response);
    } catch (error) {
        console.error('Error in get-subscription:', error);
        if (error.type === 'StripeInvalidRequestError') {
            return res.status(404).json({ error: 'Subscription not found' });
        }
        res.status(500).json({ error: 'Failed to retrieve subscription' });
    }
});



// Create Billing Portal Session
router.post('/create-billing-portal-session', async (req, res) => {
    // Generate a Billing Portal session for subscription management
    const { customerId, userId } = req.body;

    try {
        // Connect to MongoDB
        await connectToMongoDB();

        // Verify customer exists in our database
        const subscriptionRecord = await Subscription.findOne({ customerId });

        if (!subscriptionRecord && userId) {
            console.log(`Warning: Creating portal for customer ${customerId} not in our database`);
        }

        const portalSession = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: 'https://record.onepgr.com/profile',
        });

        res.json({ url: portalSession.url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get user's subscription by userId
router.get('/users/:userId/subscriptions', async (req, res) => {
    const { userId } = req.params;

    // Basic validation (adjust according to your ID format)
    if (!userId) {
        return res.status(400).json({ 
            error: 'userId is required'
        });
    }

    try {
        const subscriptions = await Subscription.find({ userId }).lean();

        if (!subscriptions.length) {
            return res.status(404).json({ 
                status: "-1",
                error: 'No subscriptions found',
                userId
            });
        }

        res.json({
            status: '1',
            count: subscriptions.length,
            subscriptions
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

// Helper function (define elsewhere in your utilities)
function isValidId(id) {
    return /^[a-f\d]{24}$/i.test(id); // Basic MongoDB ID format check
}
// router.post('/get-usersubscriptionfromdb', async (req, res) => {
//     const { userId } = req.body;

//     if (!userId) {
//         return res.status(400).json({ error: 'userId is required' });
//     }

//     try {
//         // Connect to MongoDB
//         await connectToMongoDB();

//         // Find all subscriptions by userId
//         const subscriptions = await Subscription.find({ userId });

//         if (!subscriptions || subscriptions.length === 0) {
//             return res.status(404).json({ error: 'No subscriptions found for this user' });
//         }

//         // Map the subscriptions to the response format with all fields
//         const subscriptionData = subscriptions.map(subscription => ({
//             userId: subscription.userId,
//             customerId: subscription.customerId,
//             subscriptionId: subscription.subscriptionId,
//             status: subscription.status,
//             sessionId: subscription.sessionId,
//             amount: subscription.amount,
//             currency: subscription.currency,
//             paymentStatus: subscription.paymentStatus,
//             planName: subscription.planName,
//             currentPeriodStart: subscription.currentPeriodStart,
//             currentPeriodEnd: subscription.currentPeriodEnd,
//             createdAt: subscription.createdAt
//         }));

//         res.json(subscriptionData);
//     } catch (error) {
//         res.status(500).json({ error: error.message });
//     }
// });

router.post('/update-subscription', async (req, res) => {
    const { subscriptionId, newPriceId } = req.body;

    try {
        // 1. Fetch current subscription from Stripe
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);

        const subscriptionItemId = subscription.items.data[0]?.id;
        if (!subscriptionItemId) {
            return res.status(400).json({ error: 'Subscription item ID not found' });
        }

        // 3. Update the subscription with new price
        const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
            items: [
                {
                    id: subscriptionItemId,
                    price: newPriceId
                }
            ],
            proration_behavior: 'create_prorations'
        });

        res.json({
            message: 'Subscription updated successfully',
            subscription: updatedSubscription
        });
    } catch (error) {
        console.error('Upgrade/Downgrade error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Get Invoice Details
router.post('/get-invoice', async (req, res) => {
    // Fetch invoice details by invoice ID or customer ID
    const { invoiceId, customerId, subscriptionId, limit = 10 } = req.body;

    try {
        // Connect to MongoDB
        await connectToMongoDB();

        // Different retrieval strategies based on what's provided
        let invoiceData;

        // Case 1: Get a specific invoice by ID
        if (invoiceId) {
            invoiceData = await stripe.invoices.retrieve(invoiceId, {
                expand: ['customer', 'subscription', 'charge', 'payment_intent']
            });

            return res.json({
                invoice: formatInvoiceResponse(invoiceData)
            });
        }

        // Case 2: Get all invoices for a subscription
        else if (subscriptionId) {
            const invoices = await stripe.invoices.list({
                subscription: subscriptionId,
                limit: limit,
                expand: ['data.customer', 'data.subscription', 'data.charge', 'data.payment_intent']
            });

            return res.json({
                invoices: invoices.data.map(invoice => formatInvoiceResponse(invoice)),
                hasMore: invoices.has_more,
                totalCount: invoices.data.length
            });
        }

        // Case 3: Get all invoices for a customer
        else if (customerId) {
            const invoices = await stripe.invoices.list({
                customer: customerId,
                limit: limit,
                expand: ['data.customer', 'data.subscription', 'data.charge', 'data.payment_intent']
            });

            return res.json({
                invoices: invoices.data.map(invoice => formatInvoiceResponse(invoice)),
                hasMore: invoices.has_more,
                totalCount: invoices.data.length
            });
        }

        // No valid parameters provided
        else {
            return res.status(400).json({
                error: 'Please provide either invoiceId, customerId, or subscriptionId'
            });
        }
    } catch (error) {
        console.error('Error in get-invoice:', error);
        if (error.type === 'StripeInvalidRequestError') {
            return res.status(404).json({ error: 'Invoice not found in Stripe' });
        }
        res.status(500).json({ error: error.message });
    }
});
function formatInvoiceResponse(invoice) {
    return {
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        amount: {
            total: invoice.total / 100,
            subtotal: invoice.subtotal / 100,
            tax: invoice.tax ? invoice.tax / 100 : 0,
            amountPaid: invoice.amount_paid / 100,
            amountDue: invoice.amount_due / 100,
            amountRemaining: invoice.amount_remaining / 100,
            currency: invoice.currency
        },
        billing: {
            invoiceDate: new Date(invoice.created * 1000).toISOString(),
            dueDate: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
            periodStart: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
            periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null
        },
        payment: {
            paid: invoice.paid,
            attemptCount: invoice.attempt_count,
            nextPaymentAttempt: invoice.next_payment_attempt ?
                new Date(invoice.next_payment_attempt * 1000).toISOString() : null,
            receiptNumber: invoice.receipt_number,
            receiptUrl: invoice.hosted_invoice_url || null,
            pdfUrl: invoice.invoice_pdf || null,
            chargeId: invoice.charge || null,
            paymentIntentId: invoice.payment_intent || null
        },
        customer: invoice.customer ? {
            id: typeof invoice.customer === 'object' ? invoice.customer.id : invoice.customer,
            name: typeof invoice.customer === 'object' ? invoice.customer.name : null,
            email: typeof invoice.customer === 'object' ? invoice.customer.email : null
        } : null,
        subscription: invoice.subscription ? {
            id: typeof invoice.subscription === 'object' ?
                invoice.subscription.id : invoice.subscription
        } : null,
        items: invoice.lines.data.map(item => ({
            id: item.id,
            description: item.description,
            amount: item.amount / 100,
            currency: invoice.currency,
            period: {
                start: item.period.start ? new Date(item.period.start * 1000).toISOString() : null,
                end: item.period.end ? new Date(item.period.end * 1000).toISOString() : null
            },
            priceId: item.price ? item.price.id : null,
            productId: item.price && item.price.product ? item.price.product : null,
            quantity: item.quantity || 1
        })),
        metadata: invoice.metadata || {}
    };
}



module.exports = router;