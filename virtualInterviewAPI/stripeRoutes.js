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
    createdAt: { type: Date, default: Date.now }
}, { collection: 'user_subscriptions' });


const Subscription = mongoose.model('Subscription', subscriptionSchema);

// Webhook to capture customerId and subscriptionId
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    // Verify and parse the webhook event
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        console.log(`Customer: ${customerId}, Subscription: ${subscriptionId}`);

        // Get user ID from metadata
        const userId = session.metadata.userId;
        const subscriptionStatus = session.status || 'active';

        try {
            // Connect to MongoDB
            await connectToMongoDB();

            // Store subscription details in the database
            const subscription = new Subscription({
                userId,
                customerId,
                subscriptionId,
                status: subscriptionStatus
            });

            await subscription.save();
            console.log(`Subscription stored in MongoDB for user ${userId}`);
        } catch (error) {
            console.error('Error storing subscription data:', error);
        }
    }
    res.json({ received: true });
});

// Get Subscription Details
router.post('/get-subscription', async (req, res) => {
    // Fetch subscription details for the profile section
    const { subscriptionId, userId } = req.body;

    try {
        // Connect to MongoDB
        await connectToMongoDB();

        // First check if we have this subscription in our database
        const subscriptionRecord = await Subscription.findOne({ subscriptionId });

        if (!subscriptionRecord) {
            return res.status(404).json({ error: 'Subscription not found' });
        }

        // Then get detailed information from Stripe
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);

        res.json({
            plan: subscription.items.data[0].price.nickname || 'Unknown Plan',
            status: subscription.status,
            amount: subscription.items.data[0].price.unit_amount / 100,
            nextBillingDate: new Date(subscription.current_period_end * 1000).toDateString(),
            // Include database record data
            userId: subscriptionRecord.userId,
            customerId: subscriptionRecord.customerId,
            createdAt: subscriptionRecord.createdAt
        });
    } catch (error) {
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
    const { subscriptionId, subscriptionItemId, newPriceId } = req.body;
  
    try {
      const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
        items: [
          {
            id: subscriptionItemId,
            price: newPriceId
          }
        ],
        proration_behavior: 'create_prorations' // or 'always_invoice' to charge immediately
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