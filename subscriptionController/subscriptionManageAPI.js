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
    collection: 'subscription_flags' // Explicitly set collection name
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
      return res.status(404).json({ success: false, message: "Subscription not found" });
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

    // Increment usage safely and check limits
    for (let key in usageDetails) {
      if (sub.usage[key] !== undefined && typeof usageDetails[key] === 'number') {
        const newUsage = sub.usage[key] + usageDetails[key];
        
        // Check limits
        if (sub.subscription.features) {
          const featureKey = key.replace("Used", "");
          const limit = sub.subscription.features[featureKey];
          
          if (limit !== undefined && newUsage > limit) {
            return res.status(403).json({
              success: false,
              message: `Limit exceeded for ${featureKey}. Current: ${sub.usage[key]}, Adding: ${usageDetails[key]}, Limit: ${limit}`
            });
          }
        }
        
        sub.usage[key] = newUsage;
      }
    }

    await sub.save();

    res.json({ 
      success: true, 
      message: "Usage updated successfully", 
      usage: sub.usage,
      limits: sub.subscription.features
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
router.post("/subscriptions", storeSubscription);
router.get("/fetch-subscriptions", fetchSubscription);
router.patch("/subscriptions/usage", updateUsage);
router.post("/subscriptions/check-limit", checkUsageLimit);

// ========== Exports ==========
module.exports = {
  router,
  storeSubscription,
  fetchSubscription,
  updateUsage,
  checkUsageLimit
};