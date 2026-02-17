const express = require("express");
const axios = require("axios");
const FormData = require("form-data");
const NodeCache = require("node-cache");
const router = express.Router();
const upload = require("../middlewares/upload");

// Import LinkedIn account service
const {
  connectLinkedInAccount,
  disconnectLinkedInAccount,
  getLinkedInAccountStatus,
  refreshLinkedInAccount,
  handleAccountError,
  getAllLinkedInAccounts,
  deleteLinkedInAccount,
} = require("./linkedinAccountService");

// ==================== MIDDLEWARE ====================

// Validate environment variables on startup
const validateConfig = () => {
  const required = ["UNIPILE_API_KEY", "UNIPILE_SUBDOMAIN", "UNIPILE_PORT"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }
};

validateConfig();

// ==================== CACHING ====================
// Cache for LinkedIn profile data to reduce API calls and prevent rate limits
// TTL: 30 minutes (profiles don't change frequently)
const profileCache = new NodeCache({
  stdTTL: 30 * 60, // 30 minutes in seconds
  checkperiod: 60, // Check for expired keys every minute
  useClones: false, // Better performance, we don't need deep cloning
});

// Cache for chat lookup results (shorter TTL since chats can change)
const chatCache = new NodeCache({
  stdTTL: 10 * 60, // 10 minutes
  checkperiod: 60,
});

// Helper function to generate cache keys
const getProfileCacheKey = (identifier, accountId) => {
  return `profile:${accountId}:${identifier}`;
};

const getChatCacheKey = (accountId, providerId) => {
  return `chat:${accountId}:${providerId}`;
};

// Build base URL from environment
const getBaseUrl = () => {
  return `https://${process.env.UNIPILE_SUBDOMAIN}.unipile.com:${process.env.UNIPILE_PORT}/api/v1`;
};

// Standard headers for all requests
const getHeaders = (contentType = "application/json") => ({
  "X-API-KEY": process.env.UNIPILE_API_KEY,
  Accept: "application/json",
  ...(contentType && { "Content-Type": contentType }),
});

// Unified error handler
const handleError = (err, res) => {
  console.error("API Error:", {
    status: err.response?.status,
    message: err.message,
    data: err.response?.data,
    url: err.config?.url,
  });

  const status = err.response?.status || 500;

  // Forward full error details from Unipile if available
  if (err.response?.data) {
    return res.status(status).json({
      success: false,
      error: err.response.data,
      message: err.message,
    });
  }

  const message = err.message || "Internal server error";

  res.status(status).json({
    success: false,
    error: message,
  });
};

// ==================== ACCOUNT ENDPOINTS ====================

// Get all accounts
router.get("/api/unipile/accounts", async (req, res) => {
  try {
    const response = await axios.get(`${getBaseUrl()}/accounts`, {
      headers: getHeaders(),
    });

    res.json({
      success: true,
      data: response.data,
    });
  } catch (err) {
    handleError(err, res);
  }
});

// Get specific account details
router.get("/api/unipile/accounts/:accountId", async (req, res) => {
  try {
    const { accountId } = req.params;

    const response = await axios.get(`${getBaseUrl()}/accounts/${accountId}`, {
      headers: getHeaders(),
    });

    res.json({
      success: true,
      data: response.data,
    });
  } catch (err) {
    handleError(err, res);
  }
});

// Create account via cookie (li_at token)
router.post("/api/unipile/accounts/cookie", async (req, res) => {
  try {
    const { access_token, user_agent, user_id, name } = req.body;

    if (!access_token || !user_agent) {
      return res.status(400).json({
        success: false,
        error: "access_token (li_at) and user_agent are required",
      });
    }

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: "user_id is required to store account information",
      });
    }

    // Use FormData for consistency
    const form = new FormData();

    form.append("provider", "LINKEDIN");
    form.append("access_token", access_token);
    form.append("user_agent", user_agent);

    const response = await axios.post(`${getBaseUrl()}/accounts`, form, {
      headers: {
        "X-API-KEY": process.env.UNIPILE_API_KEY,
        ...form.getHeaders(),
      },
    });

    // Store account in database
    if (response.data && response.data.account_id) {
      const dbResult = await connectLinkedInAccount(
        user_id,
        response.data.account_id,
        "LINKEDIN",
        name || "LinkedIn Account",
        {
          user_agent: user_agent,
          connected_via: "cookie",
          unipile_response: response.data,
        },
      );

      if (!dbResult.success) {
        console.error("Failed to store account in database:", dbResult.error);
        // Continue with success response but log the error
      }
    }

    res.status(201).json({
      success: true,
      data: response.data,
      message: "LinkedIn account connected successfully",
      stored_in_db: response.data && response.data.account_id ? true : false,
    });
  } catch (err) {
    handleError(err, res);
  }
});

// Delete account
router.delete("/api/unipile/accounts/:accountId", async (req, res) => {
  try {
    const { accountId } = req.params;

    const response = await axios.delete(
      `${getBaseUrl()}/accounts/${accountId}`,
      {
        headers: getHeaders(),
      },
    );

    res.json({
      success: true,
      data: response.data,
      message: "Account deleted successfully",
    });
  } catch (err) {
    handleError(err, res);
  }
});

// Validate OTP / Checkpoint for LinkedIn account
router.post("/api/unipile/account/validate-otp", async (req, res) => {
  try {
    const { user_id, code } = req.body;

    if (!user_id || !code) {
      return res.status(400).json({
        success: false,
        error: "user_id and code are required",
      });
    }

    // Get the account_id from our database
    const dbResult = await getLinkedInAccountStatus(user_id);

    if (!dbResult.success || !dbResult.account_id) {
      return res.status(404).json({
        success: false,
        error: "No LinkedIn account found for this user",
      });
    }

    const accountId = dbResult.account_id;

    console.log(`Validating OTP for account ${accountId}...`);

    const payload = {
      provider: "LINKEDIN",
      account_id: accountId,
      code: code,
    };

    // Call Unipile checkpoint API
    const response = await axios.post(
      `${getBaseUrl()}/accounts/checkpoint`,
      payload,
      {
        headers: getHeaders(),
      },
    );

    res.json({
      success: true,
      data: response.data,
      message: "OTP validated successfully",
    });
  } catch (err) {
    handleError(err, res);
  }
});

// ==================== HOSTED AUTH ENDPOINTS ====================

// Create hosted authentication link
router.post("/api/unipile/auth/link", async (req, res) => {
  try {
    const {
      providers = ["LINKEDIN"],
      success_redirect_url,
      failure_redirect_url,
      notify_url,
      name,
      user_id,
      type = "create",
    } = req.body;

    // Validate providers
    if (!providers || !Array.isArray(providers) || providers.length === 0) {
      return res.status(400).json({
        success: false,
        error: "providers array is required and must not be empty",
      });
    }

    // Generate expiration (24 hours from now)
    const expiresOn = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Include user_id in notify_url if provided
    let finalNotifyUrl = notify_url;
    if (user_id && notify_url) {
      const separator = notify_url.includes("?") ? "&" : "?";
      finalNotifyUrl = `${notify_url}${separator}user_id=${user_id}`;
    }

    const payload = {
      type,
      providers,
      expiresOn,
      api_url: `https://${process.env.UNIPILE_SUBDOMAIN}.unipile.com:${process.env.UNIPILE_PORT}`,
      ...(success_redirect_url && { success_redirect_url }),
      ...(failure_redirect_url && { failure_redirect_url }),
      ...(finalNotifyUrl && { notify_url: finalNotifyUrl }),
      ...(name && { name }),
      // Use metadata to pass custom data
      metadata: {
        user_id: user_id,
      },
    };

    const response = await axios.post(
      `${getBaseUrl()}/hosted/accounts/link`,
      payload,
      { headers: getHeaders() },
    );

    res.json({
      success: true,
      data: response.data,
      message: "Hosted auth link created successfully",
      user_id: user_id,
      note: user_id
        ? "User ID included for webhook processing"
        : "No user ID provided - account will not be stored automatically",
    });
  } catch (err) {
    handleError(err, res);
  }
});

// Webhook handler for account creation and errors
router.post("/api/unipile/webhook/unipile-account", async (req, res) => {
  try {
    const { status, account_id, name, provider, error, user_id, metadata } =
      req.body;

    // Also check for user_id in query parameters (from notify_url) and metadata
    const userIdFromQuery = req.query.user_id;
    const userIdFromMetadata = metadata?.user_id;
    const finalUserId = user_id || userIdFromQuery || userIdFromMetadata;

    console.log("Unipile webhook received:", {
      status,
      account_id,
      name,
      provider,
      user_id: finalUserId,
      user_id_from_body: user_id,
      user_id_from_query: userIdFromQuery,
      user_id_from_metadata: userIdFromMetadata,
      timestamp: new Date().toISOString(),
    });

    if (status === "CREATION_SUCCESS" && account_id) {
      console.log(
        `✅ Account created successfully for user ${
          name || finalUserId
        }: ${account_id}`,
      );

      // Store account in database if user_id is provided
      if (finalUserId) {
        const dbResult = await connectLinkedInAccount(
          finalUserId,
          account_id,
          provider || "LINKEDIN",
          name || "LinkedIn Account",
          {
            connected_via: "hosted_auth",
            webhook_data: req.body,
          },
        );

        if (!dbResult.success) {
          console.error("Failed to store account in database:", dbResult.error);
        }
      } else {
        // If no user_id provided, store with a temporary identifier
        // This allows you to manually associate the account later
        const tempUserId = `temp_${account_id}_${Date.now()}`;
        console.log(
          `⚠️ No user_id provided, storing with temporary ID: ${tempUserId}`,
        );

        const dbResult = await connectLinkedInAccount(
          tempUserId,
          account_id,
          provider || "LINKEDIN",
          name || "LinkedIn Account",
          {
            connected_via: "hosted_auth",
            webhook_data: req.body,
            is_temporary: true,
            needs_user_association: true,
          },
        );

        if (!dbResult.success) {
          console.error("Failed to store account in database:", dbResult.error);
        }
      }

      res.json({
        success: true,
        message: "Account creation processed successfully",
        stored_in_db: true,
        user_id: finalUserId || `temp_${account_id}_${Date.now()}`,
        note: finalUserId
          ? "Account associated with user"
          : "Account stored with temporary ID - needs user association",
      });
    } else if (status === "CREATION_FAILED") {
      console.log(
        `❌ Account creation failed for user ${name || finalUserId}:`,
        error,
      );

      // Update user status if user_id is provided
      if (finalUserId) {
        const dbResult = await disconnectLinkedInAccount(
          finalUserId,
          error || "Account creation failed",
        );

        if (!dbResult.success) {
          console.error(
            "Failed to update account status in database:",
            dbResult.error,
          );
        }
      }

      res.json({
        success: true,
        message: "Account creation failure processed",
        updated_in_db: !!finalUserId,
      });
    } else if (status === "ACCOUNT_ERROR" || status === "ACCOUNT_STOPPED") {
      console.log(`⚠️ Account error/stopped for account ${account_id}:`, error);

      // Handle account error
      const dbResult = await handleAccountError(
        account_id,
        error || "Account error occurred",
      );

      if (!dbResult.success) {
        console.error(
          "Failed to handle account error in database:",
          dbResult.error,
        );
      }

      res.json({
        success: true,
        message: "Account error handled successfully",
        updated_in_db: dbResult.success,
      });
    } else {
      console.log("⚠️ Unknown webhook status:", status);
      res.json({
        success: true,
        message: "Webhook received",
      });
    }
  } catch (err) {
    console.error("Webhook processing error:", err);
    res.status(500).json({
      success: false,
      error: "Webhook processing failed",
    });
  }
});

// ==================== CHAT ENDPOINTS ====================

// Get all chats/conversations for a userId - FAST VERSION
// RECOMMENDED FLOW:
//   1. Call this endpoint with skip_profiles=true (default) for fast chat list
//   2. Extract attendee_provider_id from each chat
//   3. Call POST /api/unipile/user/:userId/batch-profiles with provider_ids array for profile enrichment
router.get("/api/unipile/user/:userId/allchats", async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      limit = 50,
      cursor,
      search,
      include_profiles = "false", // Default to false - use batch-profiles API instead
      skip_profiles = "true", // Default to true for fast response
    } = req.query;

    const dbResult = await getLinkedInAccountStatus(userId);

    if (!dbResult.success || !dbResult.account_id) {
      return res
        .status(404)
        .json({ success: false, error: "No LinkedIn account found" });
    }

    const accountId = dbResult.account_id;

    const params = new URLSearchParams();
    params.append("account_id", accountId);
    params.append("limit", limit);
    if (cursor) params.append("cursor", cursor);
    if (search) params.append("search", search);

    const response = await axios.get(`${getBaseUrl()}/chats?${params}`, {
      headers: getHeaders(),
    });

    let chatsData = response.data;
    const chats = chatsData?.items || [];

    // Determine if we should fetch profiles
    const shouldFetchProfiles =
      skip_profiles !== "true" &&
      include_profiles === "true" &&
      chats.length > 0;

    if (shouldFetchProfiles) {
      console.log(`🚀 Enriching ${chats.length} chats with profile data...`);
      const startTime = Date.now();

      // Helper: fetch single profile with timeout
      const fetchProfileWithTimeout = async (chat, timeoutMs = 1500) => {
        const attendeeProviderId = chat.attendee_provider_id;

        // Skip invalid provider IDs
        if (
          !attendeeProviderId ||
          attendeeProviderId === "1337" ||
          attendeeProviderId.length < 10
        ) {
          return createCleanChatItem(chat, null, "skipped");
        }

        // Check cache first (instant)
        const cacheKey = getProfileCacheKey(attendeeProviderId, accountId);
        const cachedProfile = profileCache.get(cacheKey);

        if (cachedProfile) {
          return createCleanChatItem(chat, cachedProfile, "cached");
        }

        // Fetch with timeout
        try {
          const profilePromise = axios.get(
            `${getBaseUrl()}/users/${encodeURIComponent(
              attendeeProviderId,
            )}?account_id=${accountId}`,
            { headers: getHeaders(), timeout: timeoutMs },
          );

          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), timeoutMs),
          );

          const profileResponse = await Promise.race([
            profilePromise,
            timeoutPromise,
          ]);
          const profile = profileResponse.data;

          // Cache the profile
          profileCache.set(cacheKey, profile);

          return createCleanChatItem(chat, profile, "fetched");
        } catch (err) {
          return createCleanChatItem(chat, null, "timeout_or_error");
        }
      };

      // Helper: Create clean chat item with only essential fields
      const createCleanChatItem = (chat, profile, fetchStatus) => {
        // Build attendee profile with essential fields only
        let attendeeProfile = null;
        if (profile) {
          // Handle both full profile and cached profile formats
          const firstName = profile.first_name || "";
          const lastName = profile.last_name || "";
          const fullName =
            profile.name ||
            (firstName && lastName ? `${firstName} ${lastName}`.trim() : null);

          attendeeProfile = {
            provider_id: profile.provider_id || null,
            name: fullName,
            first_name: firstName || null,
            last_name: lastName || null,
            headline: profile.headline || null,
            profile_picture_url:
              profile.profile_picture_url || profile.picture || null,
            location: profile.location || null,
            public_identifier: profile.public_identifier || null,
          };
        }

        // Return clean chat item with only essential fields
        return {
          id: chat.id,
          name: chat.name || null,
          type: chat.type,
          unread: chat.unread,
          unread_count: chat.unread_count,
          archived: chat.archived,
          pinned: chat.pinned,
          timestamp: chat.timestamp,
          account_id: chat.account_id,
          provider_id: chat.provider_id,
          attendee_provider_id: chat.attendee_provider_id,
          // Profile data for UI
          attendee_profile: attendeeProfile,
          profile_fetch_status: fetchStatus,
          // Optional fields (included if present)
          ...(chat.subject && { subject: chat.subject }),
          ...(chat.content_type && { content_type: chat.content_type }),
          ...(chat.read_only && { read_only: chat.read_only }),
          ...(chat.muted_until && { muted_until: chat.muted_until }),
        };
      };

      // Process ALL profiles in parallel with individual timeouts (much faster)
      const enrichedChats = await Promise.all(
        chats.map((chat) => fetchProfileWithTimeout(chat, 1500)),
      );

      const elapsed = Date.now() - startTime;
      console.log(`✅ Enriched ${enrichedChats.length} chats in ${elapsed}ms`);

      // Return streamlined response
      res.json({
        success: true,
        data: {
          object: chatsData.object,
          items: enrichedChats,
          cursor: chatsData.cursor || null,
        },
        account_id: accountId,
        user_id: userId,
        profiles_included: true,
        enrichment_time_ms: elapsed,
      });
    } else {
      // Return chats without profile enrichment (when explicitly skipped)
      const cleanChats = chats.map((chat) => ({
        id: chat.id,
        name: chat.name || null,
        type: chat.type,
        unread: chat.unread,
        unread_count: chat.unread_count,
        archived: chat.archived,
        pinned: chat.pinned,
        timestamp: chat.timestamp,
        account_id: chat.account_id,
        provider_id: chat.provider_id,
        attendee_provider_id: chat.attendee_provider_id,
        attendee_profile: null,
        ...(chat.subject && { subject: chat.subject }),
        ...(chat.content_type && { content_type: chat.content_type }),
        ...(chat.read_only && { read_only: chat.read_only }),
        ...(chat.muted_until && { muted_until: chat.muted_until }),
      }));

      res.json({
        success: true,
        data: {
          object: chatsData.object,
          items: cleanChats,
          cursor: chatsData.cursor || null,
        },
        account_id: accountId,
        user_id: userId,
        profiles_included: false,
      });
    }
  } catch (err) {
    handleError(err, res);
  }
});

// Batch fetch profiles for multiple provider IDs - OPTIMIZED for client-side enrichment
// Uses batched concurrent requests to avoid rate limiting and longer timeouts
router.post("/api/unipile/user/:userId/batch-profiles", async (req, res) => {
  try {
    const { userId } = req.params;
    const { provider_ids, batch_size = 5, timeout_ms = 5000 } = req.body;

    if (
      !provider_ids ||
      !Array.isArray(provider_ids) ||
      provider_ids.length === 0
    ) {
      return res
        .status(400)
        .json({ success: false, error: "provider_ids array is required" });
    }

    const dbResult = await getLinkedInAccountStatus(userId);
    if (!dbResult.success || !dbResult.account_id) {
      return res
        .status(404)
        .json({ success: false, error: "No LinkedIn account found" });
    }

    const accountId = dbResult.account_id;
    const startTime = Date.now();
    const BATCH_SIZE = Math.min(parseInt(batch_size) || 5, 10); // Max 10 concurrent
    const TIMEOUT_MS = Math.min(parseInt(timeout_ms) || 5000, 10000); // Max 10s timeout

    console.log(
      `📥 Batch fetching ${provider_ids.length} profiles (batch size: ${BATCH_SIZE}, timeout: ${TIMEOUT_MS}ms)`,
    );

    // Helper: Build clean profile object
    const buildProfileObject = (p) => {
      const firstName = p.first_name || "";
      const lastName = p.last_name || "";
      const fullName =
        p.name ||
        (firstName && lastName ? `${firstName} ${lastName}`.trim() : null);

      return {
        provider_id: p.provider_id || null,
        name: fullName,
        first_name: firstName || null,
        last_name: lastName || null,
        headline: p.headline || null,
        profile_picture_url: p.profile_picture_url || p.picture || null,
        profile_url: p.profile_url || null,
        public_identifier: p.public_identifier || null,
        location: p.location || null,
      };
    };

    // Fetch single profile with longer timeout
    const fetchProfile = async (providerId) => {
      // Skip invalid provider IDs
      if (
        !providerId ||
        providerId === "1337" ||
        String(providerId).length < 10
      ) {
        return { provider_id: providerId, profile: null, status: "skipped" };
      }

      // Check cache first (instant)
      const cacheKey = getProfileCacheKey(providerId, accountId);
      const cached = profileCache.get(cacheKey);
      if (cached) {
        return {
          provider_id: providerId,
          profile: buildProfileObject(cached),
          status: "cached",
        };
      }

      // Fetch from Unipile API with longer timeout
      try {
        const response = await axios.get(
          `${getBaseUrl()}/users/${encodeURIComponent(
            providerId,
          )}?account_id=${accountId}`,
          {
            headers: getHeaders(),
            timeout: TIMEOUT_MS,
          },
        );
        const p = response.data;

        // Cache the raw profile for future use
        profileCache.set(cacheKey, p);

        return {
          provider_id: providerId,
          profile: buildProfileObject(p),
          status: "fetched",
        };
      } catch (err) {
        const errorType =
          err.code === "ECONNABORTED" || err.message === "timeout"
            ? "timeout"
            : err.response?.status === 404
              ? "not_found"
              : "error";

        console.warn(`⚠️ Failed to fetch profile ${providerId}: ${errorType}`);
        return { provider_id: providerId, profile: null, status: errorType };
      }
    };

    // Process in batches to avoid rate limiting
    const results = [];
    const uniqueProviderIds = [...new Set(provider_ids)]; // Remove duplicates

    for (let i = 0; i < uniqueProviderIds.length; i += BATCH_SIZE) {
      const batch = uniqueProviderIds.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(fetchProfile));
      results.push(...batchResults);

      // Small delay between batches to avoid rate limiting (except for last batch)
      if (i + BATCH_SIZE < uniqueProviderIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    const elapsed = Date.now() - startTime;
    const fetchedCount = results.filter((r) => r.status === "fetched").length;
    const cachedCount = results.filter((r) => r.status === "cached").length;
    const errorCount = results.filter(
      (r) =>
        r.status === "error" ||
        r.status === "timeout" ||
        r.status === "not_found",
    ).length;

    console.log(
      `✅ Batch profiles complete: ${fetchedCount} fetched, ${cachedCount} cached, ${errorCount} errors (${elapsed}ms)`,
    );

    res.json({
      success: true,
      profiles: results,
      count: results.length,
      stats: {
        fetched: fetchedCount,
        cached: cachedCount,
        errors: errorCount,
        skipped: results.filter((r) => r.status === "skipped").length,
      },
      fetched_in_ms: elapsed,
    });
  } catch (err) {
    handleError(err, res);
  }
});

// Get a specific conversation/chat by ID for a user
router.get(
  "/api/unipile/user/:userId/conversations/:chatId",
  async (req, res) => {
    try {
      const { userId, chatId } = req.params;

      const dbResult = await getLinkedInAccountStatus(userId);
      if (!dbResult.success || !dbResult.account_id) {
        return res
          .status(404)
          .json({ success: false, error: "No LinkedIn account found" });
      }

      const params = new URLSearchParams();
      params.append("account_id", dbResult.account_id);

      const response = await axios.get(
        `${getBaseUrl()}/chats/${chatId}?${params}`,
        { headers: getHeaders() },
      );

      res.json({
        success: true,
        data: response.data,
        account_id: dbResult.account_id,
        chat_id: chatId,
        user_id: userId,
      });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// Get messages for a userId + chatId
router.get(
  "/api/unipile/user/:userId/chats/:chatId/messages",
  async (req, res) => {
    try {
      const { userId, chatId } = req.params;
      const { limit = 50, cursor } = req.query;

      const dbResult = await getLinkedInAccountStatus(userId);
      if (!dbResult.success || !dbResult.account_id) {
        return res
          .status(404)
          .json({ success: false, error: "No LinkedIn account found" });
      }

      const params = new URLSearchParams();
      params.append("account_id", dbResult.account_id);
      params.append("limit", limit);
      if (cursor) params.append("cursor", cursor);

      const response = await axios.get(
        `${getBaseUrl()}/chats/${chatId}/messages?${params}`,
        { headers: getHeaders() },
      );

      res.json({
        success: true,
        data: response.data,
        account_id: dbResult.account_id,
        chat_id: chatId,
        user_id: userId,
      });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// Get conversation attendees (participants) for a chat
router.get(
  "/api/unipile/user/:userId/conversations/:chatId/attendees",
  async (req, res) => {
    try {
      const { userId, chatId } = req.params;

      const dbResult = await getLinkedInAccountStatus(userId);
      if (!dbResult.success || !dbResult.account_id) {
        return res
          .status(404)
          .json({ success: false, error: "No LinkedIn account found" });
      }

      const params = new URLSearchParams();
      params.append("account_id", dbResult.account_id);

      const response = await axios.get(
        `${getBaseUrl()}/chats/${chatId}/attendees?${params}`,
        { headers: getHeaders() },
      );

      res.json({
        success: true,
        data: response.data,
        account_id: dbResult.account_id,
        chat_id: chatId,
        user_id: userId,
      });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// Sync chat (get new messages since timestamp) - with user_id in URL
router.get(
  "/api/unipile/user/:userId/conversations/:chatId/sync",
  async (req, res) => {
    try {
      const { userId, chatId } = req.params;
      const { since } = req.query;

      const dbResult = await getLinkedInAccountStatus(userId);
      if (!dbResult.success || !dbResult.account_id) {
        return res
          .status(404)
          .json({ success: false, error: "No LinkedIn account found" });
      }

      const params = new URLSearchParams();
      params.append("account_id", dbResult.account_id);
      if (since) params.append("since", since);

      const response = await axios.get(
        `${getBaseUrl()}/chats/${chatId}/sync?${params}`,
        { headers: getHeaders() },
      );

      res.json({
        success: true,
        data: response.data,
        account_id: dbResult.account_id,
        chat_id: chatId,
        user_id: userId,
      });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// Sync chat (get new messages since timestamp) - legacy endpoint with account_id in query
router.get("/api/unipile/chats/:chatId/sync", async (req, res) => {
  try {
    const { chatId } = req.params;
    const { account_id, since } = req.query;

    if (!account_id) {
      return res.status(400).json({
        success: false,
        error: "account_id is required",
      });
    }

    const params = new URLSearchParams();
    params.append("account_id", account_id);
    if (since) params.append("since", since);

    const response = await axios.get(
      `${getBaseUrl()}/chats/${chatId}/sync?${params}`,
      { headers: getHeaders() },
    );

    res.json({
      success: true,
      data: response.data,
    });
  } catch (err) {
    handleError(err, res);
  }
});

// Send LinkedIn message (creates chat if doesn't exist)
router.post(
  "/api/unipile/linkedin/message",
  upload.fields([
    { name: "video_message", maxCount: 1 },
    { name: "audio_message", maxCount: 1 },
    { name: "attachment", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        account_id,
        user_id, // Add this to lookup account_id
        profile_url,
        profile_identifier,
        message,
        subject,
        use_inmail = false,
      } = req.body;

      // Get account_id from user_id if not provided
      let finalAccountId = account_id;
      if (!finalAccountId && user_id) {
        const dbResult = await getLinkedInAccountStatus(user_id);
        if (dbResult.success && dbResult.account_id) {
          finalAccountId = dbResult.account_id;
        }
      }

      // Validation
      if (!finalAccountId) {
        return res.status(400).json({
          success: false,
          error: "account_id or user_id is required",
        });
      }

      if (!message) {
        return res.status(400).json({
          success: false,
          error: "message is required",
        });
      }

      if (!profile_url && !profile_identifier) {
        return res.status(400).json({
          success: false,
          error: "Either profile_url or profile_identifier is required",
        });
      }

      // Extract LinkedIn identifier from URL if provided
      let recipientId = profile_identifier;
      if (profile_url && !profile_identifier) {
        // Handle various LinkedIn URL formats
        const patterns = [
          /linkedin\.com\/in\/([^\/\?#]+)/, // Standard profile
          /linkedin\.com\/company\/([^\/\?#]+)/, // Company page
          /linkedin\.com\/sales\/people\/([^\/\?#]+)/, // Sales Navigator
        ];

        let match = null;
        for (const pattern of patterns) {
          match = profile_url.match(pattern);
          if (match) {
            recipientId = match[1];
            break;
          }
        }

        if (!match) {
          return res.status(400).json({
            success: false,
            error:
              "Invalid LinkedIn profile URL format. Expected: https://linkedin.com/in/username or https://linkedin.com/company/companyname",
          });
        }
      }

      // Build FormData payload
      const form = new FormData();

      form.append("account_id", finalAccountId);
      form.append("attendees_ids[]", recipientId);
      form.append("text", message);

      if (subject) {
        form.append("subject", subject);
      }

      if (use_inmail) {
        form.append("linkedin[inmail]", "true");
      }

      // 🔥 MEDIA HANDLING (ONLY ONE - priority: video > audio > attachment)
      if (req.files?.video_message) {
        const file = req.files.video_message[0];
        form.append("video_message", file.buffer, {
          filename: file.originalname,
          contentType: file.mimetype,
        });
      } else if (req.files?.audio_message) {
        const file = req.files.audio_message[0];
        form.append("audio_message", file.buffer, {
          filename: file.originalname,
          contentType: file.mimetype,
        });
      } else if (req.files?.attachment) {
        const file = req.files.attachment[0];
        form.append("attachments", file.buffer, {
          filename: file.originalname,
          contentType: file.mimetype,
        });
      }

      // Send message (Unipile creates chat if it doesn't exist)
      const response = await axios.post(`${getBaseUrl()}/chats`, form, {
        headers: {
          "X-API-KEY": process.env.UNIPILE_API_KEY,
          ...form.getHeaders(),
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      res.json({
        success: true,
        data: response.data,
        message: use_inmail
          ? "InMail sent successfully"
          : "Message sent successfully",
        chat_id: response.data.chat_id,
        message_id: response.data.message_id,
        recipient_id: recipientId,
        account_id: finalAccountId,
      });
    } catch (err) {
      console.error("LinkedIn message error:", {
        status: err.response?.status,
        data: err.response?.data,
        message: err.message,
      });
      handleError(err, res);
    }
  },
);

// Send LinkedIn message (user_id in URL path)
router.post(
  "/api/unipile/user/:userId/linkedin/message",
  upload.fields([
    { name: "video_message", maxCount: 1 },
    { name: "audio_message", maxCount: 1 },
    { name: "attachment", maxCount: 1 },
  ]),
  async (req, res) => {
    const { userId } = req.params;
    const {
      profile_url,
      profile_identifier,
      message,
      subject,
      use_inmail = false,
    } = req.body;

    let finalAccountId = null;
    let recipientIdentifier = profile_identifier || null;
    let recipientId = null;

    try {
      // Get account_id from user_id
      const dbResult = await getLinkedInAccountStatus(userId);
      if (!dbResult.success || !dbResult.account_id) {
        return res.status(404).json({
          success: false,
          error: "No LinkedIn account found for this user",
        });
      }

      finalAccountId = dbResult.account_id;

      // Validation
      if (!message) {
        return res.status(400).json({
          success: false,
          error: "message is required",
        });
      }

      if (!profile_url && !recipientIdentifier) {
        return res.status(400).json({
          success: false,
          error: "Either profile_url or profile_identifier is required",
        });
      }

      // Extract LinkedIn identifier from URL if provided
      if (profile_url && !recipientIdentifier) {
        // Handle various LinkedIn URL formats
        const patterns = [
          /linkedin\.com\/in\/([^\/\?#]+)/, // Standard profile
          /linkedin\.com\/company\/([^\/\?#]+)/, // Company page
          /linkedin\.com\/sales\/people\/([^\/\?#]+)/, // Sales Navigator
        ];

        let match = null;
        for (const pattern of patterns) {
          match = profile_url.match(pattern);
          if (match) {
            recipientIdentifier = match[1];
            break;
          }
        }

        if (!match) {
          return res.status(400).json({
            success: false,
            error:
              "Invalid LinkedIn profile URL format. Expected: https://linkedin.com/in/username or https://linkedin.com/company/companyname",
          });
        }
      }

      if (!recipientIdentifier) {
        return res.status(400).json({
          success: false,
          error: "Unable to determine LinkedIn recipient identifier",
        });
      }

      // Try to get provider_id from Unipile API (more reliable than public identifier)
      recipientId = recipientIdentifier;
      try {
        const userResponse = await axios.get(
          `${getBaseUrl()}/users/${encodeURIComponent(
            recipientIdentifier,
          )}?account_id=${finalAccountId}`,
          { headers: getHeaders() },
        );

        // Use provider_id if available, otherwise fall back to identifier
        if (userResponse.data?.provider_id) {
          recipientId = userResponse.data.provider_id;
          console.log(
            `Found provider_id for ${recipientIdentifier}: ${recipientId}`,
          );
        } else {
          console.log(
            `No provider_id found, using identifier: ${recipientIdentifier}`,
          );
        }
      } catch (userError) {
        console.warn(
          `Could not fetch user details for ${recipientIdentifier}, using identifier directly:`,
          userError.message,
        );
        // Continue with identifier if user lookup fails - Unipile might accept it
      }

      // Build FormData payload
      const form = new FormData();

      form.append("account_id", finalAccountId);
      form.append("attendees_ids[]", recipientId);
      form.append("text", message);

      if (subject) {
        form.append("subject", subject);
      }

      if (use_inmail) {
        form.append("linkedin[inmail]", "true");
      }

      // 🔥 MEDIA HANDLING (ONLY ONE - priority: video > audio > attachment)
      if (req.files?.video_message) {
        const file = req.files.video_message[0];
        form.append("video_message", file.buffer, {
          filename: file.originalname,
          contentType: file.mimetype,
        });
      } else if (req.files?.audio_message) {
        const file = req.files.audio_message[0];
        form.append("audio_message", file.buffer, {
          filename: file.originalname,
          contentType: file.mimetype,
        });
      } else if (req.files?.attachment) {
        const file = req.files.attachment[0];
        form.append("attachments", file.buffer, {
          filename: file.originalname,
          contentType: file.mimetype,
        });
      }

      // Send message (Unipile creates chat if it doesn't exist)
      const response = await axios.post(`${getBaseUrl()}/chats`, form, {
        headers: {
          "X-API-KEY": process.env.UNIPILE_API_KEY,
          ...form.getHeaders(),
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      res.json({
        success: true,
        data: response.data,
        message: use_inmail
          ? "InMail sent successfully"
          : "Message sent successfully",
        chat_id: response.data.chat_id,
        message_id: response.data.message_id,
        recipient_id: recipientId,
        account_id: finalAccountId,
        user_id: userId,
      });
    } catch (err) {
      console.error("LinkedIn message error:", {
        status: err.response?.status,
        data: err.response?.data,
        message: err.message,
        url: err.config?.url,
        recipient_id: recipientId,
        account_id: finalAccountId,
        user_id: userId,
      });

      // Provide detailed error information for 422 errors from Unipile
      if (err.response?.status === 422) {
        const unipileError = err.response?.data;
        return res.status(422).json({
          success: false,
          error:
            unipileError?.error ||
            unipileError?.message ||
            "Unprocessable Entity - Unable to send message",
          details:
            unipileError?.detail ||
            unipileError?.details ||
            unipileError?.title,
          type: unipileError?.type,
          recipient_id: recipientId,
          account_id: finalAccountId,
          user_id: userId,
          unipile_response: unipileError,
          possible_reasons: [
            "Recipient profile not found or invalid",
            "Account not properly connected to LinkedIn",
            "Rate limit exceeded",
            "Recipient is not a connection (may need InMail)",
            "LinkedIn account has restrictions",
          ],
        });
      }

      handleError(err, res);
    }
  },
);

// Get full conversation details with messages and attendee profiles
router.get(
  "/api/unipile/user/:userId/chats/:chatId/full-messages",
  async (req, res) => {
    try {
      const { userId, chatId } = req.params;
      const { limit = 100, cursor } = req.query;

      const dbResult = await getLinkedInAccountStatus(userId);
      if (!dbResult.success || !dbResult.account_id) {
        return res
          .status(404)
          .json({ success: false, error: "No LinkedIn account found" });
      }

      const accountId = dbResult.account_id;

      // Get current user's profile
      const currentUserResponse = await axios.get(
        `${getBaseUrl()}/accounts/${accountId}`,
        { headers: getHeaders() },
      );
      const currentUserProviderId = currentUserResponse.data?.provider_id;

      const params = new URLSearchParams();
      params.append("account_id", accountId);
      params.append("limit", limit);
      if (cursor) params.append("cursor", cursor);

      const [messagesResponse, chatResponse, attendeesResponse] =
        await Promise.all([
          axios.get(`${getBaseUrl()}/chats/${chatId}/messages?${params}`, {
            headers: getHeaders(),
          }),
          axios.get(`${getBaseUrl()}/chats/${chatId}?account_id=${accountId}`, {
            headers: getHeaders(),
          }),
          axios.get(
            `${getBaseUrl()}/chats/${chatId}/attendees?account_id=${accountId}`,
            { headers: getHeaders() },
          ),
        ]);

      const messages =
        messagesResponse.data?.messages || messagesResponse.data?.items || [];
      const chatInfo = chatResponse.data || {};
      const attendeesData =
        attendeesResponse.data?.attendees ||
        attendeesResponse.data?.items ||
        attendeesResponse.data ||
        [];
      const attendees = Array.isArray(attendeesData) ? attendeesData : [];

      // Remove duplicate attendees based on provider_id
      const uniqueAttendees = attendees.filter(
        (attendee, index, self) =>
          index ===
          self.findIndex((a) => a.provider_id === attendee.provider_id),
      );

      // Find current user's attendee profile
      const currentUserAttendee = uniqueAttendees.find(
        (attendee) =>
          attendee.provider_id === currentUserProviderId ||
          attendee.is_self === 1,
      );

      // Find other attendees (excluding current user)
      const otherAttendees = uniqueAttendees.filter(
        (attendee) =>
          attendee.provider_id !== currentUserProviderId &&
          attendee.is_self !== 1,
      );

      // Log raw message structure from Unipile for debugging (first message only)
      if (messages.length > 0) {
        console.log(
          "🔍 Raw Unipile message structure (first message):",
          JSON.stringify(messages[0], null, 2),
        );
        console.log(
          "🔍 All available fields in first message:",
          Object.keys(messages[0]),
        );

        // Log messages with reactions or attachments for debugging
        const messagesWithReactions = messages.filter(
          (msg) =>
            (msg.reactions && msg.reactions.length > 0) ||
            (msg.reaction && msg.reaction.length > 0) ||
            (msg.message_reactions && msg.message_reactions.length > 0),
        );
        const messagesWithAttachments = messages.filter(
          (msg) =>
            (msg.attachments && msg.attachments.length > 0) ||
            (msg.attachment && msg.attachment.length > 0) ||
            (msg.message_attachments && msg.message_attachments.length > 0),
        );

        if (messagesWithReactions.length > 0) {
          console.log(
            `✅ Found ${messagesWithReactions.length} message(s) with reactions`,
          );
        }
        if (messagesWithAttachments.length > 0) {
          console.log(
            `✅ Found ${messagesWithAttachments.length} message(s) with attachments`,
          );
        }
      }

      // Process messages with clean structure
      const processedMessages = messages
        .map((msg) => {
          const isMyMessage = msg.is_sender === 1;
          const senderAttendee = uniqueAttendees.find(
            (attendee) => attendee.provider_id === msg.sender_id,
          );

          // Extract seen status - check multiple possible field names from Unipile
          // Unipile might use: seen, read, seen_at, read_at, is_seen, is_read, read_status, etc.
          let seenStatus = null;

          // Check for direct 'seen' field (most common)
          if (msg.seen !== undefined && msg.seen !== null) {
            seenStatus = msg.seen;
          }
          // Check for 'read' field (alternative naming)
          else if (msg.read !== undefined && msg.read !== null) {
            seenStatus = msg.read;
          }
          // Check for boolean 'is_seen' or 'is_read'
          else if (msg.is_seen !== undefined) {
            seenStatus = msg.is_seen ? 1 : 0;
          } else if (msg.is_read !== undefined) {
            seenStatus = msg.is_read ? 1 : 0;
          }
          // Check for timestamp-based fields (if timestamp exists, it's been seen)
          else if (msg.seen_at) {
            seenStatus = 1;
          } else if (msg.read_at) {
            seenStatus = 1;
          }
          // Default to 0 if no seen status found
          else {
            seenStatus = 0;
          }

          // Extract reactions - check multiple possible field names from Unipile
          let reactions = [];
          if (msg.reactions && Array.isArray(msg.reactions)) {
            reactions = msg.reactions;
          } else if (msg.reaction && Array.isArray(msg.reaction)) {
            reactions = msg.reaction;
          } else if (
            msg.message_reactions &&
            Array.isArray(msg.message_reactions)
          ) {
            reactions = msg.message_reactions;
          } else if (msg.reactions_data && Array.isArray(msg.reactions_data)) {
            reactions = msg.reactions_data;
          }

          // Extract attachments - check multiple possible field names from Unipile
          let attachments = [];
          if (msg.attachments && Array.isArray(msg.attachments)) {
            attachments = msg.attachments;
          } else if (msg.attachment && Array.isArray(msg.attachment)) {
            attachments = msg.attachment;
          } else if (
            msg.message_attachments &&
            Array.isArray(msg.message_attachments)
          ) {
            attachments = msg.message_attachments;
          } else if (
            msg.attachments_data &&
            Array.isArray(msg.attachments_data)
          ) {
            attachments = msg.attachments_data;
          }

          return {
            id: msg.id,
            text: msg.text,
            timestamp: msg.timestamp,
            is_my_message: isMyMessage,
            is_sender: msg.is_sender,
            sender_id: msg.sender_id,
            message_type: msg.message_type,
            delivered: msg.delivered,
            seen: seenStatus,
            reactions: reactions, // Preserve all reaction data
            attachments: attachments, // Preserve all attachment data with full fields
            // Removed duplicate profile fields
          };
        })
        .reverse(); // Reverse to show oldest first (like real chat)

      const myMessages = processedMessages.filter((msg) => msg.is_my_message);
      const attendeeMessages = processedMessages.filter(
        (msg) => !msg.is_my_message,
      );

      // Clean, polished response
      res.json({
        success: true,
        data: {
          // Clean message lists without duplicate profiles
          messages: processedMessages,
          my_messages: myMessages,
          attendee_messages: attendeeMessages,

          // Single source of truth for profiles
          participants: {
            current_user: currentUserAttendee
              ? {
                  id: currentUserAttendee.id,
                  name: currentUserAttendee.name,
                  picture_url: currentUserAttendee.picture_url,
                  profile_url: currentUserAttendee.profile_url,
                  occupation: currentUserAttendee.specifics?.occupation,
                }
              : null,

            other_attendees: otherAttendees.map((attendee) => ({
              id: attendee.id,
              name: attendee.name,
              picture_url: attendee.picture_url,
              profile_url: attendee.profile_url,
              occupation: attendee.specifics?.occupation,
              network_distance: attendee.specifics?.network_distance,
            })),
          },

          // Simplified chat info
          chat_info: {
            id: chatInfo.id,
            unread_count: chatInfo.unread_count,
            last_message: chatInfo.lastMessage
              ? {
                  text: chatInfo.lastMessage.text,
                  timestamp: chatInfo.lastMessage.timestamp,
                  is_my_message: chatInfo.lastMessage.is_sender === 1,
                }
              : null,
          },

          pagination: {
            cursor:
              messagesResponse.data?.pagination?.cursor ||
              messagesResponse.data?.cursor ||
              messagesResponse.data?.next_cursor ||
              null,
            has_more:
              messagesResponse.data?.pagination?.has_more !== undefined
                ? messagesResponse.data.pagination.has_more
                : messagesResponse.data?.has_more !== undefined
                  ? messagesResponse.data.has_more
                  : !!messagesResponse.data?.cursor ||
                    !!messagesResponse.data?.pagination?.cursor,
            limit: parseInt(limit),
            total:
              messagesResponse.data?.pagination?.total ||
              messagesResponse.data?.total ||
              processedMessages.length,
          },
        },
        meta: {
          account_id: accountId,
          chat_id: chatId,
          user_id: userId,
          total_messages: processedMessages.length,
          my_message_count: myMessages.length,
          attendee_message_count: attendeeMessages.length,
          participant_count: uniqueAttendees.length,
        },
      });
    } catch (err) {
      console.error("Polished messages API error:", err.message);
      handleError(err, res);
    }
  },
);

// ==================== ACCOUNT MANAGEMENT ENDPOINTS ====================

// Get LinkedIn account status for a user (from database)
router.get("/api/unipile/account/status/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "user_id is required",
      });
    }

    const result = await getLinkedInAccountStatus(userId);
    res.json(result);
  } catch (err) {
    console.error("Error getting account status:", err);
    res.status(500).json({
      success: false,
      error: "Failed to get account status",
    });
  }
});

// Get live LinkedIn account status from Unipile API
router.get("/api/unipile/account/live-status/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "user_id is required",
      });
    }

    // First, get the account_id from our database
    const dbResult = await getLinkedInAccountStatus(userId);

    if (!dbResult.success || !dbResult.account_id) {
      return res.json({
        success: true,
        connected: false,
        message: "No LinkedIn account found in database",
        source: "database",
      });
    }

    // Now fetch live status from Unipile
    const response = await axios.get(
      `${getBaseUrl()}/accounts/${dbResult.account_id}`,
      { headers: getHeaders() },
    );

    const unipileAccount = response.data;

    // Parse the Unipile response to determine connection status
    let isConnected = false;
    let connectionStatus = "unknown";
    let lastError = null;
    let sources = [];
    let linkedinProfile = null;

    if (unipileAccount && unipileAccount.sources) {
      sources = unipileAccount.sources;

      // Check if any source has status "OK" (based on your API response)
      const activeSource = sources.find(
        (source) =>
          source.status === "OK" ||
          source.status === "active" ||
          source.status === "connected",
      );

      if (activeSource) {
        isConnected = true;
        connectionStatus = activeSource.status;
      } else {
        isConnected = false;
        connectionStatus = sources.length > 0 ? sources[0].status : "unknown";
        lastError = sources.length > 0 ? sources[0].error : "No active sources";
      }
    }

    // Extract LinkedIn profile information if available
    if (
      unipileAccount.connection_params &&
      unipileAccount.connection_params.im
    ) {
      linkedinProfile = {
        id: unipileAccount.connection_params.im.id,
        publicIdentifier: unipileAccount.connection_params.im.publicIdentifier,
        username: unipileAccount.connection_params.im.username,
        premiumId: unipileAccount.connection_params.im.premiumId,
        premiumFeatures: unipileAccount.connection_params.im.premiumFeatures,
        organizations: unipileAccount.connection_params.im.organizations,
      };
    }

    // Update database if status changed
    if (isConnected !== dbResult.connected) {
      if (isConnected) {
        await connectLinkedInAccount(
          userId,
          dbResult.account_id,
          "LINKEDIN",
          dbResult.name,
          {
            ...dbResult.metadata,
            last_live_check: new Date(),
            live_status: connectionStatus,
          },
        );
      } else {
        await disconnectLinkedInAccount(
          userId,
          lastError || "Account disconnected (live check)",
        );
      }
    }

    res.json({
      success: true,
      connected: isConnected,
      account_id: dbResult.account_id,
      name: unipileAccount.name || dbResult.name,
      type: unipileAccount.type,
      created_at: unipileAccount.created_at,
      connection_status: connectionStatus,
      last_error: lastError,
      sources: sources,
      linkedin_profile: linkedinProfile,
      unipile_data: unipileAccount,
      last_checked: new Date(),
      source: "unipile_live",
      database_status: {
        connected: dbResult.connected,
        connected_at: dbResult.connected_at,
        last_error: dbResult.last_error,
      },
    });
  } catch (err) {
    console.error("Error getting live account status:", err);

    // If Unipile API fails, fall back to database status
    try {
      const dbResult = await getLinkedInAccountStatus(req.params.userId);
      res.json({
        success: true,
        connected: dbResult.connected || false,
        account_id: dbResult.account_id,
        name: dbResult.name,
        last_error: dbResult.last_error,
        source: "database_fallback",
        unipile_error: err.response?.data?.error || err.message,
        note: "Unipile API unavailable, showing database status",
      });
    } catch (dbErr) {
      res.status(500).json({
        success: false,
        error: "Failed to get account status from both Unipile and database",
        unipile_error: err.response?.data?.error || err.message,
        database_error: dbErr.message,
      });
    }
  }
});

// Disconnect LinkedIn account
router.post("/api/unipile/account/disconnect", async (req, res) => {
  try {
    const { user_id, reason } = req.body;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: "user_id is required",
      });
    }

    // Get current status before disconnect
    const currentAccount = await getAccountStatus(user_id);
    console.log("Before disconnect - Status:", currentAccount.status);

    const result = await disconnectLinkedInAccount(user_id, reason);

    // Verify status was updated
    const updatedAccount = await getAccountStatus(user_id);
    console.log("After disconnect - Status:", updatedAccount.status);

    res.json({
      ...result,
      previous_status: currentAccount.status,
      current_status: updatedAccount.status,
    });
  } catch (err) {
    console.error("Error disconnecting account:", err);
    res.status(500).json({
      success: false,
      error: "Failed to disconnect account",
    });
  }
});

// Refresh LinkedIn account (reconnect with new credentials)
router.post("/api/unipile/account/refresh", async (req, res) => {
  try {
    const { user_id, access_token, user_agent, name } = req.body;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: "user_id is required",
      });
    }

    if (!access_token || !user_agent) {
      return res.status(400).json({
        success: false,
        error: "access_token (li_at) and user_agent are required for refresh",
      });
    }

    // Create new account with Unipile using FormData
    const form = new FormData();

    form.append("provider", "LINKEDIN");
    form.append("access_token", access_token);
    form.append("user_agent", user_agent);

    const response = await axios.post(`${getBaseUrl()}/accounts`, form, {
      headers: {
        "X-API-KEY": process.env.UNIPILE_API_KEY,
        ...form.getHeaders(),
      },
    });

    if (response.data && response.data.account_id) {
      // Update database with new account
      const dbResult = await refreshLinkedInAccount(
        user_id,
        response.data.account_id,
        name || "LinkedIn Account",
        {
          user_agent: user_agent,
          connected_via: "refresh",
          unipile_response: response.data,
        },
      );

      res.json({
        success: true,
        data: response.data,
        message: "LinkedIn account refreshed successfully",
        stored_in_db: dbResult.success,
      });
    } else {
      res.status(400).json({
        success: false,
        error: "Failed to create new account with Unipile",
      });
    }
  } catch (err) {
    console.error("Error refreshing account:", err);
    handleError(err, res);
  }
});

// Delete LinkedIn account completely
router.delete("/api/unipile/account/delete/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "user_id is required",
      });
    }

    // 1. Get the account_id from our database first
    const dbResult = await getLinkedInAccountStatus(userId);
    let unipileDeletionStatus = "skipped";

    if (dbResult.success && dbResult.account_id) {
      try {
        console.log(`Deleting account ${dbResult.account_id} from Unipile...`);
        // 2. Delete from Unipile
        await axios.delete(`${getBaseUrl()}/accounts/${dbResult.account_id}`, {
          headers: getHeaders(),
        });
        unipileDeletionStatus = "success";
        console.log("Successfully deleted from Unipile");
      } catch (unipileErr) {
        console.error(
          "Error deleting from Unipile:",
          unipileErr.response?.data || unipileErr.message,
        );
        // We continue to delete from DB even if Unipile fails (e.g. 404 if already deleted)
        unipileDeletionStatus = "failed";
      }
    } else {
      console.log("No account_id found, skipping Unipile deletion");
    }

    // 3. Delete from our database
    const result = await deleteLinkedInAccount(userId);

    res.json({
      ...result,
      unipile_deletion: unipileDeletionStatus,
    });
  } catch (err) {
    console.error("Error deleting account:", err);
    res.status(500).json({
      success: false,
      error: "Failed to delete account",
    });
  }
});

// Restart LinkedIn account (restore connection)
router.post("/api/unipile/account/restart/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "user_id is required",
      });
    }

    // First, get the account_id from our database
    const dbResult = await getLinkedInAccountStatus(userId);

    if (!dbResult.success || !dbResult.account_id) {
      return res.status(404).json({
        success: false,
        error: "No LinkedIn account found for this user",
      });
    }

    // Call Unipile restart API
    const response = await axios.post(
      `${getBaseUrl()}/accounts/${dbResult.account_id}/restart`,
      {},
      { headers: getHeaders() },
    );

    // Update database to reflect restart attempt
    await connectLinkedInAccount(
      userId,
      dbResult.account_id,
      "LINKEDIN",
      dbResult.name,
      {
        ...dbResult.metadata,
        last_restart_attempt: new Date(),
        restart_response: response.data,
        connected_via: dbResult.metadata?.connected_via || "restart",
      },
    );

    res.json({
      success: true,
      message: "Account restart initiated successfully",
      account_id: dbResult.account_id,
      user_id: userId,
      unipile_response: response.data,
      restart_attempted_at: new Date(),
    });
  } catch (err) {
    console.error("Error restarting account:", err);

    // If restart fails, still update database with error
    try {
      const dbResult = await getLinkedInAccountStatus(req.params.userId);
      if (dbResult.success && dbResult.account_id) {
        await disconnectLinkedInAccount(
          req.params.userId,
          `Restart failed: ${err.response?.data?.error || err.message}`,
        );
      }
    } catch (dbErr) {
      console.error("Error updating database after restart failure:", dbErr);
    }

    res.status(500).json({
      success: false,
      error: "Failed to restart account",
      unipile_error: err.response?.data?.error || err.message,
      account_id: err.config?.url?.split("/").pop() || "unknown",
    });
  }
});

// Get LinkedIn account details by account_id (Pure Unipile API)
router.get("/api/unipile/account/:accountId/details", async (req, res) => {
  try {
    const { accountId } = req.params;

    if (!accountId) {
      return res.status(400).json({
        success: false,
        error: "account_id is required",
      });
    }

    // Fetch account details from Unipile only
    const response = await axios.get(`${getBaseUrl()}/accounts/${accountId}`, {
      headers: getHeaders(),
    });

    const unipileAccount = response.data;

    // Return pure Unipile response with minimal processing
    res.json({
      success: true,
      data: {
        account_id: unipileAccount.id,
        provider: unipileAccount.provider || unipileAccount.type,
        status: unipileAccount.status,
        username: unipileAccount.username,
        name: unipileAccount.name,
        created_at: unipileAccount.created_at,
        last_sync: unipileAccount.last_sync,
        profile: unipileAccount.profile,
        connection_params: unipileAccount.connection_params,
        sources: unipileAccount.sources,
        groups: unipileAccount.groups,
        object: unipileAccount.object,
        fetched_at: new Date(),
        source: "unipile_api",
      },
    });
  } catch (err) {
    console.error("Error getting account details:", err);

    res.status(500).json({
      success: false,
      error: "Failed to get account details",
      unipile_error: err.response?.data?.error || err.message,
      account_id: accountId,
    });
  }
});

// ==================== LINKEDIN CONNECTION INVITE ====================

// Send LinkedIn connection request

/**
 * LinkedIn Connection Invite (provider_id-based)
 *
 * Frontend payload (recommended):
 * { "user_id": "...", "provider_id": "...", "message": "..." }
 *
 * Optional fields to keep the previous response recipient format richer:
 * - profile_identifier (public identifier)
 * - profile_url
 * - name
 * - headline
 */
router.post("/api/unipile/linkedin/invite", async (req, res) => {
  let invitePayload = null; // Declare at function scope for error handling

  try {
    const {
      account_id,
      user_id,
      provider_id,
      message,
      profile_identifier,
      profile_url,
      name,
      headline,
    } = req.body;

    // Get account_id from user_id if not provided
    let finalAccountId = account_id;
    if (!finalAccountId && user_id) {
      const dbResult = await getLinkedInAccountStatus(user_id);
      if (dbResult.success && dbResult.account_id) {
        finalAccountId = dbResult.account_id;
      }
    }

    // Validation
    if (!finalAccountId) {
      invitePayload = {
        account_id: finalAccountId || null,
        provider_id: provider_id || null,
        ...(message && message.trim() ? { message: message.trim() } : {}),
      };
      return res.status(400).json({
        success: false,
        error: "account_id or user_id is required",
        invitePayload: invitePayload,
      });
    }

    if (!provider_id) {
      invitePayload = {
        account_id: finalAccountId,
        provider_id: null,
        ...(message && message.trim() ? { message: message.trim() } : {}),
      };
      return res.status(400).json({
        success: false,
        error: "provider_id is required",
        invitePayload: invitePayload,
      });
    }

    // Build JSON payload for Unipile
    invitePayload = {
      account_id: finalAccountId,
      provider_id: provider_id,
    };

    // Only add message if provided
    if (message && message.trim()) {
      invitePayload.message = message.trim();
      if (invitePayload.message.length > 300) {
        return res.status(400).json({
          success: false,
          error: "message is too long (max 300 characters)",
          invitePayload: invitePayload,
        });
      }
    }

    console.log("Sending invitation with payload:", invitePayload);

    const inviteResponse = await axios.post(
      `${getBaseUrl()}/users/invite`,
      invitePayload,
      {
        headers: getHeaders("application/json"),
      },
    );

    res.json({
      success: true,
      data: inviteResponse.data,
      message: "Connection request sent successfully",
      invitePayload: invitePayload,
      recipient: {
        identifier: profile_identifier || null,
        provider_id: provider_id,
        name: name || null,
        headline: headline || null,
        profile_url: profile_url || null,
      },
      account_id: finalAccountId,
      invitation_sent_at: new Date(),
    });
  } catch (err) {
    console.error("LinkedIn invitation error:", {
      status: err.response?.status,
      statusText: err.response?.statusText,
      error: err.response?.data,
      message: err.message,
      url: err.config?.url,
    });

    // If invitePayload is null, try to reconstruct it from request body
    if (!invitePayload) {
      const { account_id, user_id, provider_id, message } = req.body;

      // Try to get account_id from user_id if not provided
      let finalAccountId = account_id;
      if (!finalAccountId && user_id) {
        try {
          const dbResult = await getLinkedInAccountStatus(user_id);
          if (dbResult.success && dbResult.account_id) {
            finalAccountId = dbResult.account_id;
          }
        } catch (dbErr) {
          // Ignore DB errors during error reconstruction
        }
      }

      invitePayload = {
        account_id: finalAccountId || null,
        provider_id: provider_id || null,
        ...(message && message.trim() ? { message: message.trim() } : {}),
      };
    }

    // If Unipile returned an error response, forward it directly
    if (err.response?.data) {
      const unipileError = err.response.data;
      const statusCode = err.response.status;

      return res.status(statusCode).json({
        success: false,
        status: statusCode,
        statusText: err.response?.statusText,
        error: unipileError,
        message: err.message,
        url: err.config?.url,
        invitePayload: invitePayload,
      });
    }

    const status = err.response?.status || 500;
    const errorMessage =
      err.response?.data?.error || err.message || "Internal server error";

    res.status(status).json({
      success: false,
      error: errorMessage,
      invitePayload: invitePayload,
    });
  }
});

// Legacy (linkedin profile URL-based) invite endpoint preserved for future use.
router.post("/api/unipile/linkedin/invite-legacy", async (req, res) => {
  let invitePayload = null; // Declare at function scope for error handling

  try {
    const { account_id, user_id, profile_url, profile_identifier, message } =
      req.body;

    // Get account_id from user_id if not provided
    let finalAccountId = account_id;
    if (!finalAccountId && user_id) {
      const dbResult = await getLinkedInAccountStatus(user_id);
      if (dbResult.success && dbResult.account_id) {
        finalAccountId = dbResult.account_id;
      }
    }

    // Validation
    if (!finalAccountId) {
      // Build partial invitePayload for error response
      invitePayload = {
        account_id: finalAccountId || null,
        provider_id: null,
        ...(message && message.trim() ? { message: message.trim() } : {}),
      };
      return res.status(400).json({
        success: false,
        error: "account_id or user_id is required",
        invitePayload: invitePayload,
      });
    }

    if (!profile_url && !profile_identifier) {
      // Build partial invitePayload for error response
      invitePayload = {
        account_id: finalAccountId,
        provider_id: null,
        ...(message && message.trim() ? { message: message.trim() } : {}),
      };
      return res.status(400).json({
        success: false,
        error: "Either profile_url or profile_identifier is required",
        invitePayload: invitePayload,
      });
    }

    // Extract LinkedIn identifier from URL
    let recipientIdentifier = profile_identifier;
    if (profile_url && !profile_identifier) {
      const patterns = [
        /linkedin\.com\/in\/([^\/\?#]+)/,
        /linkedin\.com\/sales\/people\/([^,]+)/,
        /linkedin\.com\/sales\/lead\/([^,]+)/,
      ];

      let match = null;
      for (const pattern of patterns) {
        match = profile_url.match(pattern);
        if (match) {
          recipientIdentifier = match[1];
          break;
        }
      }

      if (!match) {
        // Build partial invitePayload for error response
        invitePayload = {
          account_id: finalAccountId,
          provider_id: null,
          ...(message && message.trim() ? { message: message.trim() } : {}),
        };
        return res.status(400).json({
          success: false,
          error:
            "Invalid LinkedIn profile URL format. Expected: https://linkedin.com/in/username",
          invitePayload: invitePayload,
        });
      }
    }

    console.log("Step 1: Fetching user details for:", recipientIdentifier);

    // STEP 1: Get user details to obtain provider_id
    const userResponse = await axios.get(
      `${getBaseUrl()}/users/${encodeURIComponent(
        recipientIdentifier,
      )}?account_id=${finalAccountId}`,
      { headers: getHeaders() },
    );

    if (!userResponse.data || !userResponse.data.provider_id) {
      // Build partial invitePayload for error response
      invitePayload = {
        account_id: finalAccountId,
        provider_id: null,
        ...(message && message.trim() ? { message: message.trim() } : {}),
      };
      return res.status(404).json({
        success: false,
        error: "Could not find LinkedIn user or retrieve provider_id",
        identifier: recipientIdentifier,
        user_response: userResponse.data,
        invitePayload: invitePayload,
      });
    }

    const providerUserId = userResponse.data.provider_id;
    console.log("Step 2: Found provider_id:", providerUserId);

    // STEP 2: Send invitation - Build JSON payload
    invitePayload = {
      account_id: finalAccountId,
      provider_id: providerUserId,
    };

    // Only add message if provided
    if (message && message.trim()) {
      invitePayload.message = message.trim();
      if (invitePayload.message.length > 300) {
        return res.status(400).json({
          success: false,
          error: "message is too long (max 300 characters)",
          invitePayload: invitePayload,
        });
      }
    }

    console.log("Step 3: Sending invitation with payload:", invitePayload);

    // Send as JSON, not FormData
    const inviteResponse = await axios.post(
      `${getBaseUrl()}/users/invite`,
      invitePayload,
      {
        headers: getHeaders("application/json"),
      },
    );

    console.log("Step 4: Invitation sent successfully");

    res.json({
      success: true,
      data: inviteResponse.data,
      message: "Connection request sent successfully",
      invitePayload: invitePayload,
      recipient: {
        identifier: recipientIdentifier,
        provider_id: providerUserId,
        name: userResponse.data.name || null,
        headline: userResponse.data.headline || null,
        profile_url: userResponse.data.profile_url || profile_url,
      },
      account_id: finalAccountId,
      invitation_sent_at: new Date(),
    });
  } catch (err) {
    // Enhanced logging with full error details
    console.error("LinkedIn invitation error:", {
      status: err.response?.status,
      statusText: err.response?.statusText,
      error: err.response?.data,
      message: err.message,
      url: err.config?.url,
    });

    // If invitePayload is null, try to reconstruct it from request body
    if (!invitePayload) {
      const { account_id, user_id, message } = req.body;

      // Try to get account_id from user_id if not provided
      let finalAccountId = account_id;
      if (!finalAccountId && user_id) {
        try {
          const dbResult = await getLinkedInAccountStatus(user_id);
          if (dbResult.success && dbResult.account_id) {
            finalAccountId = dbResult.account_id;
          }
        } catch (dbErr) {
          // Ignore DB errors during error reconstruction
        }
      }

      invitePayload = {
        account_id: finalAccountId || null,
        provider_id: null,
        ...(message && message.trim() ? { message: message.trim() } : {}),
      };
    }

    // If Unipile returned an error response, forward it directly
    if (err.response?.data) {
      const unipileError = err.response.data;
      const statusCode = err.response.status;

      return res.status(statusCode).json({
        success: false,
        status: statusCode,
        statusText: err.response?.statusText,
        error: unipileError,
        message: err.message,
        url: err.config?.url,
        invitePayload: invitePayload,
      });
    }

    // Handle network errors or other non-Unipile errors
    const status = err.response?.status || 500;
    const errorMessage =
      err.response?.data?.error || err.message || "Internal server error";

    res.status(status).json({
      success: false,
      error: errorMessage,
      invitePayload: invitePayload,
    });
  }
});

/**
 * Direct LinkedIn Invite API
 * Used when provider_id and account_id are already known.
 * Simply calls Unipile /users/invite directly.
 */
router.post("/api/unipile/linkedin/directinvite", async (req, res) => {
  try {
    const { provider_id, account_id } = req.body;

    // Basic validation
    if (!provider_id || !account_id) {
      return res.status(400).json({
        success: false,
        error: "provider_id and account_id are required",
      });
    }

    console.log("🚀 Direct invite triggered:", { provider_id, account_id });

    const payload = {
      provider_id,
      account_id,
    };

    // Make Unipile API call
    const response = await axios.post(`${getBaseUrl()}/users/invite`, payload, {
      headers: getHeaders("application/json"),
    });

    console.log("✅ Direct invite success:", response.data);

    res.json({
      success: true,
      data: response.data,
      message: "Direct connection request sent successfully",
      payload_sent: payload,
      invited_at: new Date(),
    });
  } catch (err) {
    console.error("❌ Direct invite error:", {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message,
      url: err.config?.url,
    });

    if (err.response?.data) {
      return res.status(err.response.status || 500).json({
        success: false,
        error: err.response.data,
        message: err.message,
        url: err.config?.url,
      });
    }

    handleError(err, res);
  }
});

// ==================== CHECK CONNECTION STATUS ====================

// Check if a specific user is in your network
router.get(
  "/api/unipile/linkedin/connection-status/:identifier",
  async (req, res) => {
    try {
      const { identifier } = req.params;
      const { account_id, user_id } = req.query;

      // Get account_id from user_id if not provided
      let finalAccountId = account_id;
      if (!finalAccountId && user_id) {
        const dbResult = await getLinkedInAccountStatus(user_id);
        if (dbResult.success && dbResult.account_id) {
          finalAccountId = dbResult.account_id;
        }
      }

      if (!finalAccountId) {
        return res.status(400).json({
          success: false,
          error: "account_id or user_id is required",
        });
      }

      // Get user details first
      const userResponse = await axios.get(
        `${getBaseUrl()}/users/${encodeURIComponent(
          identifier,
        )}?account_id=${finalAccountId}`,
        { headers: getHeaders() },
      );

      if (!userResponse.data || !userResponse.data.provider_id) {
        return res.status(404).json({
          success: false,
          error: "User not found",
          identifier: identifier,
        });
      }

      const providerUserId = userResponse.data.provider_id;

      let connectionStatus = "not_connected";
      let connectionData = null;
      let invitationData = null;

      // Check existing connections
      try {
        const connectionsResponse = await axios.get(
          `${getBaseUrl()}/connections?account_id=${finalAccountId}&limit=1000`,
          { headers: getHeaders() },
        );

        const existingConnection = connectionsResponse.data.items?.find(
          (connection) => connection.provider_id === providerUserId,
        );

        if (existingConnection) {
          connectionStatus = "connected";
          connectionData = existingConnection;
        }
      } catch (connectionsError) {
        console.warn("Could not fetch connections:", connectionsError.message);
      }

      // Check pending invitations if not connected
      if (connectionStatus === "not_connected") {
        try {
          const invitationsResponse = await axios.get(
            `${getBaseUrl()}/users/invitations/sent?account_id=${finalAccountId}`,
            { headers: getHeaders() },
          );

          const pendingInvitation = invitationsResponse.data.items?.find(
            (invitation) => invitation.provider_id === providerUserId,
          );

          if (pendingInvitation) {
            connectionStatus = "invitation_pending";
            invitationData = pendingInvitation;
          }
        } catch (invitationsError) {
          console.warn(
            "Could not fetch invitations:",
            invitationsError.message,
          );
        }
      }

      res.json({
        success: true,
        connection_status: connectionStatus,
        user: {
          identifier: identifier,
          provider_id: providerUserId,
          name: userResponse.data.name || null,
          headline: userResponse.data.headline || null,
          profile_url: userResponse.data.profile_url || null,
        },
        connection: connectionData,
        invitation: invitationData,
        checked_at: new Date(),
      });
    } catch (err) {
      console.error(
        "Connection status check error:",
        err.response?.data || err.message,
      );

      if (err.response?.status === 404) {
        return res.status(404).json({
          success: false,
          error: "User not found",
          identifier: req.params.identifier,
        });
      }

      handleError(err, res);
    }
  },
);

// ==================== ENHANCED CONNECTION STATUS WITH INVITATION TRACKING ====================

// ==================== GET USER DETAILS (Helper) ====================

router.get(
  "/api/unipile/linkedin/fetch-profile/:identifier",
  async (req, res) => {
    try {
      const { identifier } = req.params;
      const { account_id, user_id, force_refresh } = req.query;

      // Get account_id from user_id if not provided
      let finalAccountId = account_id;
      if (!finalAccountId && user_id) {
        const dbResult = await getLinkedInAccountStatus(user_id);
        if (dbResult.success && dbResult.account_id) {
          finalAccountId = dbResult.account_id;
        }
      }

      if (!finalAccountId) {
        return res.status(400).json({
          success: false,
          error: "account_id or user_id is required",
        });
      }

      /**
       * NOTE: Profile caching is intentionally disabled for this endpoint.
       * Reason: Unipile's `/users/:identifier` payload can include dynamic fields
       * (e.g. `invitation`) that must remain fresh for the profile screen UX.
       *
       * We keep caching for bulk/enrichment endpoints (batch-profiles, chats, search).
       */
      console.log(
        `🔄 Fetching fresh profile for ${identifier} (account: ${finalAccountId})`,
      );
      const response = await axios.get(
        `${getBaseUrl()}/users/${encodeURIComponent(
          identifier,
        )}?account_id=${finalAccountId}`,
        { headers: getHeaders() },
      );

      const userProfile = response.data;
      const fromCache = false;
      let chatId = null;
      let hasExistingChat = false;

      // Only check for chat if profile is connected (has network_distance)
      const networkDistance = userProfile?.network_distance;
      const isConnected =
        networkDistance !== undefined && networkDistance !== null;

      // Try to find chat ID only if user is connected to the profile
      if (isConnected) {
        const providerId = userProfile?.provider_id;
        const publicIdentifier = userProfile?.public_identifier || identifier;

        if (providerId || publicIdentifier) {
          // Check cache for chat lookup first
          const chatCacheKey = getChatCacheKey(
            finalAccountId,
            providerId || publicIdentifier,
          );
          let chatResult = null;
          let chatFromCache = false;

          if (force_refresh !== "true" && force_refresh !== "1") {
            const cachedChat = chatCache.get(chatCacheKey);
            if (cachedChat) {
              chatResult = cachedChat;
              chatFromCache = true;
              console.log(
                `✅ [Cache HIT] Chat lookup for ${
                  providerId || publicIdentifier
                }`,
              );
            }
          }

          // Helper function to find chat with timeout
          const findChatWithTimeout = async (timeoutMs = 3000) => {
            // Return cached result if available
            if (chatResult) {
              return chatResult;
            }

            return Promise.race([
              (async () => {
                try {
                  console.log(
                    `🔄 [Cache MISS] Fetching chats for ${
                      providerId || publicIdentifier
                    }`,
                  );
                  // Fetch chats with higher limit to find existing chats (only for connected profiles)
                  const chatsResponse = await axios.get(
                    `${getBaseUrl()}/chats?account_id=${finalAccountId}&limit=250`,
                    { headers: getHeaders() },
                  );

                  const chats =
                    chatsResponse.data?.chats ||
                    chatsResponse.data?.items ||
                    chatsResponse.data ||
                    [];
                  const chatsArray = Array.isArray(chats) ? chats : [];

                  console.log(
                    `Searching through ${
                      chatsArray.length
                    } chats for connected profile: ${
                      providerId || publicIdentifier
                    }`,
                  );

                  // First, try to find chat where attendees are included in the response
                  let userChat = chatsArray.find((chat) => {
                    const attendees = chat.attendees || chat.participants || [];
                    if (!Array.isArray(attendees)) return false;

                    return attendees.some((attendee) => {
                      // Match by provider_id (most reliable)
                      if (
                        providerId &&
                        (attendee.provider_id === providerId ||
                          attendee.id === providerId)
                      ) {
                        return true;
                      }
                      // Match by public_identifier as fallback
                      if (
                        publicIdentifier &&
                        (attendee.public_identifier === publicIdentifier ||
                          attendee.identifier === publicIdentifier ||
                          attendee.username === publicIdentifier)
                      ) {
                        return true;
                      }
                      return false;
                    });
                  });

                  // If not found in initial response, fetch attendees for limited number of chats
                  if (!userChat && chatsArray.length > 0) {
                    console.log(
                      "Chat not found in initial response, checking attendees for first 20 chats...",
                    );

                    // Only check first 20 chats to avoid long delays
                    const maxChatsToCheck = Math.min(chatsArray.length, 20);
                    for (let i = 0; i < maxChatsToCheck; i++) {
                      const chat = chatsArray[i];
                      try {
                        const currentChatId =
                          chat.id || chat.chat_id || chat.chatId;
                        if (!currentChatId) continue;

                        const attendeesResponse = await axios.get(
                          `${getBaseUrl()}/chats/${currentChatId}/attendees?account_id=${finalAccountId}`,
                          { headers: getHeaders() },
                        );

                        const attendeesData =
                          attendeesResponse.data?.attendees ||
                          attendeesResponse.data?.items ||
                          attendeesResponse.data ||
                          [];
                        const attendees = Array.isArray(attendeesData)
                          ? attendeesData
                          : [];

                        // Check for match by provider_id or public_identifier
                        const foundAttendee = attendees.find((attendee) => {
                          // Match by provider_id (most reliable)
                          if (
                            providerId &&
                            (attendee.provider_id === providerId ||
                              attendee.id === providerId ||
                              attendee.account_id === providerId)
                          ) {
                            return true;
                          }
                          // Match by public_identifier as fallback
                          if (
                            publicIdentifier &&
                            (attendee.public_identifier === publicIdentifier ||
                              attendee.identifier === publicIdentifier ||
                              attendee.username === publicIdentifier ||
                              attendee.profile_url?.includes(publicIdentifier))
                          ) {
                            return true;
                          }
                          return false;
                        });

                        if (foundAttendee) {
                          userChat = chat;
                          console.log(
                            `Found matching chat: ${currentChatId} for ${
                              providerId || publicIdentifier
                            }`,
                          );
                          break;
                        }
                      } catch (attendeeError) {
                        // Continue to next chat if this one fails
                        continue;
                      }
                    }
                  }

                  // Extract chat ID
                  if (userChat) {
                    const foundChatId =
                      userChat.id ||
                      userChat.chat_id ||
                      userChat.chatId ||
                      null;
                    console.log(
                      `Chat found: ${foundChatId} for user ${
                        providerId || publicIdentifier
                      }`,
                    );
                    const result = {
                      chatId: foundChatId,
                      hasExistingChat: !!foundChatId,
                    };

                    // Cache the chat lookup result
                    chatCache.set(chatCacheKey, result);
                    console.log(
                      `💾 [Cache SET] Chat lookup for ${
                        providerId || publicIdentifier
                      } cached for 10 minutes`,
                    );

                    return result;
                  } else {
                    console.log(
                      `No chat found for user ${providerId || publicIdentifier}`,
                    );
                    const result = { chatId: null, hasExistingChat: false };

                    // Cache negative result too (to avoid repeated lookups)
                    chatCache.set(chatCacheKey, result);

                    return result;
                  }
                } catch (chatError) {
                  console.error("Could not fetch chat ID:", chatError.message);
                  console.error(
                    "Chat error details:",
                    chatError.response?.data || chatError.message,
                  );
                  return { chatId: null, hasExistingChat: false };
                }
              })(),
              new Promise((resolve) =>
                setTimeout(() => {
                  console.log(
                    "Chat lookup timeout - returning profile without chat info",
                  );
                  resolve({
                    chatId: null,
                    hasExistingChat: false,
                    timeout: true,
                  });
                }, timeoutMs),
              ),
            ]);
          };

          // Try to find chat with 3 second timeout (non-blocking)
          try {
            if (!chatResult) {
              chatResult = await findChatWithTimeout(3000);
            }
            chatId = chatResult.chatId;
            hasExistingChat = chatResult.hasExistingChat;
          } catch (error) {
            console.error("Chat lookup error:", error.message);
            // Continue without chat ID if chat fetch fails
          }
        } else {
          console.log(
            "No provider_id or public_identifier found in user profile, skipping chat lookup",
          );
        }
      } else {
        console.log(
          "Profile not connected (no network_distance), skipping chat lookup",
        );
      }

      res.json({
        success: true,
        data: userProfile,
        user: {
          provider_id: userProfile.provider_id,
          name: userProfile.name,
          headline: userProfile.headline,
          profile_url: userProfile.profile_url,
          picture: userProfile.profile_picture_url,
          identifier: identifier,
          location: userProfile.location,
          industry: userProfile.industry,
          summary: userProfile.summary,
          experience: userProfile.experience,
          education: userProfile.education,
          skills: userProfile.skills,
          connections_count: userProfile.connections_count,
          followers_count: userProfile.follower_count,
        },
        chat_info: {
          chat_id: chatId,
          has_existing_chat: hasExistingChat,
        },
        account_id: finalAccountId,
        cached: fromCache,
        fetched_at: new Date(),
      });
    } catch (err) {
      console.error("Get user error:", err.response?.data || err.message);

      if (err.response?.status === 404) {
        return res.status(404).json({
          success: false,
          error: "User not found",
          identifier: req.params.identifier,
        });
      }

      handleError(err, res);
    }
  },
);

// Get current user's own LinkedIn profile
router.get("/api/unipile/linkedin/user/me", async (req, res) => {
  try {
    const { account_id, user_id } = req.query;

    // Get account_id from user_id if not provided
    let finalAccountId = account_id;
    if (!finalAccountId && user_id) {
      const dbResult = await getLinkedInAccountStatus(user_id);
      if (dbResult.success && dbResult.account_id) {
        finalAccountId = dbResult.account_id;
      }
    }

    // if (!finalAccountId) {
    //   return res.status(400).json({
    //     success: false,
    //     error: 'account_id or user_id is required'
    //   });
    // }

    // Call Unipile API to get current user's profile
    const response = await axios.get(
      `${getBaseUrl()}/users/me?account_id=${finalAccountId}`,
      { headers: getHeaders() },
    );

    res.json({
      success: true,
      data: response.data,
      profile: {
        provider_id: response.data.provider_id,
        name: response.data.name,
        headline: response.data.headline,
        profile_url: response.data.profile_url,
        picture: response.data.picture,
        location: response.data.location,
        industry: response.data.industry,
        summary: response.data.summary,
        experience: response.data.experience,
        education: response.data.education,
        skills: response.data.skills,
        connections_count: response.data.connections_count,
        followers_count: response.data.followers_count,
        premium_features: response.data.premium_features,
        organizations: response.data.organizations,
        contact_info: response.data.contact_info,
      },
      account_id: finalAccountId,
      fetched_at: new Date(),
    });
  } catch (err) {
    console.error(
      "Get current user profile error:",
      err.response?.data || err.message,
    );

    if (err.response?.status === 404) {
      return res.status(404).json({
        success: false,
        message: "User profile not found",
        details: "User has not connected a LinkedIn account yet",
      });
    }

    handleError(err, res);
  }
});

// Check connection/invitation status
// Check connection/invitation status - FIXED VERSION
router.get("/api/unipile/linkedin/status/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    const { user_id } = req.query;

    // Validate parameters
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: "user_id query parameter is required",
      });
    }

    // Lookup account_id from DB
    const dbResult = await getLinkedInAccountStatus(user_id);
    if (!dbResult.success || !dbResult.account_id) {
      return res.status(404).json({
        success: false,
        error: "No LinkedIn account found for this user",
      });
    }

    const accountId = dbResult.account_id;
    console.log(
      `🔍 Checking LinkedIn status for: ${identifier}, account: ${accountId}`,
    );

    // STEP 1: Check connections (1st degree)
    try {
      const connectionsResponse = await axios.get(
        `${getBaseUrl()}/connections?account_id=${accountId}&search=${encodeURIComponent(
          identifier,
        )}`,
        { headers: getHeaders() },
      );

      console.log(
        "🔗 Connections check:",
        JSON.stringify(connectionsResponse.data, null, 2),
      );

      // Check if user is in connections
      const connectedUser = connectionsResponse.data.items?.find(
        (connection) =>
          connection.public_identifier === identifier ||
          connection.provider_id === identifier ||
          connection.profile_url?.includes(identifier),
      );

      if (connectedUser) {
        return res.json({
          success: true,
          status: "connected",
          user: connectedUser,
          message: "Already connected on LinkedIn",
        });
      }
    } catch (connectionsError) {
      console.log("No connections found or error:", connectionsError.message);
    }

    // STEP 2: Check pending invitations
    try {
      const invitesResponse = await axios.get(
        `${getBaseUrl()}/users/invitations/sent?account_id=${accountId}`,
        { headers: getHeaders() },
      );

      console.log(
        "📨 Pending invitations:",
        JSON.stringify(invitesResponse.data, null, 2),
      );

      // Find pending invitation for this user
      const pendingInvite = invitesResponse.data.items?.find(
        (invite) =>
          invite.user_public_identifier === identifier ||
          invite.user_provider_id === identifier ||
          invite.user_profile_url?.includes(identifier) ||
          invite.invitation_identifier === identifier,
      );

      if (pendingInvite) {
        return res.json({
          success: true,
          status: "pending",
          invitation: pendingInvite,
          message: "Invitation already sent and pending",
        });
      }
    } catch (invitesError) {
      console.log("Error checking invitations:", invitesError.message);
    }

    // STEP 3: Check if we can invite (profile exists)
    try {
      const profileResponse = await axios.get(
        `${getBaseUrl()}/users/${encodeURIComponent(
          identifier,
        )}?account_id=${accountId}`,
        { headers: getHeaders() },
      );

      console.log(
        "👤 Profile found:",
        JSON.stringify(profileResponse.data, null, 2),
      );

      // If profile exists but not connected and no pending invite
      if (profileResponse.data) {
        return res.json({
          success: true,
          status: "can_invite",
          user: profileResponse.data,
          message: "Profile found - can send invitation",
        });
      }
    } catch (profileError) {
      // Profile not found or other error
      console.log(
        "Profile check result:",
        profileError.response?.status,
        profileError.message,
      );
    }

    // If we get here, user not found or can't be invited
    res.json({
      success: true,
      status: "not_found",
      message: "User not found or cannot be invited",
    });
  } catch (err) {
    console.error(
      "❌ Error checking LinkedIn status:",
      err.response?.data || err.message,
    );

    res.status(500).json({
      success: false,
      error: "Failed to check LinkedIn status",
      details: err.message,
    });
  }
});

// ==================== COMPANY ENDPOINTS ====================

// Get Company Info
router.get("/api/unipile/companyinfo/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: "user_id is required",
      });
    }

    const dbResult = await getLinkedInAccountStatus(user_id);
    if (!dbResult.success || !dbResult.account_id) {
      return res
        .status(404)
        .json({ success: false, error: "No LinkedIn account found" });
    }

    const response = await axios.get(
      `${getBaseUrl()}/linkedin/company/${identifier}?account_id=${
        dbResult.account_id
      }`,
      { headers: getHeaders() },
    );

    res.json({
      success: true,
      data: response.data,
    });
  } catch (err) {
    handleError(err, res);
  }
});

// Reconnect a disconnected LinkedIn account in Unipile
router.post("/api/unipile/linkedin/reconnect", async (req, res) => {
  try {
    const { user_id } = req.query; // or req.body if you prefer
    const {
      auth_type, // "basic" | "cookie"
      username,
      password,
      access_token, // li_at
      premium_token, // li_a (optional)
      country,
      ip,
      proxy, // { protocol, host, port, username?, password? }
      user_agent,
      sync_limit, // { chats?: string|number, messages?: string|number }
      disabled_features, // ["linkedin_recruiter", ...]
      recruiter_contract_id,
    } = req.body;

    // 1) Validate base params
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: "user_id query parameter is required",
      });
    }

    if (!auth_type || !["basic", "cookie"].includes(auth_type)) {
      return res.status(400).json({
        success: false,
        error: 'auth_type must be "basic" or "cookie"',
      });
    }

    if (auth_type === "basic" && (!username || !password)) {
      return res.status(400).json({
        success: false,
        error: "username and password are required for basic auth",
      });
    }

    if (auth_type === "cookie" && !access_token) {
      return res.status(400).json({
        success: false,
        error: "access_token (li_at) is required for cookie auth",
      });
    }

    // 2) Lookup account_id from DB (same style as your status route)
    const dbResult = await getLinkedInAccountStatus(user_id);
    if (!dbResult.success || !dbResult.account_id) {
      return res.status(404).json({
        success: false,
        error: "No LinkedIn account found for this user",
      });
    }

    const accountId = dbResult.account_id;
    console.log(
      `♻️ Reconnecting LinkedIn for user ${user_id}, account: ${accountId}`,
    );

    // 3) Build Unipile payload
    const basePayload = {
      provider: "LINKEDIN",
      country,
      ip,
      proxy,
      user_agent,
      sync_limit,
      disabled_features,
      recruiter_contract_id,
    };

    let payload;
    if (auth_type === "basic") {
      payload = {
        ...basePayload,
        username,
        password,
      };
    } else {
      payload = {
        ...basePayload,
        access_token,
        premium_token,
      };
    }

    // 4) Call Unipile reconnect API
    // POST /api/v1/accounts/{id}
    const reconnectResponse = await axios.post(
      `${getBaseUrl()}/accounts/${accountId}`,
      payload,
      { headers: getHeaders() },
    );

    console.log(
      "✅ Reconnect response:",
      JSON.stringify(reconnectResponse.data, null, 2),
    );

    return res.json({
      success: true,
      message: "LinkedIn account reconnect triggered successfully",
      data: reconnectResponse.data,
    });
  } catch (err) {
    console.error(
      "❌ Error reconnecting LinkedIn account:",
      err.response?.data || err.message,
    );

    // Bubble up Unipile error status if available
    const status = err.response?.status || 500;
    return res.status(status).json({
      success: false,
      error: "Failed to reconnect LinkedIn account",
      details: err.response?.data || err.message,
    });
  }
});

// ==================== CACHE MANAGEMENT ====================

// Get cache statistics
router.get("/api/unipile/cache/stats", (req, res) => {
  const profileStats = profileCache.getStats();
  const chatStats = chatCache.getStats();

  res.json({
    success: true,
    cache_stats: {
      profile_cache: {
        keys: profileStats.keys,
        hits: profileStats.hits,
        misses: profileStats.misses,
        ksize: profileStats.ksize,
        vsize: profileStats.vsize,
      },
      chat_cache: {
        keys: chatStats.keys,
        hits: chatStats.hits,
        misses: chatStats.misses,
        ksize: chatStats.ksize,
        vsize: chatStats.vsize,
      },
    },
    cache_config: {
      profile_ttl: "30 minutes",
      chat_ttl: "10 minutes",
    },
  });
});

// Clear profile cache
router.delete("/api/unipile/cache/profile", (req, res) => {
  const beforeCount = profileCache.keys().length;
  profileCache.flushAll();

  res.json({
    success: true,
    message: "Profile cache cleared",
    cleared_keys: beforeCount,
  });
});

// Clear chat cache
router.delete("/api/unipile/cache/chat", (req, res) => {
  const beforeCount = chatCache.keys().length;
  chatCache.flushAll();

  res.json({
    success: true,
    message: "Chat cache cleared",
    cleared_keys: beforeCount,
  });
});

// Clear all caches
router.delete("/api/unipile/cache/all", (req, res) => {
  const profileCount = profileCache.keys().length;
  const chatCount = chatCache.keys().length;

  profileCache.flushAll();
  chatCache.flushAll();

  res.json({
    success: true,
    message: "All caches cleared",
    cleared_keys: {
      profile: profileCount,
      chat: chatCount,
      total: profileCount + chatCount,
    },
  });
});

// Clear specific profile from cache
router.delete("/api/unipile/cache/profile/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    const { account_id, user_id } = req.query;

    // Get account_id from user_id if not provided
    let finalAccountId = account_id;
    if (!finalAccountId && user_id) {
      const dbResult = await getLinkedInAccountStatus(user_id);
      if (dbResult.success && dbResult.account_id) {
        finalAccountId = dbResult.account_id;
      }
    }

    if (!finalAccountId) {
      return res.status(400).json({
        success: false,
        error: "account_id or user_id is required",
      });
    }

    const cacheKey = getProfileCacheKey(identifier, finalAccountId);
    const deleted = profileCache.del(cacheKey);

    res.json({
      success: true,
      message: deleted
        ? "Profile removed from cache"
        : "Profile not found in cache",
      cache_key: cacheKey,
      deleted: deleted,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "Failed to clear cache entry",
      message: err.message,
    });
  }
});

// ==================== HEALTH CHECK ====================

router.get("/api/unipile/health", (req, res) => {
  const profileStats = profileCache.getStats();
  const chatStats = chatCache.getStats();

  res.json({
    success: true,
    message: "Unipile API proxy is running",
    config: {
      subdomain: process.env.UNIPILE_SUBDOMAIN,
      port: process.env.UNIPILE_PORT,
      api_key_configured: !!process.env.UNIPILE_API_KEY,
    },
    cache_status: {
      profile_cache_keys: profileStats.keys,
      chat_cache_keys: chatStats.keys,
      profile_cache_hits: profileStats.hits,
      chat_cache_hits: chatStats.hits,
    },
  });
});

// ==================== Inmail Credits ====================

router.get("/api/unipile/user/:userId/inmail/credits", async (req, res) => {
  try {
    const { userId } = req.params;

    const dbResult = await getLinkedInAccountStatus(userId);
    if (!dbResult.success || !dbResult.account_id) {
      return res
        .status(404)
        .json({ success: false, error: "No LinkedIn account found" });
    }

    const accountId = dbResult.account_id;

    const response = await axios.get(
      `${getBaseUrl()}/linkedin/inmail_balance?account_id=${accountId}`,
      { headers: getHeaders() },
    );

    res.json({
      success: true,
      credits: response.data,
      account_id: accountId,
    });
  } catch (err) {
    handleError(err, res);
  }
});
// ==================== fetch all ist all invitations sent ====================

router.get("/api/unipile/user/:userId/fetch/invitations", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, cursor } = req.query;

    const dbResult = await getLinkedInAccountStatus(userId);
    if (!dbResult.success || !dbResult.account_id) {
      return res
        .status(404)
        .json({ success: false, error: "No LinkedIn account found" });
    }

    const accountId = dbResult.account_id;
    const params = new URLSearchParams();
    params.append("account_id", accountId);
    if (limit) params.append("limit", limit);
    if (cursor) params.append("cursor", cursor);

    const response = await axios.get(
      `${getBaseUrl()}/users/invite/sent?${params}`,
      { headers: getHeaders() },
    );

    let invitations = response.data.items || [];

    // Enrich with profile details if we have items
    if (invitations.length > 0) {
      // Helper to fetch profile (similar to chat enrichment)
      const fetchProfileForInvitation = async (invitation) => {
        const providerId = invitation.invited_user_id;
        const publicId = invitation.invited_user_public_id;

        if (!providerId && !publicId)
          return { ...invitation, status: "pending" }; // Default status

        // Check cache with providerId
        if (providerId) {
          const cacheKey = getProfileCacheKey(providerId, accountId);
          const cachedProfile = profileCache.get(cacheKey);
          if (cachedProfile) {
            return enrichInvitationWithProfile(invitation, cachedProfile);
          }
        }

        // Try fetching with providerId first
        if (providerId) {
          try {
            const profileResponse = await axios.get(
              `${getBaseUrl()}/users/${encodeURIComponent(
                providerId,
              )}?account_id=${accountId}`,
              { headers: getHeaders(), timeout: 5000 },
            );

            const profile = profileResponse.data;
            // Cache it
            const cacheKey = getProfileCacheKey(providerId, accountId);
            profileCache.set(cacheKey, profile);

            return enrichInvitationWithProfile(invitation, profile);
          } catch (err) {
            console.warn(
              `⚠️ Failed to fetch profile by ID ${providerId}: ${err.message}`,
            );
            // Fallthrough to try publicId
          }
        }

        // Fallback: Try fetching by publicId if available
        if (publicId) {
          try {
            const profileResponse = await axios.get(
              `${getBaseUrl()}/users/${encodeURIComponent(
                publicId,
              )}?account_id=${accountId}`,
              { headers: getHeaders(), timeout: 5000 },
            );

            const profile = profileResponse.data;
            // Cache it if we have a providerId now
            if (profile.provider_id) {
              const cacheKey = getProfileCacheKey(
                profile.provider_id,
                accountId,
              );
              profileCache.set(cacheKey, profile);
            }

            return enrichInvitationWithProfile(invitation, profile);
          } catch (err) {
            console.warn(
              `⚠️ Failed to fetch profile by Public ID ${publicId}: ${err.message}`,
            );
          }
        }

        // Absolute fallback: return original with defaults
        return {
          ...invitation,
          invitation_id: invitation.id,
          status: invitation.status || "pending",
          headline: invitation.invited_user_description || null,
          designation: invitation.invited_user_description || null,
          location: null,
        };
      };

      // Helper to merge profile data
      const enrichInvitationWithProfile = (invitation, profile) => {
        return {
          ...invitation,
          status: invitation.status || "pending", // Default to pending for sent invitations
          headline:
            profile.headline || invitation.invited_user_description || null,
          designation:
            profile.occupation ||
            profile.headline ||
            invitation.invited_user_description ||
            null,
          location: profile.location || null,
          invited_user_profile_picture_url:
            profile.profile_picture_url ||
            profile.picture ||
            invitation.invited_user_profile_picture_url ||
            null,
          // Add extra useful fields
          invitation_id: invitation.id,
          invited_user_public_identifier:
            profile.public_identifier || invitation.invited_user_public_id,
        };
      };

      // Execute in parallel
      invitations = await Promise.all(
        invitations.map(fetchProfileForInvitation),
      );
    }

    res.json({
      success: true,
      invitations: {
        items: invitations,
        cursor: response.data.cursor,
      },
      account_id: accountId,
    });
  } catch (err) {
    handleError(err, res);
  }
});

// ==================== Cancel an invitation ====================
router.delete(
  "/api/unipile/user/:userId/cancel/invitation/:invitationId",
  async (req, res) => {
    try {
      const { userId, invitationId } = req.params;

      const dbResult = await getLinkedInAccountStatus(userId);
      if (!dbResult.success || !dbResult.account_id) {
        return res
          .status(404)
          .json({ success: false, error: "No LinkedIn account found" });
      }

      const accountId = dbResult.account_id;

      // Unipile API endpoint for canceling sent invitation
      const response = await axios.delete(
        `${getBaseUrl()}/users/invite/sent/${invitationId}?account_id=${accountId}`,
        { headers: getHeaders() },
      );

      res.json({
        success: true,
        invitation_id: invitationId,
        account_id: accountId,
        message: "Invitation canceled successfully",
      });
    } catch (err) {
      handleError(err, res);
    }
  },
);
// ==================== LinkedIn Search API (Unified) ====================
// Single endpoint for all LinkedIn search operations:
// - People Search (Classic, Sales Navigator, Recruiter)
// - Companies Search (Classic, Sales Navigator)
// - Posts Search (Classic only)
// - Jobs Search (Classic only)
// - Search from URL (paste any LinkedIn search URL)
// - Get Search Parameters (location IDs, industry IDs, company IDs, etc.)
//
// USAGE:
// 1. To get Location/Industry/Company IDs:
//    GET /api/unipile/user/:userId/linkedin/search?action=parameters&type=LOCATION&keywords=India
//
// 2. To search people/companies/posts/jobs:
//    POST /api/unipile/user/:userId/linkedin/search
//    Body: { "api": "classic", "category": "people", "keywords": "Software Engineer", "location": ["102713980"] }
//
// 3. To search from LinkedIn URL:
//    POST /api/unipile/user/:userId/linkedin/search
//    Body: { "url": "https://www.linkedin.com/search/results/people/?keywords=..." }
router.all("/api/unipile/user/:userId/linkedin/search", async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      limit = 25,
      cursor,
      action,
      type,
      keywords: queryKeywords,
      api: queryApi,
    } = req.query;

    const dbResult = await getLinkedInAccountStatus(userId);
    if (!dbResult.success || !dbResult.account_id) {
      return res.status(404).json({
        success: false,
        error: "No LinkedIn account found",
      });
    }

    const accountId = dbResult.account_id;

    // ============ GET: Fetch Search Parameters (Location IDs, Industry IDs, etc.) ============
    if (req.method === "GET" || action === "parameters") {
      const paramType = type || "LOCATION";
      const keywords = queryKeywords;
      const api = queryApi || "classic";

      // Valid parameter types
      const validTypes = [
        "LOCATION",
        "REGION",
        "POSTAL_CODE",
        "INDUSTRY",
        "SALES_INDUSTRY",
        "COMPANY",
        "SCHOOL",
        "SERVICE",
        "JOB_TITLE",
        "JOB_FUNCTION",
        "DEPARTMENT",
        "SKILL",
        "GROUPS",
        "PEOPLE",
        "CONNECTIONS",
        "SAVED_SEARCHES",
        "RECENT_SEARCHES",
        "ACCOUNT_LISTS",
        "LEAD_LISTS",
        "HIRING_PROJECTS",
        "PERSONA",
        "TECHNOLOGIES",
        "DEGREE",
        "SAVED_FILTERS",
      ];

      if (!validTypes.includes(paramType.toUpperCase())) {
        return res.status(400).json({
          success: false,
          error: `Invalid type. Valid types: ${validTypes.join(", ")}`,
        });
      }

      // Build query params for Unipile API
      const params = new URLSearchParams();
      params.append("account_id", accountId);
      params.append("type", paramType);
      if (keywords) params.append("keywords", keywords);
      params.append("limit", limit);
      if (api !== "classic") params.append("api", api);

      console.log(
        `🔍 LinkedIn Search Parameters: type=${paramType}, keywords=${
          keywords || "none"
        }`,
      );

      const response = await axios.get(
        `${getBaseUrl()}/linkedin/search/parameters?${params}`,
        { headers: getHeaders() },
      );

      return res.json({
        success: true,
        data: response.data,
        type: paramType,
        keywords: keywords || null,
        account_id: accountId,
        usage: `Use the 'id' field from items to filter your search. Example: { "location": ["${
          response.data?.items?.[0]?.id || "123456"
        }"] }`,
      });
    }

    // ============ POST: Perform Search ============
    if (req.method === "POST") {
      const searchBody = req.body;

      // Handle URL-based search (just paste a LinkedIn URL)
      if (searchBody.url) {
        const params = new URLSearchParams();
        params.append("account_id", accountId);
        params.append("limit", limit);
        if (cursor) params.append("cursor", cursor);

        console.log("🔗 LinkedIn Search from URL:", searchBody.url);

        const response = await axios.post(
          `${getBaseUrl()}/linkedin/search?${params}`,
          { url: searchBody.url },
          { headers: getHeaders() },
        );

        return res.json({
          success: true,
          data: response.data,
          search_type: "from_url",
          source_url: searchBody.url,
          account_id: accountId,
          results_count: response.data?.items?.length || 0,
        });
      }

      // Validate required fields for regular search
      if (!searchBody.api) {
        return res.status(400).json({
          success: false,
          error: "Missing required field: api",
          valid_values: ["classic", "sales_navigator", "recruiter"],
          note: "You can pass location/industry/company/school as names (e.g., 'India') - they will be auto-converted to IDs!",
          examples: {
            people_search: {
              api: "classic",
              category: "people",
              keywords: "Software Engineer",
              location: ["India", "Hyderabad"], // Names auto-convert to IDs!
            },
            companies_search: {
              api: "classic",
              category: "companies",
              keywords: "Technology",
              industry: ["Software Development"], // Names auto-convert to IDs!
              has_job_offers: true,
            },
            posts_search: {
              api: "classic",
              category: "posts",
              keywords: "AI",
              date_posted: "past_week",
            },
            jobs_search: {
              api: "classic",
              category: "jobs",
              keywords: "Developer",
              location: ["Remote"],
              presence: ["remote"],
            },
          },
        });
      }

      if (!searchBody.category) {
        return res.status(400).json({
          success: false,
          error: "Missing required field: category",
          valid_values: ["people", "companies", "posts", "jobs"],
        });
      }

      // Hardcode network_distance to [1, 2, 3] for people search only
      if (searchBody.category === "people") {
        if (!searchBody.network_distance) {
          searchBody.network_distance = [1, 2, 3];
        }
      }

      // ============ AUTO-CONVERT STRING NAMES TO IDs ============
      // Helper function to check if a value is a numeric ID
      const isNumericId = (val) => /^\d+$/.test(String(val));

      // Helper function to resolve names to IDs
      const resolveNamesToIds = async (values, paramType) => {
        if (!values || !Array.isArray(values) || values.length === 0) {
          return values;
        }

        const resolvedIds = [];
        const unresolvedNames = [];

        // Score how well a result title matches the search query
        const matchScore = (title, query) => {
          const t = title.toLowerCase();
          const q = query.toLowerCase();
          if (t === q) return 100; // Exact match
          if (t.startsWith(q)) return 80; // Starts with query
          if (t.includes(q)) return 60; // Contains query
          if (q.split(/\s+/).every((word) => t.includes(word))) return 40; // All words present
          return 0;
        };

        for (const value of values) {
          // If already a numeric ID, keep it
          if (isNumericId(value)) {
            resolvedIds.push(value);
            continue;
          }

          // It's a name string, resolve to ID
          try {
            const lookupParams = new URLSearchParams();
            lookupParams.append("account_id", accountId);
            lookupParams.append("type", paramType);
            lookupParams.append("keywords", value);
            lookupParams.append("limit", "15");

            console.log(`🔄 Resolving ${paramType}: "${value}" to ID...`);

            const lookupResponse = await axios.get(
              `${getBaseUrl()}/linkedin/search/parameters?${lookupParams}`,
              { headers: getHeaders() },
            );

            let items = lookupResponse.data?.items || [];

            // If no results, try with individual words (e.g., "Finance" might match "Financial Services")
            if (items.length === 0 && value.length >= 3) {
              // Retry with a shorter/broader keyword (first word or trimmed)
              const words = value.trim().split(/\s+/);
              if (words.length > 1) {
                // Try first word only
                const retryParams = new URLSearchParams();
                retryParams.append("account_id", accountId);
                retryParams.append("type", paramType);
                retryParams.append("keywords", words[0]);
                retryParams.append("limit", "15");

                console.log(
                  `🔄 Retrying ${paramType} with broader keyword: "${words[0]}"...`,
                );

                const retryResponse = await axios.get(
                  `${getBaseUrl()}/linkedin/search/parameters?${retryParams}`,
                  { headers: getHeaders() },
                );
                items = retryResponse.data?.items || [];
              }
            }

            if (items.length > 0) {
              // Score all results and pick the best match
              const scored = items
                .map((item) => ({
                  ...item,
                  score: matchScore(item.title, value),
                }))
                .filter((item) => item.score > 0)
                .sort((a, b) => b.score - a.score);

              if (scored.length > 0) {
                const best = scored[0];
                console.log(
                  `✅ Resolved "${value}" → ${best.id} (${best.title}, score: ${best.score})`,
                );
                resolvedIds.push(best.id);
              } else {
                // No good match by score, use the first result as fallback
                const fallback = items[0];
                console.log(
                  `✅ Resolved "${value}" → ${fallback.id} (${fallback.title}, best available match)`,
                );
                resolvedIds.push(fallback.id);
              }
            } else {
              console.warn(
                `⚠️ No ${paramType} found for: "${value}" — skipped`,
              );
              unresolvedNames.push(value);
            }
          } catch (err) {
            console.error(
              `❌ Failed to resolve ${paramType} "${value}":`,
              err.message,
            );
            unresolvedNames.push(value);
          }
        }

        if (unresolvedNames.length > 0) {
          console.warn(
            `⚠️ Could not resolve ${paramType}: ${unresolvedNames.join(", ")}`,
          );
        }

        return resolvedIds.length > 0 ? resolvedIds : undefined;
      };

      // Helper to resolve include/exclude nested objects (Sales Navigator format)
      const resolveNestedObject = async (obj, paramType) => {
        if (!obj || typeof obj !== "object") return obj;
        if (obj.include && Array.isArray(obj.include)) {
          const hasNames = obj.include.some((v) => !isNumericId(v));
          if (hasNames) {
            obj.include = await resolveNamesToIds(obj.include, paramType);
          }
        }
        if (obj.exclude && Array.isArray(obj.exclude)) {
          const hasNames = obj.exclude.some((v) => !isNumericId(v));
          if (hasNames) {
            obj.exclude = await resolveNamesToIds(obj.exclude, paramType);
          }
        }
        return obj;
      };

      // Auto-resolve location names to IDs
      // Sales Navigator People uses REGION; SN Companies uses LOCATION; Classic uses LOCATION
      const locationParamType =
        searchBody.api === "sales_navigator" && searchBody.category === "people"
          ? "REGION"
          : "LOCATION";
      if (searchBody.location && Array.isArray(searchBody.location)) {
        const hasNames = searchBody.location.some((v) => !isNumericId(v));
        if (hasNames) {
          searchBody.location = await resolveNamesToIds(
            searchBody.location,
            locationParamType,
          );
        }
      } else if (
        searchBody.location &&
        typeof searchBody.location === "object"
      ) {
        searchBody.location = await resolveNestedObject(
          searchBody.location,
          locationParamType,
        );
      }

      // Auto-resolve industry names to IDs
      const industryParamType =
        searchBody.api === "sales_navigator" ? "SALES_INDUSTRY" : "INDUSTRY";
      if (searchBody.industry && Array.isArray(searchBody.industry)) {
        const hasNames = searchBody.industry.some((v) => !isNumericId(v));
        if (hasNames) {
          searchBody.industry = await resolveNamesToIds(
            searchBody.industry,
            industryParamType,
          );
        }
      } else if (
        searchBody.industry &&
        typeof searchBody.industry === "object"
      ) {
        searchBody.industry = await resolveNestedObject(
          searchBody.industry,
          industryParamType,
        );
      }

      // Auto-resolve company names to IDs
      if (searchBody.company && Array.isArray(searchBody.company)) {
        const hasNames = searchBody.company.some((v) => !isNumericId(v));
        if (hasNames) {
          searchBody.company = await resolveNamesToIds(
            searchBody.company,
            "COMPANY",
          );
        }
      } else if (searchBody.company && typeof searchBody.company === "object") {
        searchBody.company = await resolveNestedObject(
          searchBody.company,
          "COMPANY",
        );
      }

      // Auto-resolve school names to IDs
      if (searchBody.school && Array.isArray(searchBody.school)) {
        const hasNames = searchBody.school.some((v) => !isNumericId(v));
        if (hasNames) {
          searchBody.school = await resolveNamesToIds(
            searchBody.school,
            "SCHOOL",
          );
        }
      } else if (searchBody.school && typeof searchBody.school === "object") {
        searchBody.school = await resolveNestedObject(
          searchBody.school,
          "SCHOOL",
        );
      }

      // Build URL with query params
      const params = new URLSearchParams();
      params.append("account_id", accountId);
      params.append("limit", limit);
      if (cursor) params.append("cursor", cursor);

      console.log(
        `🔍 LinkedIn ${searchBody.category} Search (${searchBody.api}):`,
        JSON.stringify(searchBody, null, 2),
      );

      const response = await axios.post(
        `${getBaseUrl()}/linkedin/search?${params}`,
        searchBody,
        { headers: getHeaders() },
      );

      let searchResults = response.data;
      let enrichedCount = 0;

      // ============ PROFILE ENRICHMENT (for People search only) ============
      // When enrich_profiles=true, fetch full profile details for each person
      const shouldEnrich =
        req.query.enrich_profiles === "true" &&
        searchBody.category === "people" &&
        searchResults?.items?.length > 0;

      if (shouldEnrich) {
        console.log(
          `🔄 Enriching ${searchResults.items.length} profiles with full details...`,
        );
        const startTime = Date.now();

        // Helper to fetch full profile
        const fetchFullProfile = async (person) => {
          const providerId = person.id || person.public_identifier;
          if (!providerId) return person;

          // Check cache first
          const cacheKey = getProfileCacheKey(providerId, accountId);
          const cachedProfile = profileCache.get(cacheKey);

          if (cachedProfile) {
            return {
              ...person,
              full_profile: cachedProfile,
              enrichment_status: "cached",
            };
          }

          try {
            const profileResponse = await axios.get(
              `${getBaseUrl()}/users/${encodeURIComponent(
                providerId,
              )}?account_id=${accountId}`,
              { headers: getHeaders(), timeout: 5000 },
            );

            const fullProfile = profileResponse.data;

            // Cache the profile
            profileCache.set(cacheKey, fullProfile);

            // Return enriched person object
            return {
              ...person,
              full_profile: {
                // Basic info
                first_name: fullProfile.first_name,
                last_name: fullProfile.last_name,
                headline: fullProfile.headline,
                summary: fullProfile.summary,
                location: fullProfile.location,

                // Contact & social
                email: fullProfile.email,
                phone: fullProfile.phone,
                websites: fullProfile.websites,

                // Professional details
                skills: fullProfile.skills || [],
                languages: fullProfile.languages || [],
                certifications: fullProfile.certifications || [],

                // Experience & Education
                work_experience:
                  fullProfile.work_experience || fullProfile.positions || [],
                education: fullProfile.education || [],

                // Additional
                connections_count: fullProfile.connections_count,
                followers_count: fullProfile.followers_count,
                is_open_to_work: fullProfile.is_open_to_work,
                is_hiring: fullProfile.is_hiring,
                premium: fullProfile.premium,
              },
              enrichment_status: "fetched",
            };
          } catch (err) {
            console.warn(
              `⚠️ Failed to enrich profile ${providerId}:`,
              err.message,
            );
            return {
              ...person,
              full_profile: null,
              enrichment_status: "error",
            };
          }
        };

        // Process profiles in parallel (max 5 concurrent to avoid rate limits)
        const batchSize = 5;
        const enrichedItems = [];

        for (let i = 0; i < searchResults.items.length; i += batchSize) {
          const batch = searchResults.items.slice(i, i + batchSize);
          const enrichedBatch = await Promise.all(batch.map(fetchFullProfile));
          enrichedItems.push(...enrichedBatch);

          // Small delay between batches
          if (i + batchSize < searchResults.items.length) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }

        searchResults = {
          ...searchResults,
          items: enrichedItems,
        };

        enrichedCount = enrichedItems.filter(
          (p) =>
            p.enrichment_status === "fetched" ||
            p.enrichment_status === "cached",
        ).length;
        const elapsed = Date.now() - startTime;
        console.log(
          `✅ Enriched ${enrichedCount}/${searchResults.items.length} profiles in ${elapsed}ms`,
        );
      }

      // ============ POST ENRICHMENT (for Posts search only) ============
      // When enrich_posts=true, fetch comments & reactions for each post
      // Use comments_limit and reactions_limit query params to control preview size
      const commentsLimit = parseInt(req.query.comments_limit) || 3;
      const reactionsLimit = parseInt(req.query.reactions_limit) || 10;
      const shouldEnrichPosts =
        req.query.enrich_posts === "true" &&
        searchBody.category === "posts" &&
        searchResults?.items?.length > 0;

      let postsEnrichedCount = 0;

      if (shouldEnrichPosts) {
        console.log(
          `🔄 Enriching ${searchResults.items.length} posts (comments_limit=${commentsLimit}, reactions_limit=${reactionsLimit})...`,
        );
        const startTime = Date.now();

        // Helper: build LinkedIn profile URL
        const buildLinkedInUrl = (actor) => {
          if (!actor || !actor.public_identifier) return null;
          return actor.is_company
            ? `https://www.linkedin.com/company/${actor.public_identifier}`
            : `https://www.linkedin.com/in/${actor.public_identifier}`;
        };

        // Helper to enrich a single post
        const enrichPost = async (post) => {
          const postId = post.social_id || post.id;
          if (!postId) return { ...post, enrichment_status: "skipped" };

          const encodedPostId = encodeURIComponent(postId);

          try {
            // Fetch comments and reactions in parallel
            const [commentsRes, reactionsRes] = await Promise.allSettled([
              axios.get(
                `${getBaseUrl()}/posts/${encodedPostId}/comments?account_id=${accountId}&limit=${commentsLimit}`,
                { headers: getHeaders(), timeout: 10000 },
              ),
              axios.get(
                `${getBaseUrl()}/posts/${encodedPostId}/reactions?account_id=${accountId}&limit=${reactionsLimit}`,
                { headers: getHeaders(), timeout: 10000 },
              ),
            ]);

            const commentsData =
              commentsRes.status === "fulfilled"
                ? commentsRes.value.data
                : { items: [] };
            const reactionsData =
              reactionsRes.status === "fulfilled"
                ? reactionsRes.value.data
                : { items: [] };

            // Add profile URL to the post author
            const authorProfileUrl = buildLinkedInUrl(post.author);

            return {
              ...post,
              author_profile_url: authorProfileUrl,
              comments_preview: {
                items: commentsData.items || [],
                count: (commentsData.items || []).length,
                has_more: !!commentsData.cursor,
                cursor: commentsData.cursor || null,
              },
              reactions_preview: {
                items: reactionsData.items || [],
                count: (reactionsData.items || []).length,
                has_more: !!reactionsData.cursor,
                cursor: reactionsData.cursor || null,
              },
              enrichment_status: "fetched",
            };
          } catch (err) {
            console.warn(`⚠️ Failed to enrich post ${postId}:`, err.message);
            return {
              ...post,
              author_profile_url: buildLinkedInUrl(post.author),
              comments_preview: {
                items: [],
                count: 0,
                has_more: false,
                cursor: null,
              },
              reactions_preview: {
                items: [],
                count: 0,
                has_more: false,
                cursor: null,
              },
              enrichment_status: "error",
            };
          }
        };

        // Process posts in batches of 3 to avoid rate limits
        const batchSize = 3;
        const enrichedItems = [];

        for (let i = 0; i < searchResults.items.length; i += batchSize) {
          const batch = searchResults.items.slice(i, i + batchSize);
          const enrichedBatch = await Promise.all(batch.map(enrichPost));
          enrichedItems.push(...enrichedBatch);

          // Small delay between batches
          if (i + batchSize < searchResults.items.length) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }

        searchResults = {
          ...searchResults,
          items: enrichedItems,
        };

        postsEnrichedCount = enrichedItems.filter(
          (p) => p.enrichment_status === "fetched",
        ).length;
        const elapsed = Date.now() - startTime;
        console.log(
          `✅ Enriched ${postsEnrichedCount}/${searchResults.items.length} posts in ${elapsed}ms`,
        );
      }

      return res.json({
        success: true,
        data: searchResults,
        search_type: searchBody.category,
        api: searchBody.api,
        account_id: accountId,
        results_count: searchResults?.items?.length || 0,
        ...(shouldEnrich && {
          profiles_enriched: enrichedCount,
          enrichment_note:
            "Full profile details included in 'full_profile' field for each person",
        }),
        ...(shouldEnrichPosts && {
          posts_enriched: postsEnrichedCount,
          enrichment_note:
            "Comments, reactions, and author profile URL included for each post",
        }),
      });
    }

    // Method not allowed
    return res.status(405).json({
      success: false,
      error:
        "Method not allowed. Use GET for search parameters, POST for search.",
    });
  } catch (err) {
    handleError(err, res);
  }
});

// ==================== Company Profile ====================
router.get("/api/unipile/:userId/company/:identifier", async (req, res) => {
  try {
    const { userId, identifier } = req.params;

    const dbResult = await getLinkedInAccountStatus(userId);
    if (!dbResult.success || !dbResult.account_id) {
      return res.status(404).json({
        success: false,
        error: "No LinkedIn account found",
      });
    }

    const accountId = dbResult.account_id;

    console.log(`🔍 Fetching company profile for: ${identifier}`);

    const response = await axios.get(
      `${getBaseUrl()}/linkedin/company/${encodeURIComponent(identifier)}?account_id=${accountId}`,
      { headers: getHeaders() },
    );

    const companyData = response.data;
    let jobs = [];

    // Fetch recent jobs for this company
    try {
      const companyId = companyData.id || companyData.public_identifier;
      if (companyId) {
        // Use Unipile search API to find jobs for this company
        // Note: Sending company ID as an array to the 'company' filter
        const jobsResponse = await axios.post(
          `${getBaseUrl()}/linkedin/search?account_id=${accountId}`,
          {
            api: "classic",
            category: "jobs",
            company: [companyId],
            limit: 5,
          },
          { headers: getHeaders() },
        );
        jobs = jobsResponse.data.items || [];
      }
    } catch (err) {
      console.warn("⚠️ Failed to fetch company jobs:", err.message);
    }

    res.json({
      success: true,
      data: companyData,
      jobs: jobs,
      account_id: accountId,
    });
  } catch (err) {
    handleError(err, res);
  }
});

module.exports = router;
