const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

// MongoDB Connection
const connectToMongoDB = async () => {
  try {
    if (mongoose.connection.readyState === 1) {
      console.log("MongoDB already connected");
      return;
    }

    await mongoose.connect(process.env.ONEPGR_MONGO_URI, {
      dbName: "onepgr_apps",
    });
    console.log("Connected to MongoDB Subscription onepgr_apps database");
  } catch (error) {
    console.error("MongoDB connection error:", error);
  }
};

// Connect to MongoDB when module loads
connectToMongoDB();

// Define the schema with a unique model name to avoid conflicts
const SubscriptionFlagsSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    app: { type: String, required: true },
    subscription: { type: Object, required: true },
    usage: { type: Object, default: {} },
  },
  {
    timestamps: true,
    minimize: false, // Ensure empty objects are saved
    collection: "subscription_flags",
  },
);

// Use a unique model name to avoid conflicts with existing Subscription model
let SubscriptionFlags;
try {
  // Try to get existing model
  SubscriptionFlags = mongoose.model("SubscriptionFlags");
  console.log("Using existing SubscriptionFlags model");
} catch (error) {
  // Model doesn't exist, create it
  SubscriptionFlags = mongoose.model(
    "SubscriptionFlags",
    SubscriptionFlagsSchema,
  );
  console.log("Created new SubscriptionFlags model");
}

// ========== App-name canonicalization ==========
// Apps that are the same product across multiple domains share ONE subscription record.
// Canonicalize alias app-names to a single key used only for subscription_flags store/fetch.
// URL routing in stripeRoutes.js keeps using the raw app name (so success pages route per-domain).
const APP_ALIASES = {
  "liame.ai-home": "liame", // www.liame.ai and liame.onepgr.com are the same product
};
const canonicalApp = (app) => APP_ALIASES[app] || app;

// ========== Reusable Functions ==========

// Normalize `features` into an object map { featureName: limit }
function normalizeFeatures(features) {
  if (!features) return {};

  // Already an object map (typical case)
  if (!Array.isArray(features) && typeof features === "object") return features;

  const out = {};

  // Handle arrays of strings like "emails: 2" or objects like { emails: 2 }
  if (Array.isArray(features)) {
    for (const item of features) {
      if (typeof item === "string") {
        const m = item.match(/^\s*([^:\n]+)\s*:\s*(.+)\s*$/);
        if (m) {
          const key = m[1].trim();
          let val = m[2].trim();
          const stripped = val.replace(/,/g, "");
          if (/^\d+$/.test(stripped)) val = Number(stripped);
          out[key] = val;
          continue;
        }

        // Try to extract a numeric limit at the beginning, e.g., "3 active ICP profiles"
        // Strip commas first so "5,000 outreach…" parses to 5000.
        const cleaned = item.trim().replace(/,/g, "");
        const numMatch = cleaned.match(/^(\d+)\s+(.+)$/);
        if (numMatch) {
          // Keep the original (possibly comma-formatted) key for backward compatibility,
          // but store the parsed numeric limit as the value.
          out[item.trim()] = Number(numMatch[1]);
          continue;
        }

        // If string without colon, treat as flag with unlimited
        out[item.trim()] = "unlimited";
        continue;
      }

      if (typeof item === "object" && item !== null) {
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

// ─── Feature-key resolution for /api/subscriptions/stats ──────────────────
// Maps canonical tokens (used by clients) to matchers against stored feature
// keys and the corresponding usage-counter key.
const FEATURE_ALIASES = {
  icp:              { match: /icp/i,              usageKey: "icpUsed" },
  discoveryRuns:    { match: /discovery run/i,    usageKey: "discoveryRunsUsed" },
  outreach:         { match: /outreach/i,          usageKey: "outreachMonthlyUsed" },
  analytics:        { match: /analytics/i,         usageKey: "analyticsUsed" },
};

// Derive a canonical short token from a stored feature key.
function tokenForFeatureKey(featureKey) {
  for (const [token, entry] of Object.entries(FEATURE_ALIASES)) {
    if (entry.match.test(featureKey)) return token;
  }
  // Fallback: return the key as-is (handles short keys like "campaigns", "domains", "emails")
  return featureKey;
}

// Case-insensitive lookup in a usage object.
function findUsage(usage, usageKey) {
  if (!usage || typeof usage !== "object") return 0;
  if (usage[usageKey] !== undefined) return usage[usageKey];
  const lowerKey = usageKey.toLowerCase();
  for (const [k, v] of Object.entries(usage)) {
    if (k.toLowerCase() === lowerKey) return v;
  }
  return 0;
}

// Compute a single feature-stat object from a stored feature key + value + usage.
function computeFeatureStat(featureKey, value, usage) {
  const token = tokenForFeatureKey(featureKey);
  const alias = FEATURE_ALIASES[token];
  const usageKey = alias ? alias.usageKey : `${token}Used`;
  const used = findUsage(usage, usageKey);

  let limit = value;
  let isUnlimited =
    limit === "unlimited" || String(limit).toLowerCase() === "unlimited";

  // When value is "unlimited" but the key starts with a number,
  // extract that number as the actual limit.
  if (isUnlimited) {
    const cleaned = featureKey.replace(/,/g, "");
    const numMatch = cleaned.match(/^\s*(\d+)\s+(.+)$/);
    if (numMatch) {
      limit = parseInt(numMatch[1], 10);
      isUnlimited = false;
    }
  }

  let numLimit = typeof limit === "string" ? parseInt(limit, 10) : limit;
  if (isNaN(numLimit)) {
    // Non-numeric value (e.g. "premium", true, false) — treat as unlimited flag
    return {
      key: featureKey,
      token,
      limit: value,
      used,
      remaining: "unlimited",
      isUnlimited: true,
      canProceed: true,
    };
  }

  const canProceed = isUnlimited || used < numLimit;
  const remaining = isUnlimited
    ? "unlimited"
    : Math.max(0, numLimit - used);

  return {
    key: featureKey,
    token,
    limit: isUnlimited ? "unlimited" : numLimit,
    used,
    remaining,
    isUnlimited,
    canProceed,
  };
}

// ─── Periodic usage-reset config ───────────────────────────────────────────
// Only keys that actually exist in the subscription usage are reset (so other
// apps using this shared backend are never polluted with AIxSDR-specific keys).
const PERIODIC_RESETS = {
  discoveryRunsUsed: 24 * 60 * 60 * 1000,      // daily
  outreachMonthlyUsed: 30 * 24 * 60 * 60 * 1000, // monthly (30-day approximation)
  linkedinDmsUsed: 30 * 24 * 60 * 60 * 1000,     // monthly
};

/**
 * Apply periodic resets to a subscription's usage counters.
 * Only resets keys that already exist in sub.usage (never creates new keys
 * for apps that don't use them). Mutates sub.usage in place (zeroes counters
 * whose window has elapsed) and updates sub.usage.__resets with the current
 * timestamp. Returns true if any counter was reset.
 */
function applyUsageResets(sub) {
  if (!sub || !sub.usage) return false;
  const now = Date.now();
  let didReset = false;

  for (const [key, windowMs] of Object.entries(PERIODIC_RESETS)) {
    // Only reset keys that already exist in usage (avoids injecting AIxSDR
    // specific keys into other apps' documents).
    if (!(key in sub.usage)) continue;
    const lastReset = sub.usage.__resets?.[key];
    if (lastReset == null || now - new Date(lastReset).getTime() >= windowMs) {
      sub.usage[key] = 0;
      sub.usage.__resets = sub.usage.__resets || {};
      sub.usage.__resets[key] = new Date(now).toISOString();
      didReset = true;
    }
  }

  return didReset;
}

/**
 * Helper to ensure a subscription document (or plain object) has features as
 * an object map rather than an array or string (legacy compatibility).
 */
function ensureSubscriptionFeatures(sub) {
  if (!sub || !sub.subscription) return;
  const f = sub.subscription.features;
  if (Array.isArray(f) || typeof f !== "object") {
    sub.subscription.features = normalizeFeatures(f);
  }
}

// Store subscription & payment details
async function storeSubscription(req, res) {
  try {
    const { userId, app, subscription } = req.body;

    if (!userId || !app || !subscription) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    // Validate subscription structure
    if (!subscription.plan || !subscription.features || !subscription.payment) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid subscription structure. Must include plan, features, and payment",
      });
    }

    // Canonicalize the app name so aliased domains share one record
    const appKey = canonicalApp(app);

    // Normalize features before saving (accept arrays from producers)
    subscription.features = normalizeFeatures(subscription.features);

    // Log the data being saved for debugging
    console.log("Saving subscription data:", {
      userId,
      app,
      appKey,
      subscription,
    });

    // Upsert (update if exists, otherwise insert)
    const saved = await SubscriptionFlags.findOneAndUpdate(
      { userId, app: appKey },
      { userId, app: appKey, subscription },
      { upsert: true, new: true, runValidators: true },
    );

    res.json({
      success: true,
      message: "Subscription stored successfully",
      data: saved,
    });
  } catch (err) {
    console.error("Store subscription error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// Fetch subscription & payment details
async function fetchSubscription(req, res) {
  try {
    const { userId, app } = req.query;

    if (!userId || !app) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    const sub = await SubscriptionFlags.findOne({
      userId,
      app: canonicalApp(app),
    });

    if (!sub) {
      return res.status(200).json({
        success: false,
        message: "No active subscription. User has not subscribed yet.",
      });
    }

    const data = sub.toObject ? sub.toObject() : { ...sub };

    // Normalize features for consumers so callers always receive object map
    ensureSubscriptionFeatures(data);

    // Try to get customerId from this subscription, fallback to any other subscription for same user
    if (!data.subscription?.customer?.id) {
      const otherSub = await SubscriptionFlags.findOne({
        userId,
        "subscription.customer.id": { $exists: true, $ne: null },
        app: { $ne: canonicalApp(app) },
      });
      data.customerId = otherSub?.subscription?.customer?.id || null;
    } else {
      data.customerId = data.subscription.customer.id;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("Fetch subscription error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// Update usage counters
async function updateUsage(req, res) {
  try {
    const { userId, app, usageDetails } = req.body;

    if (!userId || !app || !usageDetails) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    const sub = await SubscriptionFlags.findOne({
      userId,
      app: canonicalApp(app),
    });
    if (!sub) {
      return res.status(200).json({
        success: true,
        hasSubscription: false, // Clear boolean flag
        message: "No subscription found",
      });
    }

    // Defensive normalization for legacy docs: convert array-shaped features to object map
    ensureSubscriptionFeatures(sub);

    // Apply periodic resets (daily/monthly counters) before reading usage
    applyUsageResets(sub);

    // Check if subscription is active
    const paymentStatus = sub.subscription.payment?.status;
    const allowedStatuses = ["active", "trialing", "paid", "succeeded"];

    if (
      sub.subscription.payment &&
      paymentStatus &&
      !allowedStatuses.includes(paymentStatus)
    ) {
      console.log(
        `UpdateUsage: Subscription not active for userId: ${userId}, app: ${app}. Status: ${paymentStatus}`,
      );
      return res.status(403).json({
        success: false,
        message: "Subscription is not active",
        currentStatus: paymentStatus,
      });
    }

    // Check if subscription has expired
    if (
      sub.subscription.endDate &&
      new Date() > new Date(sub.subscription.endDate)
    ) {
      return res.status(403).json({
        success: false,
        message: "Subscription has expired",
      });
    }

    // Validate usage details and check limits before updating
    const validationResults = [];
    const updatedUsage = sub.usage ? { ...sub.usage } : {};
    let hasLimitExceeded = false;

    for (let key in usageDetails) {
      const currentUsage = (sub.usage && sub.usage[key]) || 0;
      if (typeof usageDetails[key] === "number") {
        const newUsage = Math.max(0, currentUsage + usageDetails[key]);
        const featureKey = key.replace("Used", "");

        // Check limits
        if (
          sub.subscription.features &&
          sub.subscription.features[featureKey] !== undefined
        ) {
          let limit = sub.subscription.features[featureKey];

          // Extract limit from featureKey if it starts with a number and is marked as unlimited
          if (
            limit === "unlimited" ||
            String(limit).toLowerCase() === "unlimited"
          ) {
            const match = featureKey.replace(/,/g, "").match(/^\s*(\d+)\s+(.+)$/);
            if (match) {
              limit = parseInt(match[1], 10);
            }
          }

          if (limit !== "unlimited" && newUsage > limit) {
            hasLimitExceeded = true;
            validationResults.push({
              feature: featureKey,
              currentUsage: currentUsage,
              requestedIncrement: usageDetails[key],
              newTotal: newUsage,
              limit: limit,
              status: "limit_exceeded",
              message: `Cannot update ${featureKey}. You have ${currentUsage}/${limit} used.`,
            });
          } else {
            validationResults.push({
              feature: featureKey,
              currentUsage: currentUsage,
              requestedIncrement: usageDetails[key],
              newTotal: newUsage,
              limit: limit,
              status: "allowed",
              message: `Successfully updated ${featureKey}. Total usage: ${newUsage}/${limit}`,
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
            message: `Successfully updated ${featureKey}. No usage limits apply.`,
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
          allowedUpdates: validationResults.filter(
            (r) => r.status === "allowed",
          ).length,
          blockedUpdates: validationResults.filter(
            (r) => r.status === "limit_exceeded",
          ).length,
        },
        recommendation:
          "Review the validation results and adjust your usage request to stay within plan limits.",
      });
    }

    // All updates allowed, proceed with saving
    sub.usage = updatedUsage;
    sub.markModified("usage"); // Tell Mongoose the usage object has changed
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
        successfullyUpdated: validationResults.filter(
          (r) => r.status === "allowed",
        ).length,
        currentUsage: sub.usage,
      },
      recommendation:
        "All usage updates were applied successfully within your plan limits.",
    });
  } catch (err) {
    console.error("Update usage error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// Check if user can perform action (helper function)
async function checkUsageLimit(req, res) {
  try {
    const { userId, app, action } = req.body;

    if (!userId || !app || !action) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    const sub = await SubscriptionFlags.findOne({
      userId,
      app: canonicalApp(app),
    });
    if (!sub) {
      console.log(
        `CheckUsageLimit: Subscription not found for userId: ${userId}, app: ${app}`,
      );
      return res
        .status(200)
        .json({ success: false, message: "Subscription not found" });
    }

    // Defensive normalization for legacy docs: convert array-shaped features to object map
    ensureSubscriptionFeatures(sub);

    // Apply periodic resets (daily/monthly counters) before reading usage
    const didReset = applyUsageResets(sub);
    if (didReset) {
      sub.markModified("usage");
      await sub.save();
    }

    // Check if subscription is active
    const paymentStatus = sub.subscription.payment?.status;
    const allowedStatuses = ["active", "trialing", "paid", "succeeded"];

    if (
      sub.subscription.payment &&
      paymentStatus &&
      !allowedStatuses.includes(paymentStatus)
    ) {
      console.log(
        `CheckUsageLimit: Subscription not active for userId: ${userId}, app: ${app}. Status: ${paymentStatus}`,
      );
      return res.status(403).json({
        success: false,
        message: "Subscription is not active",
        currentStatus: paymentStatus,
      });
    }

    // Check if subscription has expired
    if (
      sub.subscription.endDate &&
      new Date() > new Date(sub.subscription.endDate)
    ) {
      return res.status(403).json({
        success: false,
        message: "Subscription has expired",
      });
    }

    // Build a list of available features as { key, label }
    const availableFeaturesList = [];
    if (
      sub.subscription.features &&
      typeof sub.subscription.features === "object"
    ) {
      for (const [k, v] of Object.entries(sub.subscription.features)) {
        availableFeaturesList.push({
          key: k,
          label: typeof v === "string" ? v : String(v),
        });
      }
    }

    // Check if the action exists in the subscription features
    if (
      !sub.subscription.features ||
      !Object.prototype.hasOwnProperty.call(sub.subscription.features, action)
    ) {
      return res.status(400).json({
        success: false,
        message: `Invalid action: '${action}' is not a valid feature in your current plan`,
        canProceed: false,
        feature: action,
        // Provide both machine keys and human-friendly labels to help callers
        availableFeatures: availableFeaturesList,
        suggestion: availableFeaturesList.length
          ? "Use one of the feature `key` values in `availableFeatures[].key` as the action parameter."
          : undefined,
        status: "invalid_action",
      });
    }

    // Check specific action limit
    const featureKey = action; // e.g., "campaigns", "domains", "emails"
    const usageKey = `${action}Used`;
    let limit = sub.subscription.features[featureKey];
    const currentUsage = (sub.usage && sub.usage[usageKey]) || 0;
    let isUnlimited =
      limit === "unlimited" || String(limit).toLowerCase() === "unlimited";

    // Extract limit from featureKey if it starts with a number and is marked as unlimited
    if (isUnlimited) {
      const match = featureKey.replace(/,/g, "").match(/^\s*(\d+)\s+(.+)$/);
      if (match) {
        limit = parseInt(match[1], 10);
        isUnlimited = false;
      }
    }

    // If unlimited, always allow
    if (isUnlimited) {
      return res.status(200).json({
        success: true,
        message: `Usage check completed for ${featureKey}`,
        canProceed: true,
        feature: featureKey,
        planDetails: {
          totalAllowed: "unlimited",
          currentlyUsed: currentUsage,
          remaining: "unlimited",
        },
        status: "action_allowed",
        recommendation: `You can proceed with creating ${featureKey}. Your plan has unlimited capacity.`,
      });
    }

    // Convert limit to number for numeric limits
    const numLimit = typeof limit === "string" ? parseInt(limit, 10) : limit;
    if (isNaN(numLimit)) {
      // If limit cannot be parsed, treat as unlimited
      return res.status(200).json({
        success: true,
        message: `Usage check completed for ${featureKey}`,
        canProceed: true,
        feature: featureKey,
        planDetails: {
          totalAllowed: limit,
          currentlyUsed: currentUsage,
          remaining: "unlimited",
        },
        status: "action_allowed",
        recommendation: `You can proceed with creating ${featureKey}. Your plan has unlimited capacity.`,
      });
    }

    // Numeric limit: check if exceeded
    if (currentUsage >= numLimit) {
      return res.status(200).json({
        success: true,
        message: `Usage limit exceeded for ${featureKey}`,
        canProceed: false,
        feature: featureKey,
        planDetails: {
          totalAllowed: numLimit,
          currentlyUsed: currentUsage,
          remaining: 0,
        },
        status: "limit_exceeded",
        recommendation: `You have exceeded your ${featureKey} limit. Consider upgrading your plan for additional capacity.`,
      });
    }

    // Return 200 OK - action allowed
    return res.status(200).json({
      success: true,
      message: `Usage check completed for ${featureKey}`,
      canProceed: true,
      feature: featureKey,
      planDetails: {
        totalAllowed: numLimit,
        currentlyUsed: currentUsage,
        remaining: numLimit - currentUsage,
      },
      status: "action_allowed",
      recommendation: `You can proceed with creating ${featureKey}. ${numLimit - currentUsage} remaining in your current plan.`,
    });
  } catch (err) {
    console.error("Check usage limit error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// Get aggregate stats for a user + app (all features, usage, plan context)
async function getSubscriptionStats(req, res) {
  try {
    const { userId, app } = req.body;

    if (!userId || !app) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    const sub = await SubscriptionFlags.findOne({
      userId,
      app: canonicalApp(app),
    });
    if (!sub) {
      return res.status(200).json({
        success: false,
        message: "Subscription not found",
      });
    }

    ensureSubscriptionFeatures(sub);

    const didReset = applyUsageResets(sub);
    if (didReset) {
      sub.markModified("usage");
      await sub.save();
    }

    // Compute isActive flag (non-blocking — always return 200)
    const paymentStatus = sub.subscription.payment?.status;
    const allowedStatuses = ["active", "trialing", "paid", "succeeded"];
    const paymentOk =
      !sub.subscription.payment ||
      !paymentStatus ||
      allowedStatuses.includes(paymentStatus);
    const notExpired =
      !sub.subscription.endDate ||
      new Date() <= new Date(sub.subscription.endDate);
    const isActive = paymentOk && notExpired;

    const plan = sub.subscription.plan || {};
    const payment = { status: sub.subscription.payment?.status || null };
    const endDate = sub.subscription.endDate || null;

    // Build feature stats
    const features = [];
    const featuresByToken = {};
    const availableActions = [];

    if (
      sub.subscription.features &&
      typeof sub.subscription.features === "object"
    ) {
      for (const [featureKey, value] of Object.entries(
        sub.subscription.features,
      )) {
        const stat = computeFeatureStat(featureKey, value, sub.usage);
        features.push(stat);
        if (!featuresByToken[stat.token]) {
          featuresByToken[stat.token] = stat;
          availableActions.push(stat.token);
        }
      }
    }

    return res.json({
      success: true,
      userId: sub.userId,
      app: sub.app,
      isActive,
      plan,
      payment,
      endDate,
      availableActions,
      featuresByToken,
      features,
    });
  } catch (err) {
    console.error("Get subscription stats error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ========== Routes ==========
router.post("/api/subscriptions", storeSubscription);
router.get("/api/fetch-subscriptions", fetchSubscription);
router.patch("/api/subscriptions/usage", updateUsage);
router.post("/api/subscriptions/check-limit", checkUsageLimit);
router.post("/api/subscriptions/stats", getSubscriptionStats);

// ========== Exports ==========
module.exports = {
  router,
  storeSubscription,
  fetchSubscription,
  updateUsage,
  checkUsageLimit,
  getSubscriptionStats,
};
