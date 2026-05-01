const express = require("express");
const axios = require("axios");
const NodeCache = require("node-cache");
const router = express.Router();

// ==================== UTILITIES (Self-contained) ====================

const getBaseUrl = () => {
  return `https://${process.env.UNIPILE_SUBDOMAIN}.unipile.com:${process.env.UNIPILE_PORT}/api/v1`;
};

const getHeaders = (contentType = "application/json") => ({
  "X-API-KEY": process.env.UNIPILE_API_KEY,
  Accept: "application/json",
  ...(contentType && { "Content-Type": contentType }),
});

const handleError = (err, res) => {
  console.error("API Error:", {
    status: err.response?.status,
    message: err.message,
    data: err.response?.data,
  });
  const status = err.response?.status || 500;
  if (err.response?.data) {
    return res.status(status).json({
      success: false,
      error: err.response.data,
      message: err.message,
    });
  }
  res.status(status).json({
    success: false,
    error: err.message || "Internal server error",
  });
};

// ==================== CACHE INSTANCES (Separate from linkedinMessaging.js) ====================

const profileCache = new NodeCache({
  stdTTL: 30 * 60, // 30 minutes
  checkperiod: 60,
  useClones: false,
});

const chatCache = new NodeCache({
  stdTTL: 10 * 60, // 10 minutes
  checkperiod: 60,
});

// Helper to generate cache keys
const getProfileCacheKey = (identifier, accountId) => {
  return `profile:${accountId}:${identifier}`;
};

const getChatCacheKey = (accountId, providerId) => {
  return `chat:${accountId}:${providerId}`;
};

// ==================== IMPORT ACCOUNT SERVICE ====================

const {
  getLinkedInAccountStatus,
} = require("../linkedinAccountService");

// ==================== API 1: FETCH PROFILE ====================
// POST /api/linkedin/fetch-profile
// Payload: { "providerID": "...", "accountId": "...", "user_id": "..." }

router.post("/api/linkedin/fetch-profile", async (req, res) => {
  try {
    const { providerID, accountId, user_id } = req.body;

    // Validation
    if (!providerID) {
      return res.status(400).json({
        success: false,
        error: "providerID is required in payload",
      });
    }

    // Resolve accountId
    let finalAccountId = accountId;
    if (!finalAccountId && user_id) {
      const dbResult = await getLinkedInAccountStatus(user_id);
      if (dbResult.success && dbResult.account_id) {
        finalAccountId = dbResult.account_id;
      }
    }

    if (!finalAccountId) {
      return res.status(404).json({
        success: false,
        error: "No LinkedIn account found. Provide accountId or user_id",
      });
    }

    // Check cache first
    const cacheKey = getProfileCacheKey(providerID, finalAccountId);
    const cachedProfile = profileCache.get(cacheKey);
    if (cachedProfile) {
      return res.json({
        success: true,
        data: cachedProfile,
        account_id: finalAccountId,
        cached: true,
        fetched_at: new Date(),
      });
    }

    // Fetch from Unipile API
    const response = await axios.get(
      `${getBaseUrl()}/users/${encodeURIComponent(providerID)}?account_id=${finalAccountId}`,
      { headers: getHeaders() }
    );

    // Cache the result
    profileCache.set(cacheKey, response.data);

    res.json({
      success: true,
      data: response.data,
      account_id: finalAccountId,
      providerID: providerID,
      cached: false,
      fetched_at: new Date(),
    });
  } catch (err) {
    handleError(err, res);
  }
});

// ==================== API 2: FETCH CONVERSATIONS ====================
// POST /api/linkedin/fetch-conversations
// Payload: { "providerID": "...", "accountId": "...", "user_id": "...", "limit": 50, "include_messages": false, "message_limit": 50 }

router.post("/api/linkedin/fetch-conversations", async (req, res) => {
  try {
    const { providerID, accountId, user_id, limit = 50, include_messages = false, message_limit = 50 } = req.body;

    // Validation
    if (!providerID) {
      return res.status(400).json({
        success: false,
        error: "providerID is required in payload",
      });
    }

    // Resolve accountId
    let finalAccountId = accountId;
    if (!finalAccountId && user_id) {
      const dbResult = await getLinkedInAccountStatus(user_id);
      if (dbResult.success && dbResult.account_id) {
        finalAccountId = dbResult.account_id;
      }
    }

    if (!finalAccountId) {
      return res.status(404).json({
        success: false,
        error: "No LinkedIn account found",
      });
    }

    // Check cache first (only if not including messages, as messages change frequently)
    const cacheKey = getChatCacheKey(finalAccountId, providerID);
    const cachedChats = chatCache.get(cacheKey);
    if (cachedChats && !include_messages) {
      const limitedChats = cachedChats.slice(0, parseInt(limit));
      return res.json({
        success: true,
        data: {
          items: limitedChats,
          total: cachedChats.length,
          returned: limitedChats.length,
          cached: true,
        },
        account_id: finalAccountId,
        profile_id: providerID,
        include_messages: false,
        fetched_at: new Date(),
      });
    }

    // Fetch all chats
    const params = new URLSearchParams();
    params.append("account_id", finalAccountId);
    params.append("limit", 250); // Fetch more to filter

    const chatsResponse = await axios.get(
      `${getBaseUrl()}/chats?${params}`,
      { headers: getHeaders() }
    );

    const chats = chatsResponse.data?.items || chatsResponse.data || [];

    // Filter chats where providerID is an attendee
    const hisChats = chats.filter(chat => {
      // Check attendee_provider_id directly
      if (chat.attendee_provider_id === providerID) return true;

      // Check attendees array if available
      const attendees = chat.attendees || chat.participants || [];
      if (!Array.isArray(attendees)) return false;

      return attendees.some(attendee => 
        attendee.provider_id === providerID || 
        attendee.id === providerID
      );
    });

    // Cache the filtered result (without messages)
    if (!include_messages) {
      chatCache.set(cacheKey, hisChats);
    }

    // Apply limit for chat list
    const limitedChats = hisChats.slice(0, parseInt(limit));

    // If include_messages flag is true, fetch messages for each chat
    if (include_messages === true) {
      console.log(`📨 Fetching messages for ${limitedChats.length} chats...`);

      // Helper: Fetch messages for a single chat with timeout
      const fetchChatMessages = async (chat) => {
        const chatId = chat.id || chat.chat_id || chat.chatId;
        if (!chatId) return { ...chat, messages: [], message_count: 0 };

        try {
          const messageParams = new URLSearchParams();
          messageParams.append("account_id", finalAccountId);
          messageParams.append("limit", parseInt(message_limit) || 50);

          const messageResponse = await axios.get(
            `${getBaseUrl()}/chats/${chatId}/messages?${messageParams}`,
            { 
              headers: getHeaders(),
              timeout: 3000 // 3 second timeout per chat
            }
          );

          const messages = messageResponse.data?.messages || messageResponse.data?.items || [];
          
          // Process messages (simplified version)
          const processedMessages = messages.map(msg => ({
            id: msg.id,
            text: msg.text || null,
            timestamp: msg.timestamp,
            is_my_message: msg.is_sender === 1,
            sender_id: msg.sender_id,
            message_type: msg.message_type || "text",
            delivered: msg.delivered || false,
            seen: msg.seen || msg.read || 0,
          })).reverse(); // Oldest first

          return {
            ...chat,
            messages: processedMessages,
            message_count: processedMessages.length,
          };
        } catch (err) {
          console.warn(`Failed to fetch messages for chat ${chatId}:`, err.message);
          return { ...chat, messages: [], message_count: 0, message_error: err.message };
        }
      };

      // Fetch messages for all chats in parallel (with allSettled to handle partial failures)
      const results = await Promise.allSettled(
        limitedChats.map(chat => fetchChatMessages(chat))
      );

      // Extract successful results
      const chatsWithMessages = results
        .filter(result => result.status === "fulfilled")
        .map(result => result.value);

      res.json({
        success: true,
        data: {
          items: chatsWithMessages,
          total: hisChats.length,
          returned: chatsWithMessages.length,
          cursor: chatsResponse.data?.cursor || null,
          cached: false,
        },
        account_id: finalAccountId,
        profile_id: providerID,
        include_messages: true,
        message_limit: parseInt(message_limit),
        fetched_at: new Date(),
      });
    } else {
      // Return without messages (original behavior)
      res.json({
        success: true,
        data: {
          items: limitedChats,
          total: hisChats.length,
          returned: limitedChats.length,
          cursor: chatsResponse.data?.cursor || null,
          cached: false,
        },
        account_id: finalAccountId,
        profile_id: providerID,
        include_messages: false,
        fetched_at: new Date(),
      });
    }
  } catch (err) {
    handleError(err, res);
  }
});

module.exports = router;
