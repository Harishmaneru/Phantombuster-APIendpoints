const { MongoClient } = require("mongodb");

// MongoDB connection using environment variable
const url = process.env.ONEPGR_MONGO_URI;
let client, WhatsAppAccounts;
let connectionPromise = null;

/**
 * Connection logic to prevent race conditions.
 * Ensures only one connection attempt is made even if multiple functions call it simultaneously.
 */
async function connectMongoDb() {
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
      if (!process.env.ONEPGR_MONGO_URI) {
        console.warn(
          "⚠️ ONEPGR_MONGO_URI environment variable not set",
        );
        return false;
      }

      client = await MongoClient.connect(url);
      WhatsAppAccounts = client
        .db("onepgr_apps")
        .collection("unipile-whatsapp-data");

      console.log(
        "------------------WhatsApp Accounts MongoDB Connected---------------",
      );
      return true;
    } catch (err) {
      console.error("MongoDB connection error for WhatsApp:", err.message);
      connectionPromise = null; // Reset to allow retry on next call
      return false;
    }
  })();

  return connectionPromise;
}

/**
 * Helper to ensure the database is connected before executing any query.
 */
async function ensureConnected() {
  if (!WhatsAppAccounts && process.env.ONEPGR_MONGO_URI) {
    await connectMongoDb();
  }
}

// Start connection attempt immediately on file load
connectMongoDb().catch(() => {});

/**
 * Connect/Register a WhatsApp account for a user
 * @param {string} userId - User ID
 * @param {string} accountId - Unipile account ID
 * @param {string} provider - Provider (WHATSAPP)
 * @param {string} name - Account name/phone number label
 * @param {Object} metadata - Additional metadata (pairing code, qr string, etc.)
 * @returns {Promise<Object>} - Result of the operation
 */
async function connectWhatsAppAccount(
  userId,
  accountId,
  provider = "WHATSAPP",
  name = null,
  metadata = {},
) {
  await ensureConnected();
  if (!WhatsAppAccounts) {
    return {
      success: true,
      message: "WhatsApp account connected (no DB session)",
      account_id: accountId,
      action: "created",
      warmup_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }
  try {
    const now = new Date();
    const warmupEndsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours warmup

    const updateData = {
      user_id: userId,
      account_id: accountId,
      provider: provider,
      name: name,
      connected: metadata.status === "OK" || metadata.status === "CONNECTED",
      status: metadata.status || "PENDING",
      connected_at: now,
      warmup_ends_at: warmupEndsAt,
      last_error: null,
      metadata: metadata,
      updated_at: now,
      limits_config: {
        daily_new_chat_limit: 20, // Low volume for new numbers/warmup
        daily_total_message_limit: 50,
        min_delay_seconds: 10, // 10-20 seconds randomized delay
        max_delay_seconds: 20,
        warmup_duration_hours: 24,
      },
    };

    const result = await WhatsAppAccounts.updateOne(
      { user_id: userId, provider: "WHATSAPP" },
      {
        $set: updateData,
        $setOnInsert: {
          created_at: now,
          daily_chats_count: 0,
          daily_messages_count: 0,
          last_counter_reset: now,
          last_sent_at: null,
        },
      },
      { upsert: true },
    );

    const action = result.upsertedCount > 0 ? "created" : "updated";
    console.log(
      `✅ ${action === "created" ? "Created new" : "Updated"} WhatsApp account for user ${userId}: ${accountId}`,
    );

    return {
      success: true,
      message: `WhatsApp account ${action} successfully`,
      account_id: accountId,
      action: action,
      warmup_ends_at: warmupEndsAt,
    };
  } catch (error) {
    console.error("Error connecting WhatsApp account:", error);
    return {
      success: false,
      message: "Failed to connect WhatsApp account",
      error: error.message,
    };
  }
}

/**
 * Disconnect a WhatsApp account
 * @param {string} userId - User ID
 * @param {string} reason - Reason for disconnection
 * @returns {Promise<Object>} - Result of the operation
 */
async function disconnectWhatsAppAccount(userId, reason = "User disconnected") {
  await ensureConnected();
  if (!WhatsAppAccounts) {
    return { success: true, message: "WhatsApp account disconnected" };
  }
  try {
    const result = await WhatsAppAccounts.updateOne(
      { user_id: userId, provider: "WHATSAPP" },
      {
        $set: {
          connected: false,
          status: "DISCONNECTED",
          last_error: reason,
          disconnected_at: new Date(),
          updated_at: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return {
        success: false,
        message: "No WhatsApp account found for this user",
      };
    }

    console.log(`❌ Disconnected WhatsApp account for user ${userId}: ${reason}`);
    return {
      success: true,
      message: "WhatsApp account disconnected successfully",
      reason: reason,
    };
  } catch (error) {
    console.error("Error disconnecting WhatsApp account:", error);
    return {
      success: false,
      message: "Failed to disconnect WhatsApp account",
      error: error.message,
    };
  }
}

/**
 * Get WhatsApp account status for a user
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Account status and details
 */
async function getWhatsAppAccountStatus(userId) {
  await ensureConnected();
  if (!WhatsAppAccounts) {
    return { success: true, connected: false, message: "No DB connection configured" };
  }
  try {
    const account = await WhatsAppAccounts.findOne({
      user_id: userId,
      provider: "WHATSAPP",
    });

    if (!account) {
      return {
        success: true,
        connected: false,
        message: "No WhatsApp account found",
      };
    }

    const now = new Date();
    const isWarmupActive = account.warmup_ends_at ? new Date(account.warmup_ends_at) > now : false;
    const hoursRemainingWarmup = isWarmupActive
      ? Math.max(0, ((new Date(account.warmup_ends_at) - now) / (1000 * 60 * 60)).toFixed(1))
      : 0;

    return {
      success: true,
      connected: account.connected,
      account_id: account.account_id,
      name: account.name,
      status: account.status,
      connected_at: account.connected_at,
      warmup_active: isWarmupActive,
      warmup_hours_remaining: Number(hoursRemainingWarmup),
      warmup_ends_at: account.warmup_ends_at,
      daily_chats_count: account.daily_chats_count || 0,
      daily_messages_count: account.daily_messages_count || 0,
      limits_config: account.limits_config,
      last_error: account.last_error,
      metadata: account.metadata,
    };
  } catch (error) {
    console.error("Error getting WhatsApp account status:", error);
    return {
      success: false,
      message: "Failed to get WhatsApp account status",
      error: error.message,
    };
  }
}

/**
 * Get WhatsApp account by account_id
 * @param {string} accountId - Unipile Account ID
 * @returns {Promise<Object|null>} - Account document
 */
async function getWhatsAppAccountByAccountId(accountId) {
  await ensureConnected();
  if (!WhatsAppAccounts) return null;
  try {
    return await WhatsAppAccounts.findOne({ account_id: accountId });
  } catch (error) {
    console.error("Error fetching WhatsApp account by account_id:", error);
    return null;
  }
}

/**
 * Update account status by accountId (used for webhooks / polling)
 * @param {string} accountId - Unipile Account ID
 * @param {string} status - New status (e.g. OK, CONNECTED, DISCONNECTED, CHECKPOINT)
 * @param {Object} extraData - Additional metadata
 * @returns {Promise<Object>}
 */
async function updateWhatsAppAccountStatusByAccountId(accountId, status, extraData = {}) {
  await ensureConnected();
  if (!WhatsAppAccounts) return { success: true, message: "Status updated (no DB)" };
  try {
    const isConnected = status === "OK" || status === "CONNECTED";
    const now = new Date();

    const setFields = {
      status: status,
      connected: isConnected,
      updated_at: now,
      ...extraData,
    };

    if (isConnected) {
      setFields.connected_at = setFields.connected_at || now;
      if (!extraData.warmup_ends_at) {
        setFields.warmup_ends_at = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      }
    } else {
      setFields.disconnected_at = now;
    }

    const result = await WhatsAppAccounts.updateOne(
      { account_id: accountId },
      { $set: setFields }
    );

    if (result.matchedCount === 0) {
      console.warn(`⚠️ Account ${accountId} not found in database for status update: ${status}`);
      return { success: false, message: "Account not found in database" };
    }

    console.log(`✅ Updated WhatsApp account ${accountId} status to ${status}`);
    return {
      success: true,
      message: "Account status updated",
      account_id: accountId,
      status: status,
    };
  } catch (error) {
    console.error("Error updating WhatsApp account status by ID:", error);
    return { success: false, message: "Failed to update account status", error: error.message };
  }
}

/**
 * Check sending limits and 24-hour warm-up rule for an account
 * @param {string} accountId - Unipile Account ID
 * @param {boolean} isNewChat - True if starting a new conversation with a new number
 * @returns {Promise<Object>} - Validation result { allowed: boolean, reason?: string, limits?: Object }
 */
async function checkSendingLimits(accountId, isNewChat = true) {
  await ensureConnected();
  if (!WhatsAppAccounts) {
    return { allowed: true, warning: "No DB connection, proceeding with limits check" };
  }
  try {
    const account = await WhatsAppAccounts.findOne({ account_id: accountId });
    if (!account) {
      // If account isn't in DB yet, allow with default warning log
      return { allowed: true, warning: "Account not tracked in database limit check" };
    }

    const now = new Date();
    const config = account.limits_config || {
      daily_new_chat_limit: 20,
      daily_total_message_limit: 50,
      min_delay_seconds: 10,
      max_delay_seconds: 20,
      warmup_duration_hours: 24,
    };

    // 1. Check 24-Hour Warm-up restriction for outreach to new numbers
    const connectedAt = account.connected_at ? new Date(account.connected_at) : null;
    const warmupEndsAt = account.warmup_ends_at ? new Date(account.warmup_ends_at) : null;

    const isWarmupPeriod = warmupEndsAt ? warmupEndsAt > now : (connectedAt && (now - connectedAt < 24 * 60 * 60 * 1000));

    if (isNewChat && isWarmupPeriod) {
      const hoursRemaining = connectedAt
        ? (24 - (now - connectedAt) / (1000 * 60 * 60)).toFixed(1)
        : 24;

      if ((account.daily_chats_count || 0) >= 5) {
        return {
          allowed: false,
          code: "WARMUP_LIMIT_EXCEEDED",
          reason: `Account is in 24-hour warm-up period. ${hoursRemaining} hours remaining. Maximum 5 new chats allowed during initial 24 hours.`,
          warmup_active: true,
          hours_remaining: Number(hoursRemaining),
        };
      }
    }

    // 2. Check Daily Counters Reset (reset if last reset was yesterday or earlier)
    const lastReset = account.last_counter_reset ? new Date(account.last_counter_reset) : new Date(0);
    const isDifferentDay = now.getUTCDate() !== lastReset.getUTCDate() ||
                           now.getUTCMonth() !== lastReset.getUTCMonth() ||
                           now.getUTCFullYear() !== lastReset.getUTCFullYear();

    let dailyChats = isDifferentDay ? 0 : (account.daily_chats_count || 0);
    let dailyMessages = isDifferentDay ? 0 : (account.daily_messages_count || 0);

    if (isDifferentDay) {
      // Reset counters in database
      await WhatsAppAccounts.updateOne(
        { account_id: accountId },
        {
          $set: {
            daily_chats_count: 0,
            daily_messages_count: 0,
            last_counter_reset: now,
          },
        }
      );
    }

    // 3. Check Daily Limits
    const dailyNewChatCap = isWarmupPeriod ? 10 : (config.daily_new_chat_limit || 20);
    const dailyTotalMsgCap = isWarmupPeriod ? 30 : (config.daily_total_message_limit || 50);

    if (isNewChat && dailyChats >= dailyNewChatCap) {
      return {
        allowed: false,
        code: "DAILY_NEW_CHAT_LIMIT_REACHED",
        reason: `Daily limit of ${dailyNewChatCap} new chats reached for this account. Warmup active: ${isWarmupPeriod}.`,
        daily_chats_count: dailyChats,
        limit: dailyNewChatCap,
      };
    }

    if (dailyMessages >= dailyTotalMsgCap) {
      return {
        allowed: false,
        code: "DAILY_MESSAGE_LIMIT_REACHED",
        reason: `Daily limit of ${dailyTotalMsgCap} total messages reached for this account.`,
        daily_messages_count: dailyMessages,
        limit: dailyTotalMsgCap,
      };
    }

    return {
      allowed: true,
      warmup_active: isWarmupPeriod,
      daily_chats_count: dailyChats,
      daily_messages_count: dailyMessages,
      limits: {
        new_chats_limit: dailyNewChatCap,
        messages_limit: dailyTotalMsgCap,
        min_delay_seconds: config.min_delay_seconds || 10,
        max_delay_seconds: config.max_delay_seconds || 20,
      },
    };
  } catch (error) {
    console.error("Error checking sending limits:", error);
    return { allowed: true, warning: "Error checking limits, proceeding with caution" };
  }
}

/**
 * Record message sent & enforce randomized delay calculation
 * @param {string} accountId - Unipile Account ID
 * @param {boolean} isNewChat - True if starting a new chat
 */
async function recordMessageSent(accountId, isNewChat = true) {
  await ensureConnected();
  if (!WhatsAppAccounts) return;
  try {
    const now = new Date();
    const incObj = { daily_messages_count: 1 };
    if (isNewChat) {
      incObj.daily_chats_count = 1;
    }

    await WhatsAppAccounts.updateOne(
      { account_id: accountId },
      {
        $set: { last_sent_at: now, updated_at: now },
        $inc: incObj,
      }
    );
  } catch (error) {
    console.error("Error recording message sent:", error);
  }
}

/**
 * Enforces a randomized delay (10-20 seconds) between consecutive outbound messages
 * to comply with Unipile & WhatsApp rate limit guidelines.
 * @param {string} accountId - Account ID
 * @returns {Promise<number>} - Milliseconds delayed
 */
async function enforceSendingDelay(accountId) {
  await ensureConnected();
  if (!WhatsAppAccounts) return 0;
  try {
    const account = await WhatsAppAccounts.findOne({ account_id: accountId });
    const minDelayMs = (account?.limits_config?.min_delay_seconds || 10) * 1000;
    const maxDelayMs = (account?.limits_config?.max_delay_seconds || 20) * 1000;

    // Calculate randomized delay duration in ms (between 10s and 20s)
    const randomDelayMs = Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;

    if (account && account.last_sent_at) {
      const timeSinceLastSend = Date.now() - new Date(account.last_sent_at).getTime();
      if (timeSinceLastSend < randomDelayMs) {
        const waitMs = randomDelayMs - timeSinceLastSend;
        console.log(`⏱️ Enforcing WhatsApp randomized delay: waiting ${(waitMs / 1000).toFixed(1)}s for account ${accountId}`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        return waitMs;
      }
    }

    return 0;
  } catch (error) {
    console.error("Error enforcing sending delay:", error);
    return 0;
  }
}

/**
 * Get all WhatsApp accounts
 * @param {Object} filters
 */
async function getAllWhatsAppAccounts(filters = {}) {
  await ensureConnected();
  if (!WhatsAppAccounts) return { success: true, accounts: [], count: 0 };
  try {
    const accounts = await WhatsAppAccounts.find(filters).toArray();
    return {
      success: true,
      accounts: accounts,
      count: accounts.length,
    };
  } catch (error) {
    console.error("Error getting all WhatsApp accounts:", error);
    return {
      success: false,
      message: "Failed to get WhatsApp accounts",
      error: error.message,
    };
  }
}

/**
 * Delete WhatsApp account completely
 * @param {string} userId - User ID
 */
async function deleteWhatsAppAccount(userId) {
  await ensureConnected();
  if (!WhatsAppAccounts) return { success: true, message: "Deleted (no DB)" };
  try {
    const result = await WhatsAppAccounts.deleteOne({
      user_id: userId,
      provider: "WHATSAPP",
    });

    if (result.deletedCount === 0) {
      return {
        success: false,
        message: "No WhatsApp account found for this user",
      };
    }

    console.log(`🗑️ Deleted WhatsApp account for user ${userId}`);
    return {
      success: true,
      message: "WhatsApp account deleted successfully",
    };
  } catch (error) {
    console.error("Error deleting WhatsApp account:", error);
    return {
      success: false,
      message: "Failed to delete WhatsApp account",
      error: error.message,
    };
  }
}

module.exports = {
  connectWhatsAppAccount,
  disconnectWhatsAppAccount,
  getWhatsAppAccountStatus,
  getWhatsAppAccountByAccountId,
  updateWhatsAppAccountStatusByAccountId,
  checkSendingLimits,
  recordMessageSent,
  enforceSendingDelay,
  getAllWhatsAppAccounts,
  deleteWhatsAppAccount,
};
