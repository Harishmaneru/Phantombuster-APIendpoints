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


// Get Subscription Details
router.post('/get-subscription', async (req, res) => {
    // Fetch subscription details for the profile section
    const { subscriptionId, userId } = req.body;

    if (!subscriptionId) {
        return res.status(400).json({ error: 'subscriptionId is required' });
    }

    try {
        // Connect to MongoDB
        await connectToMongoDB();

        // First try to get subscription from Stripe
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        
        if (!subscription) {
            return res.status(404).json({ error: 'Subscription not found in Stripe' });
        }

        // Then check if we have this subscription in our database
        const subscriptionRecord = await Subscription.findOne({ subscriptionId });

        // If we have a Stripe subscription but no database record, create one
        if (subscription && !subscriptionRecord) {
            try {
                // Get the price details
                const price = subscription.items.data[0]?.price;
                if (!price) {
                    throw new Error('No price information found in subscription');
                }

                // Get the product details
                const product = await stripe.products.retrieve(price.product);
                
                // Validate and convert dates
                const currentPeriodStart = new Date(subscription.current_period_start * 1000);
                const currentPeriodEnd = new Date(subscription.current_period_end * 1000);

                if (isNaN(currentPeriodStart.getTime()) || isNaN(currentPeriodEnd.getTime())) {
                    throw new Error('Invalid date values from Stripe subscription');
                }

                const newSubscription = new Subscription({
                    userId: userId,
                    customerId: subscription.customer,
                    subscriptionId: subscription.id,
                    status: subscription.status,
                    amount: price.unit_amount / 100,
                    currency: price.currency,
                    planName: product.name || 'Unknown Plan',
                    currentPeriodStart: currentPeriodStart,
                    currentPeriodEnd: currentPeriodEnd
                });

                await newSubscription.save();
                console.log('Created new subscription record in database');
            } catch (saveError) {
                console.error('Error saving subscription to database:', saveError);
                // Continue with the response even if saving to database fails
            }
        }

        // Get the latest subscription record after potential creation
        const latestSubscriptionRecord = await Subscription.findOne({ subscriptionId });

        res.json({
            plan: subscription.items.data[0].price.nickname || 'Unknown Plan',
            status: subscription.status,
            amount: subscription.items.data[0].price.unit_amount / 100,
            nextBillingDate: new Date(subscription.current_period_end * 1000).toDateString(),
            // Include database record data if it exists
            userId: latestSubscriptionRecord?.userId || userId,
            customerId: latestSubscriptionRecord?.customerId || subscription.customer,
            createdAt: latestSubscriptionRecord?.createdAt || new Date()
        });
    } catch (error) {
        console.error('Error in get-subscription:', error);
        if (error.type === 'StripeInvalidRequestError') {
            return res.status(404).json({ error: 'Subscription not found in Stripe' });
        }
        res.status(500).json({ error: error.message });
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
router.post('/get-user-subscription', async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    try {
        // Connect to MongoDB
        await connectToMongoDB();

        // Find subscription by userId
        const subscription = await Subscription.findOne({ userId });

        if (!subscription) {
            return res.status(404).json({ error: 'No subscription found for this user' });
        }

        res.json({
            userId: subscription.userId,
            customerId: subscription.customerId,
            subscriptionId: subscription.subscriptionId,
            status: subscription.status,
            createdAt: subscription.createdAt
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


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



module.exports = router;