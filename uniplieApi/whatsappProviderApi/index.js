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
const FormData = require("form-data");
const router = express.Router();

const {
  getWhatsAppAccountStatus,
  getWhatsAppAccountByAccountId,
  updateWhatsAppAccountStatusByAccountId,
  getAllWhatsAppAccounts,
} = require("../whatsappAccountService");

// ==================== CONFIG ====================

const CHATS_PAGE_SIZE = 100; // per-call limit sent to Unipile when listing chats
const MAX_CHAT_PAGES = 50; // safety cap so a bad cursor loop can't run forever

// ==================== UTILITIES ====================

// Helper to extract account status from Unipile response (supports liveData.status, liveData.connected, and liveData.sources)
const extractUnipileStatus = (liveData) => {
  if (!liveData) return "DISCONNECTED";
  if (liveData.status) return liveData.status;
  if (typeof liveData.connected === "boolean") {
    return liveData.connected ? "CONNECTED" : "DISCONNECTED";
  }
  if (Array.isArray(liveData.sources) && liveData.sources.length > 0) {
    const hasOk = liveData.sources.some(
      (s) => s.status === "OK" || s.status === "CONNECTED",
    );
    if (hasOk) return "CONNECTED";
    const firstStatus = liveData.sources[0]?.status;
    if (firstStatus) return firstStatus;
  }
  return "DISCONNECTED";
};

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
    const errorData = err.response.data;
    if (status === 404 && (errorData.detail?.includes("Account not found") || errorData.title?.includes("Resource not found"))) {
      return res.status(404).json({
        success: false,
        error: errorData,
        message: "WhatsApp account session expired or not found on Unipile. Please generate a new QR code or pairing code.",
      });
    }
    return res.status(status).json({
      success: false,
      error: errorData,
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
// stable/normalized keys on top so nothing (reactions, quoted, message_type,
// hidden, edited, attachments, future fields) is silently discarded.
//
// Field names/types below are verified against Unipile's Message object schema:
//   - is_sender / seen / delivered / hidden / deleted / edited / is_event
//     arrive as 0|1 NUMBERS, not booleans — coerce them.
//   - seen_by is an OBJECT map { providerUserId: boolean|timestamp }, NOT an array.
//   - real field names are id, text, timestamp, sender_id
//     (Unipile never sends body / created_at / from / message_id at top level).
const toBool = (v) => v === true || v === 1;

const normalizeMessage = (msg, chatId) => ({
  ...msg, // keep every Unipile field untouched
  id: msg.id,
  chat_id: chatId || msg.chat_id,
  text: msg.text ?? null,
  timestamp: msg.timestamp,
  is_sender: toBool(msg.is_sender),
  sender_id: msg.sender_id,
  // delivered has per-provider support; treat "absent" as optimistic true,
  // but coerce a real 0 to false.
  delivered: msg.delivered == null ? true : toBool(msg.delivered),
  seen: toBool(msg.seen),
  seen_by: msg.seen_by || {}, // object map keyed by provider user id
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

      // ---- hydrate each chat with Messages + Attendees (Profile) ----
      const hydrateChatDetails = async (chat) => {
        const chatId = chat.id || chat.chat_id;
        if (!chatId)
          return {
            ...chat,
            messages: [],
            attendees_profiles: [],
            message_count: 0,
          };

        try {
          const params = new URLSearchParams();
          params.append("account_id", finalAccountId);

          const messageParams = new URLSearchParams(params);
          messageParams.append("limit", parseInt(message_limit) || 50);

          // Fetch messages and attendees from Unipile concurrently
          const [rawMessages, rawAttendees] = await Promise.all([
            axios
              .get(
                `${getBaseUrl()}/chats/${chatId}/messages?${messageParams}`,
                { headers: getHeaders(), timeout: 5000 },
              )
              .then((res) => res.data?.items || res.data?.messages || [])
              .catch(() => []),
            axios
              .get(
                `${getBaseUrl()}/chats/${chatId}/attendees?${params}`,
                { headers: getHeaders(), timeout: 5000 },
              )
              .then((res) => res.data?.items || res.data || [])
              .catch(() => []),
          ]);

          const processedMessages = rawMessages.map((msg) =>
            normalizeMessage(msg, chatId),
          );

          const attendeesList =
            Array.isArray(rawAttendees) && rawAttendees.length > 0
              ? rawAttendees
              : Array.isArray(chat.attendees)
              ? chat.attendees
              : Array.isArray(chat.participants)
              ? chat.participants
              : [];

          const profiles = attendeesList
            .filter((a) => !a.is_self && a.is_self !== 1)
            .map((a) => {
              const attId = a.id || a.provider_id;
              const directPic =
                a.picture_url ||
                a.picture ||
                a.profile_picture_url ||
                a.avatar_url ||
                null;
              const proxyPic = `${req.protocol}://${req.get("host")}/api/whatsapp/attendees/${encodeURIComponent(attId)}/picture?account_id=${finalAccountId}`;

              return {
                id: a.id || a.provider_id,
                name: a.name || chat.name || "WhatsApp Contact",
                provider_id: a.provider_id || a.id,
                public_identifier:
                  a.public_identifier || a.phone_number || a.provider_id,
                picture_url: directPic,
                profile_picture_url: directPic || proxyPic,
              };
            });

          return {
            ...chat,
            attendees_profiles: profiles,
            messages: processedMessages,
            message_count: processedMessages.length,
          };
        } catch (err) {
          return {
            ...chat,
            attendees_profiles: [],
            messages: [],
            message_count: 0,
            hydrate_error: err.message,
          };
        }
      };

      const results = await Promise.allSettled(
        limitedChats.map((chat) => hydrateChatDetails(chat)),
      );

      const hydratedChats = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value);

      res.json({
        success: true,
        data: {
          items: hydratedChats,
          total: chats.length,
          returned: hydratedChats.length,
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

// ==================== API 4: SEND MESSAGE ====================
// POST /api/unipile/whatsapp/send-message
// Payload: { chatId, text, user_id }

router.post(
  ["/api/whatsapp/send-message", "/api/unipile/whatsapp/send-message"],
  async (req, res) => {
    try {
      const chatId = req.body.chatId || req.body.chat_id;
      const text = req.body.text;

      if (!chatId) {
        return res.status(400).json({
          success: false,
          error: "chatId is required",
          message: "chatId is required",
        });
      }

      if (!text || typeof text !== "string" || !text.trim()) {
        return res.status(400).json({
          success: false,
          error: "text is required and must be non-empty",
          message: "text is required and must be non-empty",
        });
      }

      const form = new FormData();
      form.append("text", text);

      const response = await axios.post(
        `${getBaseUrl()}/chats/${encodeURIComponent(chatId)}/messages`,
        form,
        {
          headers: {
            "X-API-KEY": process.env.UNIPILE_API_KEY,
            Accept: "application/json",
            ...form.getHeaders(),
          },
        },
      );

      return res.json({
        success: true,
        chat_id: chatId,
        data: response.data,
      });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// ==================== API 5: START CHAT ====================
// POST /api/unipile/whatsapp/start-chat
// Payload: { whatsapp_number, text, user_id }

router.post(
  ["/api/whatsapp/start-chat", "/api/unipile/whatsapp/start-chat"],
  async (req, res) => {
    try {
      const { user_id, accountId, text } = req.body;
      const rawNumber =
        req.body.whatsapp_number || req.body.number || req.body.phone_number;

      const cleanNumber = String(rawNumber || "").replace(/\D/g, "");

      const finalAccountId = await resolveAccountId(accountId, user_id);
      if (!finalAccountId) {
        return res.status(404).json({
          success: false,
          error: "No WhatsApp account found",
          message: "No WhatsApp account found. Provide user_id or accountId",
        });
      }

      if (!cleanNumber) {
        return res.status(400).json({
          success: false,
          error: "whatsapp_number is required and must contain valid digits",
          message: "whatsapp_number is required",
        });
      }

      if (!text || typeof text !== "string" || !text.trim()) {
        return res.status(400).json({
          success: false,
          error: "text is required and must be non-empty",
          message: "text is required",
        });
      }

      let response;
      try {
        const form1 = new FormData();
        form1.append("account_id", finalAccountId);
        form1.append("attendees_ids", cleanNumber);
        form1.append("text", text);

        response = await axios.post(`${getBaseUrl()}/chats`, form1, {
          headers: {
            "X-API-KEY": process.env.UNIPILE_API_KEY,
            Accept: "application/json",
            ...form1.getHeaders(),
          },
        });
      } catch (attempt1Err) {
        // Fall back to `${cleanNumber}@s.whatsapp.net` if bare number is rejected
        try {
          const form2 = new FormData();
          form2.append("account_id", finalAccountId);
          form2.append("attendees_ids", `${cleanNumber}@s.whatsapp.net`);
          form2.append("text", text);

          response = await axios.post(`${getBaseUrl()}/chats`, form2, {
            headers: {
              "X-API-KEY": process.env.UNIPILE_API_KEY,
              Accept: "application/json",
              ...form2.getHeaders(),
            },
          });
        } catch (attempt2Err) {
          throw attempt2Err;
        }
      }

      const chat = response.data;
      const chat_id = chat?.id || chat?.chat_id;

      return res.json({
        success: true,
        chat_id: chat_id,
        data: chat,
      });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// ==================== API 6: PROXY PROFILE PICTURE ====================
// GET /api/whatsapp/attendees/:id/picture
// Streams the profile picture from Unipile without exposing API keys to the frontend.

router.get(
  [
    "/api/whatsapp/attendees/:id/picture",
    "/api/unipile/whatsapp/attendees/:id/picture",
    "/api/whatsapp/users/:id/picture",
    "/api/unipile/whatsapp/users/:id/picture",
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const { account_id } = req.query;

      if (!account_id) {
        return res.status(400).send("account_id query parameter is required.");
      }

      // Try 1: GET /attendees/${id}/picture
      try {
        const response = await axios.get(
          `${getBaseUrl()}/attendees/${encodeURIComponent(id)}/picture?account_id=${account_id}`,
          {
            headers: getHeaders(),
            responseType: "stream",
          },
        );

        res.set("Content-Type", response.headers["content-type"] || "image/jpeg");
        res.set("Cache-Control", "public, max-age=86400");
        return response.data.pipe(res);
      } catch (attendeeErr) {
        // Try 2: Fall back to GET /users/${id}/picture
        const response = await axios.get(
          `${getBaseUrl()}/users/${encodeURIComponent(id)}/picture?account_id=${account_id}`,
          {
            headers: getHeaders(),
            responseType: "stream",
          },
        );

        res.set("Content-Type", response.headers["content-type"] || "image/jpeg");
        res.set("Cache-Control", "public, max-age=86400");
        return response.data.pipe(res);
      }
    } catch (err) {
      const status = err.response?.status || 500;
      res.status(status).send("Profile picture not found or unavailable.");
    }
  },
);

// ==================== API 7: ACCOUNT STATUS ====================
// GET /api/whatsapp/account-status or /api/unipile/whatsapp/account-status
// Query: ?user_id=... or ?account_id=...

router.get(
  ["/api/whatsapp/account-status", "/api/unipile/whatsapp/account-status"],
  async (req, res) => {
    try {
      const { user_id, account_id } = req.query;

      let targetAccountId = account_id;

      if (!targetAccountId && user_id) {
        const statusRes = await getWhatsAppAccountStatus(user_id);
        if (statusRes.success && statusRes.account_id) {
          targetAccountId = statusRes.account_id;
        } else {
          return res.json(statusRes);
        }
      }

      if (!targetAccountId) {
        return res.status(400).json({
          success: false,
          error: "Provide user_id or account_id query parameter",
        });
      }

      let liveData = null;
      let currentStatus = "DISCONNECTED";

      try {
        const response = await axios.get(
          `${getBaseUrl()}/accounts/${targetAccountId}`,
          { headers: getHeaders() },
        );
        liveData = response.data;
        currentStatus = extractUnipileStatus(liveData);
      } catch (unipileErr) {
        if (unipileErr.response?.status === 404) {
          console.warn(
            `⚠️ WhatsApp account ${targetAccountId} not found on Unipile (404). Updating status to EXPIRED in DB.`,
          );
          currentStatus = "EXPIRED";
          await updateWhatsAppAccountStatusByAccountId(
            targetAccountId,
            "EXPIRED",
            {
              last_error:
                "Account not found on Unipile (QR code session expired or account removed)",
              connected: false,
            },
          );

          return res.json({
            success: true,
            account_id: targetAccountId,
            provider: "WHATSAPP",
            status: "EXPIRED",
            connected: false,
            warmup_active: false,
            warmup_ends_at: null,
            hours_until_warmup_complete: 0,
            daily_chats_count: 0,
            daily_messages_count: 0,
            message:
              "WhatsApp account session expired or not found on Unipile. Please generate a new QR code or pairing code.",
            unipile_account_details: null,
          });
        }
        throw unipileErr;
      }

      await updateWhatsAppAccountStatusByAccountId(
        targetAccountId,
        currentStatus,
        { metadata: liveData },
      );

      const dbAccount = await getWhatsAppAccountByAccountId(targetAccountId);
      const now = new Date();
      const warmupEndsAt = dbAccount?.warmup_ends_at
        ? new Date(dbAccount.warmup_ends_at)
        : null;
      const isWarmupActive = warmupEndsAt ? warmupEndsAt > now : false;

      res.json({
        success: true,
        account_id: targetAccountId,
        provider: "WHATSAPP",
        status: currentStatus,
        connected: currentStatus === "OK" || currentStatus === "CONNECTED",
        warmup_active: isWarmupActive,
        warmup_ends_at: warmupEndsAt,
        hours_until_warmup_complete: isWarmupActive
          ? Number(((warmupEndsAt - now) / (1000 * 60 * 60)).toFixed(1))
          : 0,
        daily_chats_count: dbAccount?.daily_chats_count || 0,
        daily_messages_count: dbAccount?.daily_messages_count || 0,
        unipile_account_details: liveData,
      });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// ==================== API 8: LIST ALL ACCOUNTS ====================
// GET /api/whatsapp/accounts or /api/unipile/whatsapp/accounts

router.get(
  ["/api/whatsapp/accounts", "/api/unipile/whatsapp/accounts"],
  async (req, res) => {
    try {
      const { user_id } = req.query;
      const filter = user_id
        ? { user_id: user_id, provider: "WHATSAPP" }
        : { provider: "WHATSAPP" };

      const result = await getAllWhatsAppAccounts(filter);

      if (result.success && Array.isArray(result.accounts)) {
        for (let i = 0; i < result.accounts.length; i++) {
          const acc = result.accounts[i];
          if (
            acc.account_id &&
            (!acc.connected ||
              acc.status === "PENDING_QR" ||
              acc.status === "PENDING_PAIRING" ||
              acc.status === "PENDING")
          ) {
            try {
              const response = await axios.get(
                `${getBaseUrl()}/accounts/${acc.account_id}`,
                { headers: getHeaders(), timeout: 4000 },
              );
              const liveData = response.data;
              const currentStatus = extractUnipileStatus(liveData);
              await updateWhatsAppAccountStatusByAccountId(
                acc.account_id,
                currentStatus,
                { metadata: liveData },
              );
              result.accounts[i].status = currentStatus;
              result.accounts[i].connected =
                currentStatus === "OK" || currentStatus === "CONNECTED";
              if (liveData.name) result.accounts[i].name = liveData.name;
            } catch (syncErr) {
              if (syncErr.response?.status === 404) {
                await updateWhatsAppAccountStatusByAccountId(
                  acc.account_id,
                  "EXPIRED",
                  {
                    last_error:
                      "Account not found on Unipile (QR session expired or deleted)",
                    connected: false,
                  },
                );
                result.accounts[i].status = "EXPIRED";
                result.accounts[i].connected = false;
              }
            }
          }
        }
      }

      res.json(result);
    } catch (err) {
      handleError(err, res);
    }
  },
);

module.exports = router;

