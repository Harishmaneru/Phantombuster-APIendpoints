const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Import domain registration function from Namecheap API
const { registerDomainWithNamecheap } = require('../domainManagementAPI/nameCheapDomainApi');

// Import simple file logging system
// const fileLogger = require('../loggingSystem/fileLogger');

// Middleware to parse JSON for all routes except /webhook
router.use((req, res, next) => {
    if (req.originalUrl === '/api/stripe-sandbox/webhook') {
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
            dbName: 'onepgr_apps'
        });
        console.log('Connected to MongoDB onepgr_apps database');
    } catch (error) {
        console.error('MongoDB connection error:', error);
    }
};

// Helper function to get Stripe instance based on sandbox flag
const getStripeInstance = (isSandbox = false) => {
    if (isSandbox) {
        const stripe = require('stripe')(process.env.STRIPE_SANDBOX_SECRET_KEY);
        console.log('�� Using SANDBOX Stripe instance');
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

// Get models from mongoose (they're already defined in stripeRoutes.js)
const Subscription = mongoose.model('Subscription');
const Customer = mongoose.model('Customer');

// ============================================================================
// SANDBOX ENDPOINTS - MIRRORING PRODUCTION
// ============================================================================

// 1. Get Subscription from Session
router.post('/get-subscription-from-session', async (req, res) => {
    try {
        const { sessionId } = req.body;
        const isSandbox = isSandboxMode(req);
        const stripe = getStripeInstance();

        console.log(`[SANDBOX:${isSandbox}] get-subscription-from-session called for session:`, sessionId);

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        // Retrieve the session with expanded subscription data
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['subscription', 'customer', 'line_items']
        });

        console.log(`[SANDBOX:${isSandbox}] Session retrieved:`, {
            id: session.id,
            status: session.status,
            payment_status: session.payment_status,
            mode: session.mode,
            hasSubscription: !!session.subscription
        });

        // Check if this is a subscription or one-time payment
        if (session.mode === 'payment') {
            console.log(`[SANDBOX:${isSandbox}] One-time payment detected`);
            
            const isDomainPurchase = session.metadata?.purchaseType === 'domain' ||
                session.metadata?.purchaseType === 'domain_registration';

            if (isDomainPurchase) {
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
                        enablePrivacy: session.metadata.enablePrivacy === 'true'
                    },
                    customer: {
                        firstName: session.metadata.firstName,
                        lastName: session.metadata.lastName,
                        email: session.metadata.email,
                        phone: session.metadata.phone
                    },
                    userId: session.metadata.userId,
                    message: 'This is a domain purchase.',
                    sandbox: isSandbox
                });
            } else {
                return res.status(400).json({
                    error: 'This session is for a one-time payment, not a subscription',
                    sessionType: 'one-time-payment',
                    sandbox: isSandbox
                });
            }
        }

        if (!session.subscription) {
            return res.status(404).json({
                error: 'No subscription found in this session',
                sessionData: {
                    id: session.id,
                    status: session.status,
                    paymentStatus: session.payment_status,
                    mode: session.mode,
                    metadata: session.metadata
                },
                sandbox: isSandbox
            });
        }

        // Retrieve the subscription with expanded price and product data
        const subscription = await stripe.subscriptions.retrieve(session.subscription.id, {
            expand: ['items.data.price.product', 'customer']
        });

        // Get price and product details
        const priceData = subscription.items.data[0]?.price;
        if (!priceData) {
            return res.status(404).json({ error: 'No price data found in subscription' });
        }

        const productData = priceData.product;
        const interval = priceData.recurring ? 
            `${priceData.recurring.interval_count} ${priceData.recurring.interval}` : 'one-time';

        // Build response
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
                    nextBillingDate: subscription.current_period_end ? 
                        new Date(subscription.current_period_end * 1000).toISOString() : null,
                    currentPeriodStart: subscription.current_period_start ? 
                        new Date(subscription.current_period_start * 1000).toISOString() : null,
                    currentPeriodEnd: subscription.current_period_end ? 
                        new Date(subscription.current_period_end * 1000).toISOString() : null,
                    cancelAtPeriodEnd: subscription.cancel_at_period_end || false
                },
                customer: subscription.customer ? {
                    id: typeof subscription.customer === 'object' ? 
                        subscription.customer.id : subscription.customer,
                    email: typeof subscription.customer === 'object' ? 
                        subscription.customer.email : null,
                    name: typeof subscription.customer === 'object' ? 
                        subscription.customer.name : null
                } : null,
                createdAt: subscription.created ? 
                    new Date(subscription.created * 1000).toISOString() : null
            },
            sandbox: isSandbox
        };

        res.json(response);

    } catch (error) {
        console.error(`[SANDBOX] Error in get-subscription-from-session:`, error);
        
        if (error.type === 'StripeInvalidRequestError') {
            if (error.message.includes('No such checkout.session')) {
                return res.status(404).json({
                    error: 'Session not found',
                    details: 'The provided session ID does not exist in Stripe',
                    sandbox: isSandboxMode(req)
                });
            }
            return res.status(404).json({
                error: 'Session or subscription not found',
                details: error.message,
                sandbox: isSandboxMode(req)
            });
        }

        res.status(500).json({
            error: error.message || "Failed to fetch subscription",
            sandbox: isSandboxMode(req)
        });
    }
});

// 2. Create Billing Portal Session
router.post('/create-billing-portal-session', async (req, res) => {
    try {
        const { customerId, userId } = req.body;
        const isSandbox = isSandboxMode(req);
        const stripe = getStripeInstance();

        console.log(`[SANDBOX:${isSandbox}] create-billing-portal-session called for customer:`, customerId);

        await connectToMongoDB();

        // Verify that the customer exists in your database
        const subscriptionRecord = await Subscription.findOne({ customerId });
        if (!subscriptionRecord && userId) {
            console.log(`[SANDBOX:${isSandbox}] Warning: Creating portal for customer ${customerId} not in our database`);
        }

        // Create a Billing Portal session
        const portalSession = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: 'https://record.onepgr.com/profile',
        });

        res.json({
            url: portalSession.url,
            sandbox: isSandbox
        });
    } catch (error) {
        console.error(`[SANDBOX] Error creating billing portal session:`, error.message);
        res.status(500).json({ 
            error: error.message,
            sandbox: isSandboxMode(req)
        });
    }
});

// 3. Create Checkout Session by App
router.post('/create-checkout-session-by-app', async (req, res) => {
    try {
        const { userId, priceId, app, quantity = 1 } = req.body;
        const isSandbox = isSandboxMode(req);
        const stripe = getStripeInstance();

        console.log(`[SANDBOX:${isSandbox}] create-checkout-session-by-app called for user:`, userId, 'app:', app);

        // App URL map + validation
        const appUrlMap = {
            // kampaignai: 'https://kampaign.onepgr.com',
            kampaignai: 'http://localhost:4200',
            gps: 'https://gps.onepgr.com',
            getsalesgpt: 'https://sales.onepgr.com',
        };

        if (!app || !appUrlMap[app]) {
            return res.status(400).json({ error: 'Invalid or missing app parameter' });
        }
        if (!priceId) {
            return res.status(400).json({ error: 'Missing priceId' });
        }
        if (!quantity || quantity < 1) {
            return res.status(400).json({ error: 'Quantity must be at least 1' });
        }

        await connectToMongoDB();

        // Find or create customer record for user
        let customerRecord = await Customer.findOne({ userId });
        let customerId;

        if (!customerRecord) {
            console.log(`[SANDBOX:${isSandbox}] No customer record found for user ${userId} - will create new customer during checkout`);

            try {
                const customer = await stripe.customers.create({
                    email: `user-${userId}@onepgr.com`,
                    metadata: {
                        userId,
                        app,
                        createdVia: 'subscription_checkout',
                        createdAt: new Date().toISOString()
                    }
                });
                customerId = customer.id;

                await Customer.updateOne(
                    { userId },
                    {
                        $set: {
                            customerId: customer.id,
                            app: app,
                            email: `user-${userId}@onepgr.com`,
                            createdAt: new Date()
                        }
                    },
                    { upsert: true }
                );

                console.log(`[SANDBOX:${isSandbox}] 🆕 Created new customer ${customerId} for user ${userId}`);
            } catch (customerError) {
                console.error(`[SANDBOX:${isSandbox}] Error creating customer for user ${userId}:`, customerError);
                customerId = null;
            }
        } else {
            customerId = customerRecord.customerId;
            console.log(`[SANDBOX:${isSandbox}] ✅ Found existing customer ${customerId} for user ${userId}`);
        }

        // Create Checkout session
        const sessionPayload = {
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [{ price: priceId, quantity }],
            success_url: `${appUrlMap[app]}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${appUrlMap[app]}/cancel`,
            metadata: { userId, app, sandbox: isSandbox },
            allow_promotion_codes: true,
        };

        if (customerId) {
            sessionPayload.customer = customerId;
            console.log(`[SANDBOX:${isSandbox}] �� Attaching existing customer ${customerId} to checkout session`);
        }

        const session = await stripe.checkout.sessions.create(sessionPayload);

        // Store checkout session info for tracking
        if (customerId) {
            await Customer.updateOne(
                { userId },
                { $set: { lastCheckoutSessionId: session.id } }
            );
        }

        return res.json({
            mode: 'checkout',
            url: session.url,
            sandbox: isSandbox
        });
    } catch (err) {
        console.error(`[SANDBOX] Stripe error:`, err);
        res.status(500).json({ 
            error: err.message,
            sandbox: isSandboxMode(req)
        });
    }
});

// 4. Create Billing Portal Session by App
router.post('/create-billing-portal-session-by-app', async (req, res) => {
    try {
        const { customerId, userId, app } = req.body;
        const isSandbox = isSandboxMode(req);
        const stripe = getStripeInstance();

        console.log(`[SANDBOX:${isSandbox}] create-billing-portal-session-by-app called for customer:`, customerId);

        await connectToMongoDB();

        // Verify that the customer exists in your database
        const subscriptionRecord = await Subscription.findOne({ customerId });
        if (!subscriptionRecord && userId) {
            console.log(`[SANDBOX:${isSandbox}] Warning: Creating portal for customer ${customerId} not in our database`);
        }

        // Map app names to their base URLs
        const appUrlMap = {
            // kampaignai: 'https://kampaign.onepgr.com',
            kampaignai: 'http://localhost:4200',
            gps: 'https://gps.onepgr.com',
            getsalesgpt: 'https://sales.onepgr.com',
        };

        // Determine return URL based on app type
        let returnUrl;
        if (app && appUrlMap[app]) {
            returnUrl = `${appUrlMap[app]}/profile`;
        }

        // Create a Billing Portal session
        const portalSession = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl,
        });

        res.json({
            url: portalSession.url,
            app: app || 'default',
            returnUrl: returnUrl,
            sandbox: isSandbox
        });
    } catch (error) {
        console.error(`[SANDBOX] Error creating billing portal session:`, error.message);
        res.status(500).json({ 
            error: error.message,
            sandbox: isSandboxMode(req)
        });
    }
});

// 5. Get Subscription Info by App
router.post('/get-subscription-info-by-app', async (req, res) => {
    try {
        const { userId, app, features = [] } = req.body;
        const isSandbox = isSandboxMode(req);
        const stripe = getStripeInstance();

        console.log(`[SANDBOX:${isSandbox}] get-subscription-info-by-app called for user:`, userId, 'app:', app);

        await connectToMongoDB();

        // Find customer record for this user
        const customerRecord = await Customer.findOne({ userId });
        if (!customerRecord) {
            return res.status(200).json({
                error: 'No customer found for this user',
                hasCustomer: false,
                message: 'User has not added any payment methods yet',
                sandbox: isSandbox
            });
        }

        const customerId = customerRecord.customerId;
        let result = { sandbox: isSandbox };

        // 1️⃣ Saved Cards
        if (features.includes('cards')) {
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
                // kampaignai: 'https://kampaign.onepgr.com',
                kampaignai: 'http://localhost:4200',
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
        console.error(`[SANDBOX] Error fetching subscription info:`, err);
        res.status(500).json({ 
            error: err.message,
            sandbox: isSandboxMode(req)
        });
    }
});

// 6. Get User Payment Info
router.post('/get-user-payment-info', async (req, res) => {
    try {
        const { userId, features } = req.body;
        const isSandbox = isSandboxMode(req);
        const stripe = getStripeInstance();

        console.log(`[SANDBOX:${isSandbox}] get-user-payment-info called for user:`, userId);

        if (!userId || !features || !Array.isArray(features)) {
            return res.status(400).json({ 
                error: 'Missing required parameters: userId and features array',
                sandbox: isSandbox
            });
        }

        await connectToMongoDB();

        // Find customer record for this user
        const customerRecord = await Customer.findOne({ userId });
        if (!customerRecord) {
            return res.status(200).json({
                error: 'No customer found for this user',
                hasCustomer: false,
                message: 'User has not added any payment methods yet',
                sandbox: isSandbox
            });
        }

        const customerId = customerRecord.customerId;
        let response = {
            customerId: customerId,
            userId: userId,
            sandbox: isSandbox
        };

        // Fetch customer & active subscriptions
        const customer = await stripe.customers.retrieve(customerId);
        let subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            status: 'active',
            limit: 100,
            expand: ['data.latest_invoice', 'data.default_payment_method']
        });

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

        // Get the primary subscription
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
            const customerInvoices = await stripe.invoices.list({
                customer: customerId,
                limit: 10,
                status: 'paid'
            });

            response.billingHistory = customerInvoices.data.map(inv => ({
                id: inv.id,
                amount: inv.amount_paid / 100,
                currency: inv.currency.toUpperCase(),
                status: inv.status,
                date: formatStripeDate(inv.created),
                invoiceUrl: inv.hosted_invoice_url,
                description: inv.lines?.data[0]?.description || 'Subscription payment'
            }));
        }

        // 📅 Next Billing + Subscription Info
        if (features.includes("nextBilling") || features.includes("subscription")) {
            if (primarySub) {
                const plan = primarySub.items.data[0].price;

                response.nextBilling = {
                    status: primarySub.status,
                    nextPaymentDate: formatStripeDate(primarySub.current_period_end),
                    nextPaymentAmount: (plan.unit_amount / 100) * (primarySub.items.data[0].quantity || 1),
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
                    currentPeriodEnd: formatStripeDate(primarySub.current_period_end),
                    currentPeriodStart: formatStripeDate(primarySub.current_period_start),
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

                        return {
                            subscriptionId: sub.id,
                            customerId: customerId,
                            status: sub.status,
                            startDate: formatStripeDate(sub.start_date),
                            currentPeriodStart: formatStripeDate(sub.current_period_start),
                            currentPeriodEnd: formatStripeDate(sub.current_period_end),
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
                totalMonthlyAmount: Math.round(totalMonthlyAmount * 100) / 100,
                currency: subscriptions.data[0]?.items.data[0]?.price.currency?.toUpperCase() || 'USD'
            };
        }

        res.json(response);

    } catch (err) {
        console.error(`[SANDBOX] Error fetching user payment info:`, err);
        res.status(200).json({
            message: err.message,
            sandbox: isSandboxMode(req)
        });
    }
});

// ============================================================================
// ADDITIONAL SANDBOX-ONLY ENDPOINTS FOR TESTING
// ============================================================================

// Test endpoint to verify sandbox mode
router.get('/test-sandbox', (req, res) => {
    const isSandbox = isSandboxMode(req);
    res.json({
        message: 'Sandbox Stripe API is working!',
        sandbox: isSandbox,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Sandbox webhook endpoint (for testing webhook events)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_SANBOX_WEBHOOK_SECRET;
    const isSandbox = true; // This endpoint is always sandbox
    const stripe = getStripeInstance();

    console.log('[SANDBOX] Webhook received:', req.body.toString());

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        console.log('[SANDBOX] Webhook verified:', event.id, event.type);
    } catch (err) {
        console.error('[SANDBOX] Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        // Handle webhook events for sandbox testing
        switch (event.type) {
            case 'checkout.session.completed':
                console.log('[SANDBOX] Checkout session completed:', event.data.object.id);
                break;
            case 'customer.subscription.created':
                console.log('[SANDBOX] Subscription created:', event.data.object.id);
                break;
            case 'invoice.payment_succeeded':
                console.log('[SANDBOX] Invoice payment succeeded:', event.data.object.id);
                break;
            default:
                console.log(`[SANDBOX] Unhandled event type: ${event.type}`);
        }

        res.json({ received: true, message: 'Sandbox webhook processed successfully' });
    } catch (error) {
        console.error('[SANDBOX] Webhook Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// EXPORT ROUTER
// ============================================================================

module.exports = router;