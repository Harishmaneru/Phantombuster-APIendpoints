// const express = require("express");
// const axios = require("axios");
// const NodeCache = require("node-cache");
// const router = express.Router();

// const {
//   getWhatsAppAccountStatus,
// } = require("../whatsappAccountService");

// // ==================== UTILITIES ====================

// const getBaseUrl = () => {
//   if (process.env.UNIPILE_DSN) {
//     let dsn = process.env.UNIPILE_DSN.trim();
//     if (!dsn.startsWith("http://") && !dsn.startsWith("https://")) {
//       dsn = `https://${dsn}`;
//     }
//     return `${dsn}/api/v1`;
//   }
//   const subdomain = process.env.UNIPILE_SUBDOMAIN || "api";
//   const port = process.env.UNIPILE_PORT ? `:${process.env.UNIPILE_PORT}` : "";
//   return `https://${subdomain}.unipile.com${port}/api/v1`;
// };

// const getHeaders = (contentType = "application/json") => ({
//   "X-API-KEY": process.env.UNIPILE_API_KEY,
//   Accept: "application/json",
//   ...(contentType && { "Content-Type": contentType }),
// });

// const handleError = (err, res) => {
//   console.error("WhatsApp Provider API Error:", {
//     status: err.response?.status,
//     message: err.message,
//     data: err.response?.data,
//   });
//   const status = err.response?.status || 500;
//   if (err.response?.data) {
//     return res.status(status).json({
//       success: false,
//       error: err.response.data,
//       message: err.message,
//     });
//   }
//   res.status(status).json({
//     success: false,
//     error: err.message || "Internal server error",
//   });
// };

// // ==================== CACHE INSTANCES ====================

// const profileCache = new NodeCache({
//   stdTTL: 30 * 60, // 30 minutes
//   checkperiod: 60,
// });

// const chatCache = new NodeCache({
//   stdTTL: 10 * 60, // 10 minutes
//   checkperiod: 60,
// });

// // Helper to generate cache keys
// const getProfileCacheKey = (identifier, accountId) => `wa_profile:${accountId}:${identifier}`;
// const getChatCacheKey = (accountId, providerId) => `wa_chat:${accountId}:${providerId}`;

// // ==================== API 1: FETCH PROFILE / USER ====================
// // POST /api/whatsapp/fetch-profile
// // Payload: { "providerID": "...", "accountId": "...", "user_id": "..." }

// router.post(["/api/whatsapp/fetch-profile", "/api/unipile/whatsapp/fetch-profile"], async (req, res) => {
//   try {
//     const { providerID, accountId, user_id } = req.body;

//     if (!providerID) {
//       return res.status(400).json({
//         success: false,
//         error: "providerID (phone number) is required in payload",
//       });
//     }

//     let finalAccountId = accountId;
//     if (!finalAccountId && user_id) {
//       const dbResult = await getWhatsAppAccountStatus(user_id);
//       if (dbResult.success && dbResult.account_id) {
//         finalAccountId = dbResult.account_id;
//       }
//     }

//     if (!finalAccountId) {
//       return res.status(404).json({
//         success: false,
//         error: "No WhatsApp account found. Provide accountId or user_id",
//       });
//     }

//     const cacheKey = getProfileCacheKey(providerID, finalAccountId);
//     const cachedProfile = profileCache.get(cacheKey);
//     if (cachedProfile) {
//       return res.json({
//         success: true,
//         data: cachedProfile,
//         account_id: finalAccountId,
//         cached: true,
//         fetched_at: new Date(),
//       });
//     }

//     // Call Unipile GET /users/{providerID}
//     const response = await axios.get(
//       `${getBaseUrl()}/users/${encodeURIComponent(providerID)}?account_id=${finalAccountId}`,
//       { headers: getHeaders() }
//     );

//     profileCache.set(cacheKey, response.data);

//     res.json({
//       success: true,
//       data: response.data,
//       account_id: finalAccountId,
//       providerID: providerID,
//       cached: false,
//       fetched_at: new Date(),
//     });
//   } catch (err) {
//     handleError(err, res);
//   }
// });

// // ==================== API 2: FETCH CONVERSATIONS ====================
// // POST /api/whatsapp/fetch-conversations
// // Payload: { "providerID": "...", "accountId": "...", "user_id": "...", "limit": 50, "include_messages": false, "message_limit": 50 }

// router.post(["/api/whatsapp/fetch-conversations", "/api/unipile/whatsapp/fetch-conversations"], async (req, res) => {
//   try {
//     const { providerID, accountId, user_id, limit = 50, include_messages = false, message_limit = 50 } = req.body;

//     let finalAccountId = accountId;
//     if (!finalAccountId && user_id) {
//       const dbResult = await getWhatsAppAccountStatus(user_id);
//       if (dbResult.success && dbResult.account_id) {
//         finalAccountId = dbResult.account_id;
//       }
//     }

//     if (!finalAccountId) {
//       return res.status(404).json({
//         success: false,
//         error: "No WhatsApp account found",
//       });
//     }

//     const cacheKey = getChatCacheKey(finalAccountId, providerID || "all");
//     const cachedChats = chatCache.get(cacheKey);
//     if (cachedChats && !include_messages) {
//       const limitedChats = cachedChats.slice(0, parseInt(limit));
//       return res.json({
//         success: true,
//         data: {
//           items: limitedChats,
//           total: cachedChats.length,
//           returned: limitedChats.length,
//           cached: true,
//         },
//         account_id: finalAccountId,
//         fetched_at: new Date(),
//       });
//     }

//     const params = new URLSearchParams();
//     params.append("account_id", finalAccountId);
//     params.append("limit", 250);

//     const chatsResponse = await axios.get(`${getBaseUrl()}/chats?${params}`, {
//       headers: getHeaders(),
//     });

//     let chats = chatsResponse.data?.items || chatsResponse.data || [];

//     if (providerID) {
//       chats = chats.filter((chat) => {
//         if (chat.attendee_provider_id === providerID) return true;
//         const attendees = chat.attendees || chat.participants || [];
//         if (!Array.isArray(attendees)) return false;
//         return attendees.some(
//           (a) => a.provider_id === providerID || a.id === providerID
//         );
//       });
//     }

//     if (!include_messages) {
//       chatCache.set(cacheKey, chats);
//     }

//     const limitedChats = chats.slice(0, parseInt(limit));

//     if (include_messages === true) {
//       const fetchChatMessages = async (chat) => {
//         const chatId = chat.id || chat.chat_id;
//         if (!chatId) return { ...chat, messages: [], message_count: 0 };

//         try {
//           const messageParams = new URLSearchParams();
//           messageParams.append("account_id", finalAccountId);
//           messageParams.append("limit", parseInt(message_limit) || 50);

//           const messageResponse = await axios.get(
//             `${getBaseUrl()}/chats/${chatId}/messages?${messageParams}`,
//             { headers: getHeaders(), timeout: 3000 }
//           );

//           const messages = messageResponse.data?.messages || messageResponse.data?.items || [];
//           const processedMessages = messages.map((msg) => ({
//             id: msg.id,
//             text: msg.text || null,
//             timestamp: msg.timestamp,
//             is_sender: Boolean(msg.is_sender),
//             sender_id: msg.sender_id,
//             delivered: msg.delivered ?? true,
//             seen: msg.seen ?? false,
//             seen_by: msg.seen_by || [],
//             attachments: msg.attachments || [],
//           }));

//           return {
//             ...chat,
//             messages: processedMessages,
//             message_count: processedMessages.length,
//           };
//         } catch (err) {
//           return { ...chat, messages: [], message_count: 0, message_error: err.message };
//         }
//       };

//       const results = await Promise.allSettled(
//         limitedChats.map((chat) => fetchChatMessages(chat))
//       );

//       const chatsWithMessages = results
//         .filter((r) => r.status === "fulfilled")
//         .map((r) => r.value);

//       res.json({
//         success: true,
//         data: {
//           items: chatsWithMessages,
//           total: chats.length,
//           returned: chatsWithMessages.length,
//           cursor: chatsResponse.data?.cursor || null,
//           cached: false,
//         },
//         account_id: finalAccountId,
//         include_messages: true,
//         fetched_at: new Date(),
//       });
//     } else {
//       res.json({
//         success: true,
//         data: {
//           items: limitedChats,
//           total: chats.length,
//           returned: limitedChats.length,
//           cursor: chatsResponse.data?.cursor || null,
//           cached: false,
//         },
//         account_id: finalAccountId,
//         include_messages: false,
//         fetched_at: new Date(),
//       });
//     }
//   } catch (err) {
//     handleError(err, res);
//   }
// });

// // ==================== API 3: FETCH MESSAGES FOR CHAT ====================
// // POST /api/whatsapp/fetch-messages
// // Payload: { "chatId": "...", "accountId": "...", "user_id": "...", "limit": 100 }

// router.post(["/api/whatsapp/fetch-messages", "/api/unipile/whatsapp/fetch-messages"], async (req, res) => {
//   try {
//     const { chatId, accountId, user_id, limit = 100 } = req.body;

//     if (!chatId) {
//       return res.status(400).json({
//         success: false,
//         error: "chatId is required in payload",
//       });
//     }

//     let finalAccountId = accountId;
//     if (!finalAccountId && user_id) {
//       const dbResult = await getWhatsAppAccountStatus(user_id);
//       if (dbResult.success && dbResult.account_id) {
//         finalAccountId = dbResult.account_id;
//       }
//     }

//     if (!finalAccountId) {
//       return res.status(404).json({
//         success: false,
//         error: "No WhatsApp account found",
//       });
//     }

//     const params = new URLSearchParams();
//     params.append("account_id", finalAccountId);
//     params.append("limit", Math.min(parseInt(limit), 100));

//     const response = await axios.get(
//       `${getBaseUrl()}/chats/${chatId}/messages?${params}`,
//       { headers: getHeaders() }
//     );

//     const rawMessages = response.data?.items || response.data?.messages || response.data || [];

//     const formattedMessages = rawMessages.map((msg) => ({
//       id: msg.id || msg.message_id,
//       chat_id: chatId,
//       text: msg.text || msg.body || "",
//       timestamp: msg.timestamp || msg.created_at,
//       is_sender: Boolean(msg.is_sender),
//       sender_id: msg.sender_id || msg.from,
//       delivered: msg.delivered ?? true,
//       seen: msg.seen ?? false,
//       seen_by: msg.seen_by || [],
//       attachments: msg.attachments || [],
//     }));

//     res.json({
//       success: true,
//       chat_id: chatId,
//       account_id: finalAccountId,
//       messages: formattedMessages,
//       total: formattedMessages.length,
//       cursor: response.data?.cursor || null,
//       fetched_at: new Date(),
//     });
//   } catch (err) {
//     handleError(err, res);
//   }
// });

// module.exports = router;

const express = require("express");
const axios = require("axios");
const NodeCache = require("node-cache");
const router = express.Router();

const { getWhatsAppAccountStatus } = require("../whatsappAccountService");

// ==================== CONFIG ====================

const CHATS_PAGE_SIZE = 100; // per-call limit sent to Unipile when listing chats
const MAX_CHAT_PAGES = 50; // safety cap so a bad cursor loop can't run forever

// ==================== UTILITIES ====================

const getBaseUrl = () => {
  if (process.env.UNIPILE_DSN) {
    let dsn = process.env.UNIPILE_DSN.trim();
    if (!dsn.startsWith("http://") && !dsn.startsWith("https://")) {
      dsn = `https://${dsn}`;
    }
    return `${dsn}/api/v1`;
  }
  const subdomain = process.env.UNIPILE_SUBDOMAIN || "api";
  const port = process.env.UNIPILE_PORT ? `:${process.env.UNIPILE_PORT}` : "";
  return `https://${subdomain}.unipile.com${port}/api/v1`;
};

const getHeaders = (contentType = "application/json") => ({
  "X-API-KEY": process.env.UNIPILE_API_KEY,
  Accept: "application/json",
  ...(contentType && { "Content-Type": contentType }),
});

const handleError = (err, res) => {
  console.error("WhatsApp Provider API Error:", {
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

// Resolve an account_id from an explicit value or by looking it up via user_id.
const resolveAccountId = async (accountId, user_id) => {
  if (accountId) return accountId;
  if (user_id) {
    const dbResult = await getWhatsAppAccountStatus(user_id);
    if (dbResult.success && dbResult.account_id) return dbResult.account_id;
  }
  return null;
};

// Normalize one Unipile message: keep everything it returned, then layer
// stable/normalized keys on top so nothing (reactions, quotes, type, future
// fields) is silently discarded.
const normalizeMessage = (msg, chatId) => ({
  ...msg,
  id: msg.id || msg.message_id,
  ...(chatId ? { chat_id: chatId } : {}),
  text: msg.text ?? msg.body ?? null,
  timestamp: msg.timestamp || msg.created_at,
  is_sender: Boolean(msg.is_sender),
  sender_id: msg.sender_id || msg.from,
  delivered: msg.delivered ?? true,
  seen: msg.seen ?? false,
  seen_by: msg.seen_by || [],
  attachments: msg.attachments || [],
});

// Does a chat involve the given WhatsApp provider id?
const chatMatchesProvider = (chat, providerID) => {
  if (!providerID) return true;
  if (chat.attendee_provider_id === providerID) return true;
  const attendees = chat.attendees || chat.participants || [];
  if (!Array.isArray(attendees)) return false;
  return attendees.some(
    (a) => a.provider_id === providerID || a.id === providerID,
  );
};

/**
 * Walk Unipile's chat pagination via cursor.
 *
 * - When matchProviderId is set, we exhaust every page (bounded by
 *   MAX_CHAT_PAGES) so the contact filter can't miss a match on a later page.
 * - When it isn't set, we stop as soon as we've collected `needed` chats,
 *   so we don't over-fetch just to satisfy a small limit.
 */
async function pageThroughChats(
  accountId,
  { matchProviderId = null, needed = Infinity } = {},
) {
  const collected = [];
  let cursor = null;
  let pages = 0;
  let scanned = 0;

  do {
    const params = new URLSearchParams();
    params.append("account_id", accountId);
    params.append("limit", CHATS_PAGE_SIZE);
    if (cursor) params.append("cursor", cursor);

    const resp = await axios.get(`${getBaseUrl()}/chats?${params}`, {
      headers: getHeaders(),
    });

    const batch =
      resp.data?.items || (Array.isArray(resp.data) ? resp.data : []);
    scanned += batch.length;

    for (const chat of batch) {
      if (chatMatchesProvider(chat, matchProviderId)) collected.push(chat);
    }

    cursor = resp.data?.cursor || null;
    pages += 1;

    // Only allow the early exit when NOT filtering — otherwise we must keep
    // going to be sure we've seen every matching chat.
    if (!matchProviderId && collected.length >= needed) break;
  } while (cursor && pages < MAX_CHAT_PAGES);

  return { chats: collected, scanned, pages, exhausted: !cursor };
}

// ==================== CACHE INSTANCES ====================

const profileCache = new NodeCache({ stdTTL: 30 * 60, checkperiod: 60 }); // 30 min
const chatCache = new NodeCache({ stdTTL: 10 * 60, checkperiod: 60 }); // 10 min

const getProfileCacheKey = (identifier, accountId) =>
  `wa_profile:${accountId}:${identifier}`;
const getChatCacheKey = (accountId, providerId) =>
  `wa_chat:${accountId}:${providerId}`;

// ==================== API 1: FETCH PROFILE / USER ====================
// POST /api/whatsapp/fetch-profile
// Payload: { providerID, accountId, user_id }

router.post(
  ["/api/whatsapp/fetch-profile", "/api/unipile/whatsapp/fetch-profile"],
  async (req, res) => {
    try {
      const { providerID, accountId, user_id } = req.body;

      if (!providerID) {
        return res.status(400).json({
          success: false,
          error: "providerID (WhatsApp provider id) is required in payload",
        });
      }

      const finalAccountId = await resolveAccountId(accountId, user_id);
      if (!finalAccountId) {
        return res.status(404).json({
          success: false,
          error: "No WhatsApp account found. Provide accountId or user_id",
        });
      }

      const cacheKey = getProfileCacheKey(providerID, finalAccountId);
      const cachedProfile = profileCache.get(cacheKey);
      if (cachedProfile) {
        return res.json({
          success: true,
          data: cachedProfile,
          account_id: finalAccountId,
          providerID,
          cached: true,
          fetched_at: new Date(),
        });
      }

      // GET /users/{identifier}?account_id=...  (identifier = provider id)
      const response = await axios.get(
        `${getBaseUrl()}/users/${encodeURIComponent(providerID)}?account_id=${finalAccountId}`,
        { headers: getHeaders() },
      );

      profileCache.set(cacheKey, response.data);

      res.json({
        success: true,
        data: response.data, // full profile object, untouched
        account_id: finalAccountId,
        providerID,
        cached: false,
        fetched_at: new Date(),
      });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// ==================== API 2: FETCH CONVERSATIONS ====================
// POST /api/whatsapp/fetch-conversations
// Payload: { providerID, accountId, user_id, limit, include_messages, message_limit }

router.post(
  [
    "/api/whatsapp/fetch-conversations",
    "/api/unipile/whatsapp/fetch-conversations",
  ],
  async (req, res) => {
    try {
      const {
        providerID,
        accountId,
        user_id,
        limit = 50,
        include_messages = false,
        message_limit = 50,
      } = req.body;

      const finalAccountId = await resolveAccountId(accountId, user_id);
      if (!finalAccountId) {
        return res.status(404).json({
          success: false,
          error: "No WhatsApp account found. Provide accountId or user_id",
        });
      }

      const wantLimit = parseInt(limit) || 50;
      const cacheKey = getChatCacheKey(finalAccountId, providerID || "all");

      // ---- cache path (lightweight responses only) ----
      const cachedChats = chatCache.get(cacheKey);
      if (cachedChats && !include_messages) {
        const limitedChats = cachedChats.slice(0, wantLimit);
        return res.json({
          success: true,
          data: {
            items: limitedChats,
            total: cachedChats.length,
            returned: limitedChats.length,
            cached: true,
          },
          account_id: finalAccountId,
          fetched_at: new Date(),
        });
      }

      // ---- paginate through Unipile ----
      // Filtering by a contact => exhaust all pages. No filter => fetch just
      // enough to satisfy the requested limit.
      const { chats, scanned, pages, exhausted } = await pageThroughChats(
        finalAccountId,
        {
          matchProviderId: providerID || null,
          needed: providerID ? Infinity : wantLimit,
        },
      );

      // Cache the fully-resolved (post-filter) list, so a hit can't hand back
      // a truncated slice. Only cache the lightweight (no-messages) form.
      if (!include_messages) {
        chatCache.set(cacheKey, chats);
      }

      const limitedChats = chats.slice(0, wantLimit);

      // ---- lightweight response (no message hydration) ----
      if (!include_messages) {
        return res.json({
          success: true,
          data: {
            items: limitedChats,
            total: chats.length,
            returned: limitedChats.length,
            cursor: null, // pagination resolved server-side
            cached: false,
          },
          account_id: finalAccountId,
          include_messages: false,
          scanned, // raw chats walked
          pages, // Unipile calls made
          exhausted, // false => hit MAX_CHAT_PAGES before the end
          fetched_at: new Date(),
        });
      }

      // ---- hydrate each chat with its most recent messages ----
      const fetchChatMessages = async (chat) => {
        const chatId = chat.id || chat.chat_id;
        if (!chatId) return { ...chat, messages: [], message_count: 0 };

        try {
          const messageParams = new URLSearchParams();
          messageParams.append("account_id", finalAccountId);
          messageParams.append("limit", parseInt(message_limit) || 50);

          const messageResponse = await axios.get(
            `${getBaseUrl()}/chats/${chatId}/messages?${messageParams}`,
            { headers: getHeaders(), timeout: 5000 },
          );

          const messages =
            messageResponse.data?.items || messageResponse.data?.messages || [];
          const processedMessages = messages.map((msg) =>
            normalizeMessage(msg, chatId),
          );

          return {
            ...chat,
            messages: processedMessages,
            message_count: processedMessages.length,
          };
        } catch (err) {
          return {
            ...chat,
            messages: [],
            message_count: 0,
            message_error: err.message,
          };
        }
      };

      const results = await Promise.allSettled(
        limitedChats.map((chat) => fetchChatMessages(chat)),
      );

      const chatsWithMessages = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value);

      res.json({
        success: true,
        data: {
          items: chatsWithMessages,
          total: chats.length,
          returned: chatsWithMessages.length,
          cursor: null,
          cached: false,
        },
        account_id: finalAccountId,
        include_messages: true,
        scanned,
        pages,
        exhausted,
        fetched_at: new Date(),
      });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// ==================== API 3: FETCH MESSAGES FOR CHAT ====================
// POST /api/whatsapp/fetch-messages
// Payload: { chatId, accountId, user_id, limit }

router.post(
  ["/api/whatsapp/fetch-messages", "/api/unipile/whatsapp/fetch-messages"],
  async (req, res) => {
    try {
      const { chatId, accountId, user_id, limit = 100 } = req.body;

      if (!chatId) {
        return res.status(400).json({
          success: false,
          error: "chatId is required in payload",
        });
      }

      const finalAccountId = await resolveAccountId(accountId, user_id);
      if (!finalAccountId) {
        return res.status(404).json({
          success: false,
          error: "No WhatsApp account found. Provide accountId or user_id",
        });
      }

      const params = new URLSearchParams();
      params.append("account_id", finalAccountId);
      params.append("limit", Math.min(parseInt(limit) || 100, 100));

      const response = await axios.get(
        `${getBaseUrl()}/chats/${chatId}/messages?${params}`,
        { headers: getHeaders() },
      );

      const rawMessages = response.data?.items || response.data?.messages || [];
      const formattedMessages = rawMessages.map((msg) =>
        normalizeMessage(msg, chatId),
      );

      res.json({
        success: true,
        chat_id: chatId,
        account_id: finalAccountId,
        messages: formattedMessages,
        total: formattedMessages.length,
        cursor: response.data?.cursor || null,
        fetched_at: new Date(),
      });
    } catch (err) {
      handleError(err, res);
    }
  },
);

module.exports = router;
