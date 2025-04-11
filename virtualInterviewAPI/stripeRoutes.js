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
    refundAmount: { type: Number, default: 0 },
    refundDate: { type: Date, default: null },
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
                console.log('[checkout.session.completed] Stripe subscription:', stripeSubscription);
                console.log('[checkout.session.completed] Raw Stripe period dates:', {
                    current_period_start: stripeSubscription.current_period_start,
                    current_period_end: stripeSubscription.current_period_end,
                    converted_start: stripeSubscription.current_period_start ? new Date(stripeSubscription.current_period_start * 1000) : null,
                    converted_end: stripeSubscription.current_period_end ? new Date(stripeSubscription.current_period_end * 1000) : null,
                    subscriptionId: stripeSubscription.id,
                    customerId: customer,
                    eventId: event.id
                });

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

                    const currentPeriodStart = invoice.period_start ? new Date(invoice.period_start * 1000) : null;
                    const currentPeriodEnd = invoice.period_end ? new Date(invoice.period_end * 1000) : null;

                    if (!currentPeriodStart || !currentPeriodEnd || isNaN(currentPeriodStart) || isNaN(currentPeriodEnd)) {
                        console.warn('[stripeRoutes.js] Invalid invoice dates, skipping update');
                        break;
                    }

                    try {
                        await Subscription.updateOne(
                            { subscriptionId },
                            {
                                paymentStatus: 'paid',
                                currentPeriodStart,
                                currentPeriodEnd
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
                    console.log(`[stripeRoutes.js] Processing subscription update for ${subscription.id}`);

                    // Compare current vs previous attributes to detect changes
                    const previousAttributes = event.data.previous_attributes || {};

                    // Initialize update data with subscription status
                    const updateData = {
                        status: subscription.status
                    };

                    // Safely handle dates
                    if (subscription.current_period_start) {
                        const startDate = new Date(subscription.current_period_start * 1000);
                        if (!isNaN(startDate)) {
                            updateData.currentPeriodStart = startDate;
                        }
                    }

                    if (subscription.current_period_end) {
                        const endDate = new Date(subscription.current_period_end * 1000);
                        if (!isNaN(endDate)) {
                            updateData.currentPeriodEnd = endDate;
                        }
                    }

                    // Handle plan changes (upgrades/downgrades)
                    if (subscription.items && subscription.items.data && subscription.items.data.length > 0) {
                        const priceItem = subscription.items.data[0];
                        const price = priceItem.price;

                        if (price) {
                            // Check if price ID changed (indicating plan change)
                            const planChanged = previousAttributes.items ||
                                (previousAttributes.plan && previousAttributes.plan.id !== price.id);

                            // Always update amount and currency
                            if (price.unit_amount) {
                                updateData.amount = price.unit_amount / 100;
                            }

                            if (price.currency) {
                                updateData.currency = price.currency;
                            }

                            // Fetch product details for the price
                            if (price.product) {
                                try {
                                    const product = await stripe.products.retrieve(price.product);
                                    updateData.planName = product.name || price.nickname || 'Updated Plan';

                                    if (planChanged) {
                                        console.log(`[stripeRoutes.js] Plan changed for subscription ${subscription.id} to ${updateData.planName}`);

                                        // Check for credit notes (refunds) when plan changes
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
                                                    updateData.refundAmount = refund.amount / 100;
                                                    updateData.refundDate = new Date(refund.created * 1000);
                                                    updateData.paymentStatus = 'refunded';
                                                    console.log(`[stripeRoutes.js] Found credit note for subscription ${subscription.id}`);
                                                }
                                            }
                                        } catch (creditNoteError) {
                                            console.warn(`[stripeRoutes.js] Could not check credit notes: ${creditNoteError.message}`);
                                        }
                                    }
                                } catch (productError) {
                                    console.warn(`[stripeRoutes.js] Could not fetch product: ${productError.message}`);
                                    updateData.planName = price.nickname || 'Updated Plan';
                                }
                            }
                        }
                    }

                    // Update payment status if available
                    if (subscription.latest_invoice) {
                        try {
                            const invoice = await stripe.invoices.retrieve(subscription.latest_invoice);
                            updateData.paymentStatus = invoice.paid ? 'paid' : (invoice.status || 'unpaid');
                        } catch (invoiceError) {
                            console.warn(`[stripeRoutes.js] Could not fetch invoice: ${invoiceError.message}`);
                            updateData.paymentStatus = 'unknown';
                        }
                    }

                    // Find and update the subscription in the database
                    const result = await Subscription.updateOne(
                        { subscriptionId: subscription.id },
                        updateData
                    );

                    if (result.modifiedCount > 0) {
                        console.log(`[stripeRoutes.js] Successfully updated subscription ${subscription.id} in database`);
                    } else if (result.matchedCount > 0) {
                        console.log(`[stripeRoutes.js] Subscription ${subscription.id} found but no changes were needed`);
                    } else {
                        console.warn(`[stripeRoutes.js] No subscription found with ID ${subscription.id} to update`);
                    }
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

                    // Retrieve the related invoice to get subscriptionId
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
});


//     const sig = req.headers['stripe-signature'];
//     const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

//     let event;
//     try {
//         event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
//         console.log('[stripeRoutes.js] Webhook verified:', event.id, event.type);
//     } catch (err) {
//         console.error('[stripeRoutes.js] Webhook signature verification failed:', err.message);
//         return res.status(400).send(`Webhook Error: ${err.message}`);
//     }

//     try {
//         // Handle different event types
//         switch (event.type) {
//             case 'checkout.session.completed': {
//                 const session = event.data.object;
//                 const { customer, subscription: subscriptionId, metadata, id: sessionId, payment_status, amount_total, currency } = session;
//                 const userId = metadata?.userId || 'unknown';
//                 const subscriptionStatus = session.status || 'active';

//                 await connectToMongoDB();

//                 const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
//                 const price = stripeSubscription.items.data[0]?.price;
//                 const product = await stripe.products.retrieve(price.product);

//                 const planName = product.name || price.nickname || 'Unknown Plan';

//                 // Improved date handling with fallbacks
//                 const currentPeriodStart = stripeSubscription.current_period_start
//                     ? new Date(stripeSubscription.current_period_start * 1000)
//                     : new Date();

//                 const currentPeriodEnd = stripeSubscription.current_period_end
//                     ? new Date(stripeSubscription.current_period_end * 1000)
//                     : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

//                 // Log raw subscription data for debugging
//                 console.log('Raw Stripe subscription:', {
//                     current_period_start: stripeSubscription.current_period_start,
//                     current_period_end: stripeSubscription.current_period_end,
//                     subscriptionId,
//                     customerId: customer
//                 });

//                 try {
//                     await Subscription.create({
//                         userId,
//                         customerId: customer,
//                         subscriptionId,
//                         status: subscriptionStatus,
//                         sessionId,
//                         amount: amount_total / 100,
//                         currency,
//                         paymentStatus: payment_status,
//                         planName,
//                         currentPeriodStart,
//                         currentPeriodEnd
//                     });

//                     console.log(`[stripeRoutes.js] Subscription stored for user ${userId}`);
//                 } catch (dbError) {
//                     console.error('[stripeRoutes.js] Database save error:', dbError);
//                     // Continue processing - don't return here
//                 }
//                 break;
//             }

//             case 'invoice.payment_succeeded': {
//                 const invoice = event.data.object;
//                 const subscriptionId = invoice.subscription;

//                 if (subscriptionId) {
//                     await connectToMongoDB();

//                     try {
//                         await Subscription.updateOne(
//                             { subscriptionId },
//                             {
//                                 paymentStatus: 'paid',
//                                 currentPeriodStart: new Date(invoice.period_start * 1000),
//                                 currentPeriodEnd: new Date(invoice.period_end * 1000)
//                             }
//                         );
//                         console.log(`[stripeRoutes.js] Updated subscription ${subscriptionId} for paid invoice`);
//                     } catch (dbError) {
//                         console.error('[stripeRoutes.js] Database update error:', dbError);
//                     }
//                 }
//                 break;
//             }

//             case 'customer.subscription.deleted': {
//                 const subscription = event.data.object;
//                 try {
//                     await connectToMongoDB();
//                     await Subscription.updateOne(
//                         { subscriptionId: subscription.id },
//                         { status: 'canceled' }
//                     );
//                     console.log(`[stripeRoutes.js] Marked subscription ${subscription.id} as canceled`);
//                 } catch (dbError) {
//                     console.error('[stripeRoutes.js] Database update error:', dbError);
//                 }
//                 break;
//             }

//             case 'customer.subscription.updated': {
//                 const subscription = event.data.object;
//                 try {
//                     await connectToMongoDB();
//                     await Subscription.updateOne(
//                         { subscriptionId: subscription.id },
//                         {
//                             status: subscription.status,
//                             currentPeriodStart: new Date(subscription.current_period_start * 1000),
//                             currentPeriodEnd: new Date(subscription.current_period_end * 1000)
//                         }
//                     );
//                     console.log(`[stripeRoutes.js] Updated subscription ${subscription.id}`);
//                 } catch (dbError) {
//                     console.error('[stripeRoutes.js] Database update error:', dbError);
//                 }
//                 break;
//             }

//             default: {
//                 console.log(`[stripeRoutes.js] Unhandled event type: ${event.type}`);
//             }
//         }

//         // Single response at the end
//         res.json({ received: true, message: 'Webhook processed successfully' });
//     } catch (error) {
//         console.error('[stripeRoutes.js] Webhook Error:', error.message);
//         res.status(500).json({ error: error.message });
//     }
// });

router.post('/create-checkout-session', async (req, res) => {
    const { userId, priceId } = req.body;

    const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: 'https://record.onepgr.com/pricing?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'https://record.onepgr.com/pricing',
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


// router.post('/get-subscription', async (req, res) => {
//     const { subscriptionId } = req.body;
  
//     if (!subscriptionId) {
//       return res.status(400).json({ error: 'subscriptionId is required' });
//     }
  
//     try {
//       const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
//         expand: ['items.data.price.product', 'customer', 'latest_invoice']
//       });
  
//       if (!subscription) {
//         return res.status(404).json({ error: 'Subscription not found in Stripe' });
//       }
  
//       const priceItem = subscription.items.data[0];
//       const price = priceItem.price;
//       const product = typeof price.product === 'string'
//         ? { id: price.product, name: 'Unknown Product' }
//         : price.product;
  
//       // Convert Unix timestamps to a US formatted date string.
//       // Using "America/New_York" timezone. Adjust if needed.
//       const safeDateConvert = (timestamp) => {
//         if (!timestamp) return null;
//         const date = new Date(timestamp * 1000);
//         return isNaN(date.getTime())
//           ? null
//           : date.toLocaleString('en-US', { timeZone: 'America/New_York' });
//       };
  
//       // Use subscription item's period for billing dates.
//       const currentPeriodStart = priceItem.current_period_start;
//       const currentPeriodEnd = priceItem.current_period_end;
  
//       // Build a minimal invoice object with only the desired fields.
//       const invoiceData = subscription.latest_invoice
//         ? {
//             id: subscription.latest_invoice.id,
//             createdAt: safeDateConvert(subscription.latest_invoice.created)
//           }
//         : null;
  
//       // Extract proration adjustments that typically represent upgrade/downgrade changes.
//       const subscriptionChanges =
//         subscription.latest_invoice &&
//         subscription.latest_invoice.lines &&
//         Array.isArray(subscription.latest_invoice.lines.data)
//           ? subscription.latest_invoice.lines.data
//               .filter(line =>
//                 line.parent &&
//                 line.parent.subscription_item_details &&
//                 line.parent.subscription_item_details.proration === true
//               )
//               .map(line => ({
//                 id: line.id,
//                 description: line.description,
//                 // Convert cents to dollars
//                 amount: line.amount / 100,
//                 currency: line.currency,
//                 period: {
//                   start: safeDateConvert(line.period.start),
//                   end: safeDateConvert(line.period.end)
//                 }
//               }))
//           : [];
  
//       const response = {
//         subscription: {
//           id: subscription.id,
//           status: subscription.status,
//           plan: {
//             id: price.id,
//             name: product.name || price.nickname || 'Standard Plan',
//             amount: price.unit_amount / 100,
//             currency: price.currency,
//             interval: price.recurring
//               ? `${price.recurring.interval_count} ${price.recurring.interval}`
//               : 'one-time'
//           },
//           billing: {
//             nextBillingDate: safeDateConvert(currentPeriodEnd),
//             currentPeriodStart: safeDateConvert(currentPeriodStart),
//             currentPeriodEnd: safeDateConvert(currentPeriodEnd),
//             billingAnchor: safeDateConvert(subscription.billing_cycle_anchor),
//             startDate: safeDateConvert(subscription.start_date),
//             cancelAtPeriodEnd: subscription.cancel_at_period_end
//           },
//           invoice: invoiceData,
//           // Include details about any upgrade/downgrade changes in the subscription
//           subscriptionChanges,
//           createdAt: safeDateConvert(subscription.created),
//           customer: {
//             id: subscription.customer.id,
//             email: subscription.customer.email,
//             name: subscription.customer.name || ''
//           }
//         }
//       };
  
//       res.json(response);
//     } catch (error) {
//       console.error('Error in get-subscription:', error);
//       if (error.type === 'StripeInvalidRequestError') {
//         return res.status(404).json({ error: 'Subscription not found' });
//       }
//       res.status(500).json({ error: 'Failed to retrieve subscription' });
//     }
//   });

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
  

  
// router.post('/get-subscription', async (req, res) => {
//     const { subscriptionId } = req.body;

//     if (!subscriptionId) {
//         return res.status(400).json({ error: 'subscriptionId is required' });
//     }

//     try {
//         const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
//             expand: ['items.data.price.product', 'customer', 'latest_invoice']
//         });
//         console.log('Subscription:', subscription);
//         console.log('Subscription Items:', JSON.stringify(subscription.items.data, null, 2));
//         console.log('Subscription lines data:', JSON.stringify(subscription.lines?.data || [], null, 2));
//         if (!subscription) {
//             return res.status(404).json({ error: 'Subscription not found in Stripe' });
//         }

//         const priceItem = subscription.items.data[0];
//         const price = priceItem.price;
//         const product = typeof price.product === 'string'
//             ? { id: price.product, name: 'Unknown Product' }
//             : price.product;

//         // Updated safeDateConvert function to convert Unix timestamps to a US formatted date string.
//         const safeDateConvert = (timestamp) => {
//             if (!timestamp) return null;
//             const date = new Date(timestamp * 1000);
//             return isNaN(date.getTime())
//                 ? null
//                 : date.toLocaleString('en-US', { timeZone: 'America/New_York' });
//         };

//         // Use the subscription item's current period for billing dates.
//         const currentPeriodStart = priceItem.current_period_start;
//         const currentPeriodEnd = priceItem.current_period_end;

//         // Build a minimal invoice object with only the desired fields.
//         const invoiceData = subscription.latest_invoice
//             ? {
//                 id: subscription.latest_invoice.id,
//                 createdAt: safeDateConvert(subscription.latest_invoice.created)
//             }
//             : null;

//         const response = {
//             subscription: {
//                 id: subscription.id,
//                 status: subscription.status,
//                 plan: {
//                     id: price.id,
//                     name: product.name || price.nickname || 'Standard Plan',
//                     amount: price.unit_amount / 100,
//                     currency: price.currency,
//                     interval: price.recurring
//                         ? `${price.recurring.interval_count} ${price.recurring.interval}`
//                         : 'one-time'
//                 },
//                 billing: {
//                     nextBillingDate: safeDateConvert(currentPeriodEnd),
//                     currentPeriodStart: safeDateConvert(currentPeriodStart),
//                     currentPeriodEnd: safeDateConvert(currentPeriodEnd),
//                     billingAnchor: safeDateConvert(subscription.billing_cycle_anchor),
//                     startDate: safeDateConvert(subscription.start_date),
//                     cancelAtPeriodEnd: subscription.cancel_at_period_end
//                 },
//                 invoice: invoiceData,
//                 createdAt: safeDateConvert(subscription.created),
//                 customer: {
//                     id: subscription.customer.id,
//                     email: subscription.customer.email,
//                     name: subscription.customer.name || ''
//                 }
//             }
//         };

//         res.json(response);
//     } catch (error) {
//         console.error('Error in get-subscription:', error);
//         if (error.type === 'StripeInvalidRequestError') {
//             return res.status(404).json({ error: 'Subscription not found' });
//         }
//         res.status(500).json({ error: 'Failed to retrieve subscription' });
//     }
// });



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
// router.get('/users/:userId/subscriptions', async (req, res) => {
//     const { userId } = req.params;

//     // Basic validation (adjust according to your ID format)
//     if (!userId) {
//         return res.status(400).json({
//             error: 'userId is required'
//         });
//     }

//     try {
//         const subscriptions = await Subscription.find({ userId }).lean();

//         if (!subscriptions.length) {
//             return res.status(404).json({
//                 status: "-1",
//                 error: 'No subscriptions found',
//                 userId
//             });
//         }

//         res.json({
//             status: '1',
//             count: subscriptions.length,
//             subscriptions
//         });
//     } catch (error) {
//         console.error(`Failed to fetch subscriptions for user ${userId}:`, error);

//         res.status(500).json({
//             error: 'Failed to retrieve subscriptions',
//             userId,
//             details: process.env.NODE_ENV === 'development' ? error.message : undefined
//         });
//     }
// });


// function isValidId(id) {
//     return /^[a-f\d]{24}$/i.test(id); // Basic MongoDB ID format check
// }



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

module.exports = router;