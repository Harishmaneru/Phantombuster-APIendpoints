const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

// MongoDB Connection
const connectToMongoDB = async () => {
    try {
        if (mongoose.connection.readyState === 1) {
            console.log('MongoDB already connected');
            return;
        }

        await mongoose.connect(process.env.ONEPGR_MONGO_URI, {
            dbName: 'onepgr_apps'
        });
        console.log('Connected to MongoDB Subscription onepgr_apps database');
    } catch (error) {
        console.error('MongoDB connection error:', error);
    }
};

// Connect to MongoDB when module loads
connectToMongoDB();

// Define the schema with a unique model name to avoid conflicts
const SubscriptionFlagsSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    app: { type: String, required: true },
    subscription: { type: Object, required: true },
    usage: { type: Object, default: {} }
}, {
    timestamps: true,
    minimize: false, // Ensure empty objects are saved
    collection: 'subscription_flags'
});

// Use a unique model name to avoid conflicts with existing Subscription model
let SubscriptionFlags;
try {
    // Try to get existing model
    SubscriptionFlags = mongoose.model("SubscriptionFlags");
    console.log('Using existing SubscriptionFlags model');
} catch (error) {
    // Model doesn't exist, create it
    SubscriptionFlags = mongoose.model("SubscriptionFlags", SubscriptionFlagsSchema);
    console.log('Created new SubscriptionFlags model');
}

// ========== App-name canonicalization ==========
// Apps that are the same product across multiple domains share ONE subscription record.
// Canonicalize alias app-names to a single key used only for subscription_flags store/fetch.
// URL routing in stripeRoutes.js keeps using the raw app name (so success pages route per-domain).
const APP_ALIASES = {
    'liame.ai-home': 'liame', // www.liame.ai and liame.onepgr.com are the same product
};
const canonicalApp = (app) => APP_ALIASES[app] || app;

// ========== Reusable Functions ==========

// Normalize `features` into an object map { featureName: limit }
function normalizeFeatures(features) {
    if (!features) return {};

    // Already an object map (typical case)
    if (!Array.isArray(features) && typeof features === 'object') return features;

    const out = {};

    // Handle arrays of strings like "emails: 2" or objects like { emails: 2 }
    if (Array.isArray(features)) {
        for (const item of features) {
            if (typeof item === 'string') {
                const m = item.match(/^\s*([^:\n]+)\s*:\s*(.+)\s*$/);
                if (m) {
                    const key = m[1].trim();
                    let val = m[2].trim();
                    if (/^\d+$/.test(val)) val = Number(val);
                    out[key] = val;
                    continue;
                }
                // If string without colon, treat as flag with unlimited
                out[item.trim()] = "unlimited";
                continue;
            }

            if (typeof item === 'object' && item !== null) {
                // Merge object entries
                for (const k of Object.keys(item)) {
                    out[k] = item[k];
                }
                continue;
            }

            // Fallback: stringify
            out[String(item)] = "unlimited";
        }
        return out;
    }

    // Fallback: return empty map
    return {};
}

// Helper to ensure a subscription document (or plain object) has features as an object
function ensureSubscriptionFeatures(sub) {
    if (!sub || !sub.subscription) return;
    const f = sub.subscription.features;
    if (Array.isArray(f) || typeof f !== 'object') {
        sub.subscription.features = normalizeFeatures(f);
    }
}


// Store subscription & payment details
async function storeSubscription(req, res) {
    try {
        const { userId, app, subscription } = req.body;

        if (!userId || !app || !subscription) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        // Validate subscription structure
        if (!subscription.plan || !subscription.features || !subscription.payment) {
            return res.status(400).json({
                success: false,
                message: "Invalid subscription structure. Must include plan, features, and payment"
            });
        }

        // Canonicalize the app name so aliased domains share one record
        const appKey = canonicalApp(app);

        // Normalize features before saving (accept arrays from producers)
        subscription.features = normalizeFeatures(subscription.features);

        // Log the data being saved for debugging
        console.log('Saving subscription data:', { userId, app, appKey, subscription });

        // Upsert (update if exists, otherwise insert)
        const saved = await SubscriptionFlags.findOneAndUpdate(
            { userId, app: appKey },
            { userId, app: appKey, subscription },
            { upsert: true, new: true, runValidators: true }
        );

        res.json({ success: true, message: "Subscription stored successfully", data: saved });
    } catch (err) {
        console.error('Store subscription error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
}

// Fetch subscription & payment details
async function fetchSubscription(req, res) {
    try {
        const { userId, app } = req.query;

        if (!userId || !app) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        const sub = await SubscriptionFlags.findOne({ userId, app: canonicalApp(app) });

        if (!sub) {
            return res.status(200).json({ success: false, message: "No active subscription. User has not subscribed yet." });
        }

        const data = sub.toObject ? sub.toObject() : { ...sub };

        // Normalize features for consumers so callers always receive object map
        ensureSubscriptionFeatures(data);

        // Try to get customerId from this subscription, fallback to any other subscription for same user
        if (!data.subscription?.customer?.id) {
            const otherSub = await SubscriptionFlags.findOne({
                userId,
                'subscription.customer.id': { $exists: true, $ne: null },
                app: { $ne: canonicalApp(app) }
            });
            data.customerId = otherSub?.subscription?.customer?.id || null;
        } else {
            data.customerId = data.subscription.customer.id;
        }

        res.json({ success: true, data });
    } catch (err) {
        console.error('Fetch subscription error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
}

// Update usage counters
async function updateUsage(req, res) {
    try {
        const { userId, app, usageDetails } = req.body;

        if (!userId || !app || !usageDetails) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        const sub = await SubscriptionFlags.findOne({ userId, app: canonicalApp(app) });
        if (!sub) {
            return res.status(200).json({
                success: true,
                hasSubscription: false,  // Clear boolean flag
                message: "No subscription found"
            });
        }

        // Defensive normalization for legacy docs: convert array-shaped features to object map
        ensureSubscriptionFeatures(sub);

        // Check if subscription is active
        const paymentStatus = sub.subscription.payment?.status;
        const allowedStatuses = ['active', 'trialing', 'paid', 'succeeded'];

        if (sub.subscription.payment && paymentStatus && !allowedStatuses.includes(paymentStatus)) {
            console.log(`UpdateUsage: Subscription not active for userId: ${userId}, app: ${app}. Status: ${paymentStatus}`);
            return res.status(403).json({
                success: false,
                message: "Subscription is not active",
                currentStatus: paymentStatus
            });
        }

        // Check if subscription has expired
        if (sub.subscription.endDate && new Date() > new Date(sub.subscription.endDate)) {
            return res.status(403).json({
                success: false,
                message: "Subscription has expired"
            });
        }

        // Validate usage details and check limits before updating
        const validationResults = [];
        const updatedUsage = sub.usage ? { ...sub.usage } : {};
        let hasLimitExceeded = false;

        for (let key in usageDetails) {
            const currentUsage = (sub.usage && sub.usage[key]) || 0;
            if (typeof usageDetails[key] === 'number') {
                const newUsage = currentUsage + usageDetails[key];
                const featureKey = key.replace("Used", "");

                // Check limits
                if (sub.subscription.features && sub.subscription.features[featureKey] !== undefined) {
                    const limit = sub.subscription.features[featureKey];

                    if (limit !== "unlimited" && newUsage > limit) {
                        hasLimitExceeded = true;
                        validationResults.push({
                            feature: featureKey,
                            currentUsage: currentUsage,
                            requestedIncrement: usageDetails[key],
                            newTotal: newUsage,
                            limit: limit,
                            status: "limit_exceeded",
                            message: `Cannot update ${featureKey}. You have ${currentUsage}/${limit} used.`
                        });
                    } else {
                        validationResults.push({
                            feature: featureKey,
                            currentUsage: currentUsage,
                            requestedIncrement: usageDetails[key],
                            newTotal: newUsage,
                            limit: limit,
                            status: "allowed",
                            message: `Successfully updated ${featureKey}. Total usage: ${newUsage}/${limit}`
                        });
                        updatedUsage[key] = newUsage;
                    }
                } else {
                    validationResults.push({
                        feature: featureKey,
                        currentUsage: currentUsage,
                        requestedIncrement: usageDetails[key],
                        newTotal: newUsage,
                        limit: "unlimited",
                        status: "allowed",
                        message: `Successfully updated ${featureKey}. No usage limits apply.`
                    });
                    updatedUsage[key] = newUsage;
                }
            }
        }

        // If any limits exceeded, return detailed error without updating
        if (hasLimitExceeded) {
            return res.status(200).json({
                success: false,
                message: "Usage update failed - limits exceeded",
                canProceed: false,
                validationResults: validationResults,
                summary: {
                    totalFeatures: validationResults.length,
                    allowedUpdates: validationResults.filter(r => r.status === "allowed").length,
                    blockedUpdates: validationResults.filter(r => r.status === "limit_exceeded").length
                },
                recommendation: "Review the validation results and adjust your usage request to stay within plan limits."
            });
        }

        // All updates allowed, proceed with saving
        sub.usage = updatedUsage;
        sub.markModified('usage'); // Tell Mongoose the usage object has changed
        await sub.save();

        // Return detailed success response
        res.json({
            success: true,
            message: "Usage updated successfully",
            canProceed: true,
            updatedUsage: sub.usage,
            planLimits: sub.subscription.features,
            validationResults: validationResults,
            summary: {
                totalFeatures: validationResults.length,
                successfullyUpdated: validationResults.filter(r => r.status === "allowed").length,
                currentUsage: sub.usage
            },
            recommendation: "All usage updates were applied successfully within your plan limits."
        });

    } catch (err) {
        console.error('Update usage error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
}

// Check if user can perform action (helper function)
async function checkUsageLimit(req, res) {
    try {
        const { userId, app, action } = req.body;

        if (!userId || !app || !action) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        const sub = await SubscriptionFlags.findOne({ userId, app: canonicalApp(app) });
        if (!sub) {
            console.log(`CheckUsageLimit: Subscription not found for userId: ${userId}, app: ${app}`);
            return res.status(404).json({ success: false, message: "Subscription not found" });
        }

        // Defensive normalization for legacy docs: convert array-shaped features to object map
        ensureSubscriptionFeatures(sub);

        // Check if subscription is active
        const paymentStatus = sub.subscription.payment?.status;
        const allowedStatuses = ['active', 'trialing', 'paid', 'succeeded'];

        if (sub.subscription.payment && paymentStatus && !allowedStatuses.includes(paymentStatus)) {
            console.log(`CheckUsageLimit: Subscription not active for userId: ${userId}, app: ${app}. Status: ${paymentStatus}`);
            return res.status(403).json({
                success: false,
                message: "Subscription is not active",
                currentStatus: paymentStatus
            });
        }

        // Check if subscription has expired
        if (sub.subscription.endDate && new Date() > new Date(sub.subscription.endDate)) {
            return res.status(403).json({
                success: false,
                message: "Subscription has expired"
            });
        }

        // Check if the action exists in the subscription features
        if (!sub.subscription.features || !sub.subscription.features.hasOwnProperty(action)) {
            return res.status(400).json({
                success: false,
                message: `Invalid action: '${action}' is not a valid feature in your current plan`,
                canProceed: false,
                feature: action,
                availableFeatures: Object.keys(sub.subscription.features || {}),
                status: "invalid_action"
            });
        }

        // Check specific action limit
        const featureKey = action; // e.g., "campaigns", "domains", "emails"
        const usageKey = `${action}Used`;
        const limit = sub.subscription.features[featureKey];
        const currentUsage = (sub.usage && sub.usage[usageKey]) || 0;

        if (currentUsage >= limit) {
            // Return 200 OK - limit exceeded but check completed successfully
            return res.status(200).json({
                success: true,
                message: `Usage limit exceeded for ${featureKey}`,
                canProceed: false,
                feature: featureKey,
                planDetails: {
                    totalAllowed: limit,
                    currentlyUsed: currentUsage,
                    remaining: 0
                },
                status: "limit_exceeded",
                recommendation: `You have exceeded your ${featureKey} limit. Consider upgrading your plan for additional capacity.`
            });
        }

        // Return 200 OK - action allowed
        return res.status(200).json({
            success: true,
            message: `Usage check completed for ${featureKey}`,
            canProceed: true,
            feature: featureKey,
            planDetails: {
                totalAllowed: limit,
                currentlyUsed: currentUsage,
                remaining: limit - currentUsage
            },
            status: "action_allowed",
            recommendation: `You can proceed with creating ${featureKey}. ${limit - currentUsage} remaining in your current plan.`
        });

    } catch (err) {
        console.error('Check usage limit error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
}

// ========== Routes ==========
router.post("/api/subscriptions", storeSubscription);
router.get("/api/fetch-subscriptions", fetchSubscription);
router.patch("/api/subscriptions/usage", updateUsage);
router.post("/api/subscriptions/check-limit", checkUsageLimit);

// ========== Exports ==========
module.exports = {
    router,
    storeSubscription,
    fetchSubscription,
    updateUsage,
    checkUsageLimit
};