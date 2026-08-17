const express = require("express");
const axios = require("axios");
const FormData = require("form-data");
const NodeCache = require("node-cache");
const router = express.Router();
const upload = require("../middlewares/upload");

// Import WhatsApp account service
const {
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
} = require("./whatsappAccountService");

// ==================== CONFIG & UTILITIES ====================

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
  console.error("WhatsApp API Error:", {
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

// Caches for profile and chats
const whatsappCache = new NodeCache({
  stdTTL: 10 * 60, // 10 minutes default
  checkperiod: 60,
});

// Helper to format phone number to E.164 digits only (no + or spaces)
const formatE164Phone = (phone) => {
  if (!phone) return "";
  return String(phone).replace(/\D/g, "");
};

// Helper to extract phone number from any parameter field
const getPhoneParam = (req) => {
  return (
    req.body.whatsapp_number ||
    req.body.pairing_phone_number ||
    req.body.phone_number ||
    req.body.number ||
    req.query.whatsapp_number ||
    req.query.pairing_phone_number ||
    req.query.phone_number ||
    req.query.number ||
    null
  );
};

/**
 * Unified Connect Endpoint (Auto-detects Pairing Code vs QR Code flow)
 * POST /api/whatsapp/connect or /api/unipile/whatsapp/connect
 * Accepts: user_id, whatsapp_number (or pairing_phone_number / phone_number), name
 */
router.all(["/api/whatsapp/connect", "/api/unipile/whatsapp/connect"], async (req, res) => {
  try {
    const user_id = req.body.user_id || req.query.user_id;
    const phoneInput = getPhoneParam(req);
    const name = req.body.name || req.query.name || (phoneInput ? `WhatsApp ${phoneInput}` : null);

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: "user_id is required in body or query params",
      });
    }

    if (phoneInput) {
      // ---------------- PAIRING CODE FLOW ----------------
      const sanitizedPhone = formatE164Phone(phoneInput);
      const payload = {
        provider: "WHATSAPP",
        pairing_phone_number: sanitizedPhone,
        ...(name && { name: name }),
      };

      console.log(`Generating WhatsApp Pairing Code for phone ${sanitizedPhone}...`);

      const response = await axios.post(`${getBaseUrl()}/accounts`, payload, {
        headers: getHeaders(),
      });

      const accountData = response.data;
      const accountId = accountData.account_id || accountData.id;
      const pairingCode = accountData.pairing_code || accountData.code;

      await connectWhatsAppAccount(user_id, accountId, "WHATSAPP", name, {
        pairing_phone_number: sanitizedPhone,
        pairing_code: pairingCode,
        status: accountData.status || "PENDING_PAIRING",
      });

      return res.json({
        success: true,
        flow: "PAIRING_CODE",
        account_id: accountId,
        provider: "WHATSAPP",
        whatsapp_number: sanitizedPhone,
        pairing_code: pairingCode,
        status: accountData.status || "PENDING_PAIRING",
        unipile_response: accountData,
      });
    } else {
      // ---------------- QR CODE FLOW ----------------
      const payload = {
        provider: "WHATSAPP",
        ...(name && { name: name }),
      };

      console.log("Generating WhatsApp QR Code via Unipile...", payload);

      const response = await axios.post(`${getBaseUrl()}/accounts`, payload, {
        headers: getHeaders(),
      });

      const accountData = response.data;
      const accountId = accountData.account_id || accountData.id;
      const qrCodeString = accountData.qrCodeString || accountData.qr_code || accountData.code;

      await connectWhatsAppAccount(user_id, accountId, "WHATSAPP", name, {
        qrCodeString: qrCodeString,
        status: accountData.status || "PENDING_QR",
      });

      return res.json({
        success: true,
        flow: "QR_CODE",
        account_id: accountId,
        provider: "WHATSAPP",
        status: accountData.status || "PENDING_QR",
        qrCodeString: qrCodeString,
        qr_code_image_instructions: "Render qrCodeString using standard QR code library on frontend",
        unipile_response: accountData,
      });
    }
  } catch (err) {
    handleError(err, res);
  }
});

/**
 * Step 1 & 2: Start Authentication - QR Code flow
 * POST /api/whatsapp/connect-qr
 * Body: { "user_id": "...", "name": "...", "whatsapp_number": "..." }
 */
router.all(["/api/whatsapp/connect-qr", "/api/unipile/whatsapp/connect-qr"], async (req, res) => {
  try {
    const user_id = req.body.user_id || req.query.user_id;
    const phoneInput = getPhoneParam(req);
    const name = req.body.name || req.query.name || (phoneInput ? `WhatsApp ${phoneInput}` : null);

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: "user_id is required in body or query params",
      });
    }

    const payload = {
      provider: "WHATSAPP",
      ...(name && { name: name }),
    };

    console.log("Generating WhatsApp QR Code via Unipile...", payload);

    const response = await axios.post(`${getBaseUrl()}/accounts`, payload, {
      headers: getHeaders(),
    });

    const accountData = response.data;
    const accountId = accountData.account_id || accountData.id;
    const qrCodeString = accountData.qrCodeString || accountData.qr_code || accountData.code;

    // Record account in DB
    await connectWhatsAppAccount(user_id, accountId, "WHATSAPP", name, {
      qrCodeString: qrCodeString,
      whatsapp_number: phoneInput ? formatE164Phone(phoneInput) : null,
      status: accountData.status || "PENDING_QR",
    });

    res.json({
      success: true,
      account_id: accountId,
      provider: "WHATSAPP",
      status: accountData.status || "PENDING_QR",
      qrCodeString: qrCodeString,
      qr_code_image_instructions: "Render qrCodeString using standard QR code library on frontend",
      unipile_response: accountData,
    });
  } catch (err) {
    handleError(err, res);
  }
});

/**
 * Step 1 & 2: Start Authentication - Pairing Code flow
 * POST /api/whatsapp/connect-pairing
 * Body: { "user_id": "...", "whatsapp_number": "919391783193" }
 * Accepts: whatsapp_number, pairing_phone_number, phone_number, or number
 */
router.all(["/api/whatsapp/connect-pairing", "/api/unipile/whatsapp/connect-pairing"], async (req, res) => {
  try {
    const user_id = req.body.user_id || req.query.user_id;
    const rawPhone = getPhoneParam(req);
    const name = req.body.name || req.query.name || (rawPhone ? `WhatsApp ${rawPhone}` : null);

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: "user_id is required in body or query params",
      });
    }

    if (!rawPhone) {
      return res.status(400).json({
        success: false,
        error: "whatsapp_number (or pairing_phone_number / phone_number) is required in body or query params",
      });
    }

    const sanitizedPhone = formatE164Phone(rawPhone);

    const payload = {
      provider: "WHATSAPP",
      pairing_phone_number: sanitizedPhone,
      ...(name && { name: name }),
    };

    console.log(`Generating WhatsApp Pairing Code for phone ${sanitizedPhone}...`);

    const response = await axios.post(`${getBaseUrl()}/accounts`, payload, {
      headers: getHeaders(),
    });

    const accountData = response.data;
    const accountId = accountData.account_id || accountData.id;
    const pairingCode = accountData.pairing_code || accountData.code;

    // Record account in DB
    await connectWhatsAppAccount(user_id, accountId, "WHATSAPP", name, {
      pairing_phone_number: sanitizedPhone,
      whatsapp_number: sanitizedPhone,
      pairing_code: pairingCode,
      status: accountData.status || "PENDING_PAIRING",
    });

    res.json({
      success: true,
      account_id: accountId,
      provider: "WHATSAPP",
      whatsapp_number: sanitizedPhone,
      pairing_phone_number: sanitizedPhone,
      pairing_code: pairingCode,
      status: accountData.status || "PENDING_PAIRING",
      unipile_response: accountData,
    });
  } catch (err) {
    handleError(err, res);
  }
});

/**
 * Step 3: Confirm connection & check account status
 * GET /api/whatsapp/account-status
 * Query: ?user_id=... or ?account_id=...
 */
router.get(["/api/whatsapp/account-status", "/api/unipile/whatsapp/account-status"], async (req, res) => {
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

    // Query Unipile API directly for live status
    let liveData = null;
    let currentStatus = "DISCONNECTED";

    try {
      const response = await axios.get(`${getBaseUrl()}/accounts/${targetAccountId}`, {
        headers: getHeaders(),
      });
      liveData = response.data;
      currentStatus = liveData.status || (liveData.connected ? "CONNECTED" : "DISCONNECTED");
    } catch (unipileErr) {
      if (unipileErr.response?.status === 404) {
        console.warn(`⚠️ WhatsApp account ${targetAccountId} not found on Unipile (404). Updating status to EXPIRED in DB.`);
        currentStatus = "EXPIRED";
        await updateWhatsAppAccountStatusByAccountId(targetAccountId, "EXPIRED", {
          last_error: "Account not found on Unipile (QR code session expired or account removed)",
          connected: false,
        });

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
          message: "WhatsApp account session expired or not found on Unipile. Please generate a new QR code or pairing code.",
          unipile_account_details: null,
        });
      }
      throw unipileErr;
    }

    // Update database record
    await updateWhatsAppAccountStatusByAccountId(targetAccountId, currentStatus, {
      metadata: liveData,
    });

    // Fetch updated DB status including 24-hour warm-up info
    const dbAccount = await getWhatsAppAccountByAccountId(targetAccountId);
    const now = new Date();
    const warmupEndsAt = dbAccount?.warmup_ends_at ? new Date(dbAccount.warmup_ends_at) : null;
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
});

/**
 * Disconnect WhatsApp Account
 * POST /api/whatsapp/disconnect
 * Body: { "user_id": "...", "account_id": "..." }
 */
router.post(["/api/whatsapp/disconnect", "/api/unipile/whatsapp/disconnect"], async (req, res) => {
  try {
    const { user_id, account_id, reason } = req.body;

    let targetAccountId = account_id;
    if (!targetAccountId && user_id) {
      const statusRes = await getWhatsAppAccountStatus(user_id);
      if (statusRes.success && statusRes.account_id) {
        targetAccountId = statusRes.account_id;
      }
    }

    if (!targetAccountId) {
      return res.status(400).json({
        success: false,
        error: "account_id or user_id is required",
      });
    }

    // Call Unipile delete account API
    try {
      await axios.delete(`${getBaseUrl()}/accounts/${targetAccountId}`, {
        headers: getHeaders(),
      });
    } catch (unipileErr) {
      console.warn("Unipile delete account call warning:", unipileErr.message);
    }

    if (user_id) {
      await disconnectWhatsAppAccount(user_id, reason || "User requested disconnect");
    }

    res.json({
      success: true,
      message: "WhatsApp account disconnected successfully",
      account_id: targetAccountId,
    });
  } catch (err) {
    handleError(err, res);
  }
});

/**
 * List all registered WhatsApp Accounts
 * GET /api/whatsapp/accounts
 */
router.get(["/api/whatsapp/accounts", "/api/unipile/whatsapp/accounts"], async (req, res) => {
  try {
    const { user_id } = req.query;
    const filter = user_id ? { user_id: user_id, provider: "WHATSAPP" } : { provider: "WHATSAPP" };

    const result = await getAllWhatsAppAccounts(filter);

    // Auto-sync live status from Unipile for accounts that are pending or not connected yet
    if (result.success && Array.isArray(result.accounts)) {
      for (let i = 0; i < result.accounts.length; i++) {
        const acc = result.accounts[i];
        if (acc.account_id && (!acc.connected || acc.status === "PENDING_QR" || acc.status === "PENDING_PAIRING" || acc.status === "PENDING")) {
          try {
            const response = await axios.get(`${getBaseUrl()}/accounts/${acc.account_id}`, {
              headers: getHeaders(),
              timeout: 4000,
            });
            const liveData = response.data;
            const currentStatus = liveData.status || (liveData.connected ? "CONNECTED" : "DISCONNECTED");
            await updateWhatsAppAccountStatusByAccountId(acc.account_id, currentStatus, {
              metadata: liveData,
            });
            result.accounts[i].status = currentStatus;
            result.accounts[i].connected = currentStatus === "OK" || currentStatus === "CONNECTED";
            if (liveData.name) result.accounts[i].name = liveData.name;
          } catch (syncErr) {
            if (syncErr.response?.status === 404) {
              await updateWhatsAppAccountStatusByAccountId(acc.account_id, "EXPIRED", {
                last_error: "Account not found on Unipile (QR session expired or deleted)",
                connected: false,
              });
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
});

// ==================== 2. MESSAGING (NEW & EXISTING CHATS) ====================

/**
 * Send First Message to a New Number (Creates Chat + Sends Initial Message)
 * POST /api/whatsapp/chats
 * Multipart or JSON Body:
 * - account_id (or user_id)
 * - attendees_ids (recipient phone number or array of phone numbers, e.g. "33612345678")
 * - text
 * - attachments (optional file uploads, max 15MB each)
 * - bypass_warmup_check (optional boolean for admin override)
 */
router.post(["/api/whatsapp/chats", "/api/unipile/whatsapp/chats"], upload.array("attachments", 10), async (req, res) => {
  try {
    const account_id = req.body.account_id;
    const user_id = req.body.user_id;
    const attendees_ids = req.body.attendees_ids;
    const text = req.body.text || "";
    const bypassWarmup = req.body.bypass_warmup_check === "true" || req.body.bypass_warmup_check === true;

    // Resolve account_id if user_id passed
    let finalAccountId = account_id;
    if (!finalAccountId && user_id) {
      const dbRes = await getWhatsAppAccountStatus(user_id);
      if (dbRes.success && dbRes.account_id) {
        finalAccountId = dbRes.account_id;
      }
    }

    if (!finalAccountId) {
      return res.status(400).json({
        success: false,
        error: "account_id or user_id is required",
      });
    }

    if (!attendees_ids) {
      return res.status(400).json({
        success: false,
        error: "attendees_ids is required (recipient phone number e.g. '33612345678')",
      });
    }

    // 1. Check Sending Limits & 24-Hour Warm-up Restrictions (Section 5)
    if (!bypassWarmup) {
      const limitsCheck = await checkSendingLimits(finalAccountId, true);
      if (!limitsCheck.allowed) {
        return res.status(429).json({
          success: false,
          error: limitsCheck.code || "LIMIT_EXCEEDED",
          message: limitsCheck.reason,
          details: limitsCheck,
        });
      }
    }

    // 2. Enforce Minimum Randomized Delay (10-20 seconds) (Section 5)
    const delayedMs = await enforceSendingDelay(finalAccountId);

    // 3. Construct Form Data for Unipile API
    const form = new FormData();
    form.append("account_id", finalAccountId);
    form.append("text", text);

    // Format attendee ID (ensure no leading +, single string or array)
    const formattedRecipient = Array.isArray(attendees_ids)
      ? attendees_ids.map(formatE164Phone).join(",")
      : formatE164Phone(attendees_ids);

    form.append("attendees_ids", formattedRecipient);

    // Attachments handling (Section 6)
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        // Enforce 15 MB WhatsApp provider attachment limit
        if (file.size > 15 * 1024 * 1024) {
          return res.status(400).json({
            success: false,
            error: `File ${file.originalname} exceeds the 15MB limit for WhatsApp attachments.`,
          });
        }
        form.append("attachments", file.buffer, {
          filename: file.originalname,
          contentType: file.mimetype,
        });
      }
    }

    console.log(`Sending first WhatsApp message to ${formattedRecipient} from account ${finalAccountId}...`);

    // Call Unipile POST /api/v1/chats
    const response = await axios.post(`${getBaseUrl()}/chats`, form, {
      headers: {
        ...getHeaders(null),
        ...form.getHeaders(),
      },
    });

    // Record message send in DB daily counter
    await recordMessageSent(finalAccountId, true);

    res.json({
      success: true,
      message: "Chat created and initial message sent successfully",
      chat_id: response.data.chat_id || response.data.id,
      recipient: formattedRecipient,
      delayed_seconds: (delayedMs / 1000).toFixed(1),
      data: response.data,
    });
  } catch (err) {
    handleError(err, res);
  }
});

/**
 * Send Message to Existing Chat
 * POST /api/whatsapp/chats/:chatId/messages
 * Multipart or JSON Body:
 * - account_id (or user_id)
 * - text
 * - attachments (optional file uploads)
 */
router.post(["/api/whatsapp/chats/:chatId/messages", "/api/unipile/whatsapp/chats/:chatId/messages"], upload.array("attachments", 10), async (req, res) => {
  try {
    const { chatId } = req.params;
    const { account_id, user_id, text = "" } = req.body;

    let finalAccountId = account_id;
    if (!finalAccountId && user_id) {
      const dbRes = await getWhatsAppAccountStatus(user_id);
      if (dbRes.success && dbRes.account_id) {
        finalAccountId = dbRes.account_id;
      }
    }

    if (!finalAccountId) {
      return res.status(400).json({
        success: false,
        error: "account_id or user_id is required",
      });
    }

    // 1. Check Limits (Existing chat send)
    const limitsCheck = await checkSendingLimits(finalAccountId, false);
    if (!limitsCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: limitsCheck.code || "LIMIT_EXCEEDED",
        message: limitsCheck.reason,
        details: limitsCheck,
      });
    }

    // 2. Enforce Minimum Randomized Delay (10-20 seconds)
    const delayedMs = await enforceSendingDelay(finalAccountId);

    // 3. Construct Form Data
    const form = new FormData();
    form.append("account_id", finalAccountId);
    form.append("text", text);

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        if (file.size > 15 * 1024 * 1024) {
          return res.status(400).json({
            success: false,
            error: `File ${file.originalname} exceeds the 15MB limit for WhatsApp attachments.`,
          });
        }
        form.append("attachments", file.buffer, {
          filename: file.originalname,
          contentType: file.mimetype,
        });
      }
    }

    console.log(`Sending message to WhatsApp chat ${chatId} from account ${finalAccountId}...`);

    const response = await axios.post(`${getBaseUrl()}/chats/${chatId}/messages`, form, {
      headers: {
        ...getHeaders(null),
        ...form.getHeaders(),
      },
    });

    // Record message sent
    await recordMessageSent(finalAccountId, false);

    res.json({
      success: true,
      message: "Message sent successfully",
      chat_id: chatId,
      delayed_seconds: (delayedMs / 1000).toFixed(1),
      data: {
        ...response.data,
        delivered: response.data.delivered ?? true,
        seen: response.data.seen ?? false,
        is_sender: true,
      },
    });
  } catch (err) {
    handleError(err, res);
  }
});

// ==================== 3. DELIVERY, READ & REPLY STATUS WEBHOOKS ====================

/**
 * Webhook Handler for Unipile Events
 * POST /api/whatsapp/webhook
 * Events handled:
 * - message_delivered
 * - message_read
 * - message_received
 * - message_reaction
 * - message_edited
 * - message_deleted
 * - account_status / account_connected
 */
router.post(["/api/whatsapp/webhook", "/api/unipile/whatsapp/webhook"], async (req, res) => {
  try {
    const payload = req.body;
    const event = payload.event || payload.type;
    const accountId = payload.account_id;

    console.log(`📩 Received WhatsApp Webhook Event: ${event} for Account: ${accountId}`);

    switch (event) {
      case "message_delivered":
        console.log(`✅ Message Delivered: ${payload.message_id || payload.id}`);
        // Cache or store delivery status
        if (payload.message_id) {
          whatsappCache.set(`msg_status:${payload.message_id}`, {
            delivered: true,
            delivered_at: new Date(),
          });
        }
        break;

      case "message_read":
        console.log(`👁️ Message Read by recipient: ${payload.message_id || payload.id}`);
        if (payload.message_id) {
          whatsappCache.set(`msg_status:${payload.message_id}`, {
            delivered: true,
            seen: true,
            seen_by: payload.seen_by || [payload.recipient_id],
            seen_at: new Date(),
          });
        }
        break;

      case "message_received":
        console.log(`💬 Incoming Reply / Echoed Message: ${payload.text}`);
        // Store incoming message metadata
        whatsappCache.set(`incoming_msg:${payload.id || Date.now()}`, {
          ...payload,
          is_sender: payload.is_sender ?? false,
        });
        break;

      case "message_reaction":
        console.log(`👍 Message Reaction: ${payload.reaction} on Message ${payload.message_id}`);
        break;

      case "message_edited":
        console.log(`✏️ Message Edited: ${payload.message_id}`);
        break;

      case "message_deleted":
        console.log(`🗑️ Message Deleted: ${payload.message_id}`);
        break;

      case "account_status":
      case "account_connected":
      case "account_disconnected":
        if (accountId && payload.status) {
          await updateWhatsAppAccountStatusByAccountId(accountId, payload.status, {
            last_event: event,
          });
        }
        break;

      default:
        console.log(`Unhandled webhook event: ${event}`);
    }

    res.json({ success: true, processed_event: event });
  } catch (err) {
    console.error("Webhook processing error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 4. FETCHING CONVERSATIONS & MESSAGES ====================

/**
 * Fetch WhatsApp Chats List
 * GET /api/whatsapp/chats
 * Query: ?account_id=... &limit=50 &cursor=...
 */
router.get(["/api/whatsapp/chats", "/api/unipile/whatsapp/chats"], async (req, res) => {
  try {
    const { account_id, user_id, limit = 50, cursor, include_messages = "false", include_profiles = "false", message_limit = 50 } = req.query;

    let finalAccountId = account_id;
    if (!finalAccountId && user_id) {
      const dbRes = await getWhatsAppAccountStatus(user_id);
      if (dbRes.success && dbRes.account_id) {
        finalAccountId = dbRes.account_id;
      }
    }

    if (!finalAccountId) {
      return res.status(400).json({
        success: false,
        error: "account_id or user_id query parameter is required",
      });
    }

    const params = new URLSearchParams({
      account_id: finalAccountId,
      limit: String(limit),
      ...(cursor && { cursor: cursor }),
    });

    const response = await axios.get(`${getBaseUrl()}/chats?${params}`, {
      headers: getHeaders(),
    });

    let rawChats = response.data.items || response.data || [];

    const shouldHydrate = include_messages === "true" || include_messages === true || include_profiles === "true" || include_profiles === true;

    if (!shouldHydrate) {
      return res.json({
        success: true,
        account_id: finalAccountId,
        chats: rawChats,
        cursor: response.data.cursor || null,
      });
    }

    // Hydrate messages & attendee profiles with profile picture URLs
    const hydrateChat = async (chat) => {
      const chatId = chat.id || chat.chat_id;
      if (!chatId) return { ...chat, messages: [], attendees_profiles: [] };

      try {
        const queryParams = new URLSearchParams();
        queryParams.append("account_id", finalAccountId);

        const msgParams = new URLSearchParams(queryParams);
        msgParams.append("limit", String(message_limit));

        const [messagesRes, attendeesRes] = await Promise.all([
          axios
            .get(`${getBaseUrl()}/chats/${chatId}/messages?${msgParams}`, {
              headers: getHeaders(),
              timeout: 4000,
            })
            .then((r) => r.data?.items || r.data?.messages || [])
            .catch(() => []),
          axios
            .get(`${getBaseUrl()}/chats/${chatId}/attendees?${queryParams}`, {
              headers: getHeaders(),
              timeout: 4000,
            })
            .then((r) => r.data?.items || r.data || [])
            .catch(() => []),
        ]);

        const attendeesList =
          Array.isArray(attendeesRes) && attendeesRes.length > 0
            ? attendeesRes
            : Array.isArray(chat.attendees)
            ? chat.attendees
            : Array.isArray(chat.participants)
            ? chat.participants
            : [];

        const profiles = attendeesList
          .filter((a) => !a.is_self && a.is_self !== 1)
          .map((a) => {
            const attId = a.id || a.provider_id;
            const directPic = a.picture_url || a.picture || a.profile_picture_url || a.avatar_url || null;
            const proxyPic = `${req.protocol}://${req.get("host")}/api/whatsapp/attendees/${encodeURIComponent(attId)}/picture?account_id=${finalAccountId}`;

            return {
              id: attId,
              name: a.name || chat.name || "WhatsApp Contact",
              provider_id: a.provider_id || a.id,
              public_identifier: a.public_identifier || a.phone_number || a.provider_id,
              picture_url: directPic,
              profile_picture_url: directPic || proxyPic,
            };
          });

        return {
          ...chat,
          attendees_profiles: profiles,
          messages: messagesRes,
          message_count: messagesRes.length,
        };
      } catch (err) {
        return { ...chat, attendees_profiles: [], messages: [] };
      }
    };

    const hydratedResults = await Promise.allSettled(
      rawChats.map((c) => hydrateChat(c))
    );

    const hydratedChats = hydratedResults
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);

    res.json({
      success: true,
      account_id: finalAccountId,
      chats: hydratedChats,
      cursor: response.data.cursor || null,
    });
  } catch (err) {
    handleError(err, res);
  }
});

/**
 * Fetch Messages for a Specific WhatsApp Chat
 * GET /api/whatsapp/chats/:chatId/messages
 * Query: ?account_id=... &limit=100 &cursor=...
 * Returns paginated conversation history including is_sender, delivered, seen, seen_by
 */
router.get(["/api/whatsapp/chats/:chatId/messages", "/api/unipile/whatsapp/chats/:chatId/messages"], async (req, res) => {
  try {
    const { chatId } = req.params;
    const { account_id, user_id, limit = 100, cursor } = req.query;

    let finalAccountId = account_id;
    if (!finalAccountId && user_id) {
      const dbRes = await getWhatsAppAccountStatus(user_id);
      if (dbRes.success && dbRes.account_id) {
        finalAccountId = dbRes.account_id;
      }
    }

    if (!finalAccountId) {
      return res.status(400).json({
        success: false,
        error: "account_id or user_id query parameter is required",
      });
    }

    const params = new URLSearchParams({
      account_id: finalAccountId,
      limit: String(Math.min(Number(limit), 100)), // Limit to max 100/page per docs
      ...(cursor && { cursor: cursor }),
    });

    const response = await axios.get(`${getBaseUrl()}/chats/${chatId}/messages?${params}`, {
      headers: getHeaders(),
    });

    const rawMessages = response.data.items || response.data || [];

    // Map messages to ensure delivery, read, and sender direction fields
    const formattedMessages = rawMessages.map((msg) => ({
      id: msg.id || msg.message_id,
      chat_id: chatId,
      text: msg.text || msg.body || "",
      timestamp: msg.timestamp || msg.created_at,
      is_sender: Boolean(msg.is_sender),
      sender_id: msg.sender_id || msg.from,
      delivered: msg.delivered ?? true,
      seen: msg.seen ?? false,
      seen_by: msg.seen_by || [],
      attachments: msg.attachments || [],
      raw: msg,
    }));

    res.json({
      success: true,
      chat_id: chatId,
      account_id: finalAccountId,
      messages: formattedMessages,
      limit: Number(limit),
      cursor: response.data.cursor || null,
    });
  } catch (err) {
    handleError(err, res);
  }
});

// ==================== 5. SENDING LIMITS & WARMUP STATUS ====================

/**
 * Get Account Sending Limits & Warm-up Status
 * GET /api/whatsapp/limits-status
 * Query: ?account_id=... or ?user_id=...
 */
router.get(["/api/whatsapp/limits-status", "/api/unipile/whatsapp/limits-status"], async (req, res) => {
  try {
    const { account_id, user_id } = req.query;

    let targetAccountId = account_id;
    if (!targetAccountId && user_id) {
      const dbRes = await getWhatsAppAccountStatus(user_id);
      if (dbRes.success && dbRes.account_id) {
        targetAccountId = dbRes.account_id;
      }
    }

    if (!targetAccountId) {
      return res.status(400).json({
        success: false,
        error: "account_id or user_id query parameter is required",
      });
    }

    const limitsRes = await checkSendingLimits(targetAccountId, true);
    const dbAccount = await getWhatsAppAccountByAccountId(targetAccountId);

    const now = new Date();
    const warmupEndsAt = dbAccount?.warmup_ends_at ? new Date(dbAccount.warmup_ends_at) : null;
    const isWarmupActive = warmupEndsAt ? warmupEndsAt > now : false;

    res.json({
      success: true,
      account_id: targetAccountId,
      warmup_active: isWarmupActive,
      warmup_ends_at: warmupEndsAt,
      hours_remaining: isWarmupActive
        ? Number(((warmupEndsAt - now) / (1000 * 60 * 60)).toFixed(1))
        : 0,
      daily_chats_count: dbAccount?.daily_chats_count || 0,
      daily_messages_count: dbAccount?.daily_messages_count || 0,
      limits: limitsRes.limits || {
        daily_new_chat_limit: 20,
        daily_total_message_limit: 50,
        min_delay_seconds: 10,
        max_delay_seconds: 20,
      },
      recommendations: [
        "Warm up new WhatsApp numbers for 24 hours after connection before outreach.",
        "Keep new-chat volume low (max 10-20/day during initial period).",
        "Enforce randomized 10–20 seconds minimum delay between messages.",
        "Optimize initial messages for replies to maintain high deliverability score.",
      ],
    });
  } catch (err) {
    handleError(err, res);
  }
});

// ==================== 6. ATTACHMENTS (DOWNLOAD RECEIVING) ====================

/**
 * Download Attachment for a Message
 * GET /api/whatsapp/messages/:messageId/attachments/:attachmentId
 * Query: ?account_id=...
 */
router.get(["/api/whatsapp/messages/:messageId/attachments/:attachmentId", "/api/unipile/whatsapp/messages/:messageId/attachments/:attachmentId"], async (req, res) => {
  try {
    const { messageId, attachmentId } = req.params;
    const { account_id, user_id } = req.query;

    let finalAccountId = account_id;
    if (!finalAccountId && user_id) {
      const dbRes = await getWhatsAppAccountStatus(user_id);
      if (dbRes.success && dbRes.account_id) {
        finalAccountId = dbRes.account_id;
      }
    }

    if (!finalAccountId) {
      return res.status(400).json({
        success: false,
        error: "account_id or user_id query parameter is required",
      });
    }

    console.log(`Downloading WhatsApp attachment ${attachmentId} for message ${messageId}...`);

    const response = await axios.get(
      `${getBaseUrl()}/messages/${messageId}/attachments/${attachmentId}?account_id=${finalAccountId}`,
      {
        headers: getHeaders(),
        responseType: "stream",
      }
    );

    // Forward content headers from Unipile response
    if (response.headers["content-type"]) {
      res.setHeader("Content-Type", response.headers["content-type"]);
    }
    if (response.headers["content-disposition"]) {
      res.setHeader("Content-Disposition", response.headers["content-disposition"]);
    }
    if (response.headers["content-length"]) {
      res.setHeader("Content-Length", response.headers["content-length"]);
    }

    response.data.pipe(res);
  } catch (err) {
    handleError(err, res);
  }
});

module.exports = router;
