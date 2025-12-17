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
    subscription: { type: Object, required: true }, // dynamic object from frontend
    usage: {
        campaignsUsed: { type: Number, default: 0 },
        domainsUsed: { type: Number, default: 0 },
        emailsUsed: { type: Number, default: 0 }
    }
}, {
    timestamps: true,
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

// ========== Reusable Functions ==========

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

        // Log the data being saved for debugging
        console.log('Saving subscription data:', { userId, app, subscription });

        // Upsert (update if exists, otherwise insert)
        const saved = await SubscriptionFlags.findOneAndUpdate(
            { userId, app },
            { userId, app, subscription },
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

        const sub = await SubscriptionFlags.findOne({ userId, app });

        if (!sub) {
            return res.status(200).json({ success: false, message: "No active subscription. User has not subscribed yet." });
        }

        res.json({ success: true, data: sub });
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

        const sub = await SubscriptionFlags.findOne({ userId, app });
        if (!sub) {
            return res.status(404).json({ success: false, message: "Subscription not found" });
        }

        // Check if subscription is active
        if (sub.subscription.payment && sub.subscription.payment.status !== 'active') {
            return res.status(403).json({
                success: false,
                message: "Subscription is not active"
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
        const updatedUsage = { ...sub.usage };
        let hasLimitExceeded = false;

        for (let key in usageDetails) {
            if (sub.usage[key] !== undefined && typeof usageDetails[key] === 'number') {
                const newUsage = sub.usage[key] + usageDetails[key];
                const featureKey = key.replace("Used", "");

                // Check limits
                if (sub.subscription.features && sub.subscription.features[featureKey]) {
                    const limit = sub.subscription.features[featureKey];

                    if (newUsage > limit) {
                        hasLimitExceeded = true;
                        validationResults.push({
                            feature: featureKey,
                            currentUsage: sub.usage[key],
                            requestedIncrement: usageDetails[key],
                            newTotal: newUsage,
                            limit: limit,
                            status: "limit_exceeded",
                            message: `Cannot create ${usageDetails[key]} more ${featureKey}. You have ${sub.usage[key]}/${limit} used.`
                        });
                    } else {
                        validationResults.push({
                            feature: featureKey,
                            currentUsage: sub.usage[key],
                            requestedIncrement: usageDetails[key],
                            newTotal: newUsage,
                            limit: limit,
                            status: "allowed",
                            message: `Successfully created ${usageDetails[key]} ${featureKey}. Total usage: ${newUsage}/${limit}`
                        });
                        updatedUsage[key] = newUsage;
                    }
                } else {
                    validationResults.push({
                        feature: featureKey,
                        currentUsage: sub.usage[key],
                        requestedIncrement: usageDetails[key],
                        newTotal: newUsage,
                        limit: "unlimited",
                        status: "allowed",
                        message: `Successfully created ${usageDetails[key]} ${featureKey}. No usage limits apply.`
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

        const sub = await SubscriptionFlags.findOne({ userId, app });
        if (!sub) {
            return res.status(404).json({ success: false, message: "Subscription not found" });
        }

        // Check if subscription is active
        if (sub.subscription.payment && sub.subscription.payment.status !== 'active') {
            return res.status(403).json({
                success: false,
                message: "Subscription is not active"
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
        const currentUsage = sub.usage[usageKey] || 0;

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