/**
 * Unipile v2 webhook receiver.
 *
 *   POST /api/unipile/v2/webhook   — register this URL in the v2 dashboard
 *   GET  /api/unipile/v2/webhook   — setup check (is the secret configured?)
 *
 * Mounted in BOTH modes (UNIPILE_API_VERSION=v1|v2), and BEFORE the global
 * express.json() in app.js, because the signature is computed over the raw body.
 *
 * Signature (docs: "Configure a webhook → Secure your endpoint"):
 *   unipile-signature: t=<unix seconds>,v0=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
 *
 * Event envelope: { id, type, created_at, account_id, account_provider,
 *                   account_name, payload, ... }
 */

const crypto = require("crypto");
const express = require("express");
const NodeCache = require("node-cache");

const config = require("./core/config");
const client = require("./core/client");
const defaultEventCache = require("./core/eventCache");
const { storeForProvider } = require("./services/accountStore");

const WEBHOOK_PATH = "/api/unipile/v2/webhook";
const SIGNATURE_HEADER = "unipile-signature";
const SIGNATURE_TOLERANCE_SEC = 300;

// ==================== SIGNATURE ====================

function parseSignatureHeader(header) {
  const result = { t: null, v0: [] };
  if (!header || typeof header !== "string") return result;
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === "t") result.t = value;
    else if (key === "v0" && value) result.v0.push(value);
  }
  return result;
}

function computeSignature(secret, timestamp, rawBody) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest("hex");
}

function safeEqualHex(a, b) {
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * @returns {{ ok: boolean, reason?: string }}
 */
function verifySignature({
  header,
  rawBody,
  secret,
  toleranceSec = SIGNATURE_TOLERANCE_SEC,
  nowSec = Math.floor(Date.now() / 1000),
}) {
  if (!secret) return { ok: false, reason: "secret_not_configured" };
  const { t, v0 } = parseSignatureHeader(header);
  if (!t || v0.length === 0) return { ok: false, reason: "missing_signature" };
  const timestamp = Number(t);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: "invalid_timestamp" };
  if (Math.abs(nowSec - timestamp) > toleranceSec) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "", "utf8");
  const expected = computeSignature(secret, t, body);
  return v0.some((sig) => safeEqualHex(sig, expected))
    ? { ok: true }
    : { ok: false, reason: "signature_mismatch" };
}

// ==================== EVENT → STATUS MAPPING ====================

/**
 * v2 account event → v1-vocabulary status (what uniplieApi code and the
 * frontend already understand) + the raw v2 status.
 * status: null means "don't touch the primary status/connected fields".
 */
const ACCOUNT_EVENT_MAP = {
  "account.add": { status: "CREATION_SUCCESS", connected: true, v2Status: "running" },
  "account.reconnect": { status: "RECONNECTED", connected: true, v2Status: "running" },
  "account.status.running": { status: "OK", connected: true, v2Status: "running" },
  "account.status.disconnected": { status: "CREDENTIALS", connected: false, v2Status: "disconnected" },
  "account.status.errored": { status: "ERROR", connected: false, v2Status: "errored" },
  "account.status.degraded": { status: null, v2Status: "degraded" },
  "account.status.partial": { status: null, v2Status: "partial" },
  "account.remove": { status: "DELETED", connected: false, v2Status: "removed" },
  "account.locked": { status: null, v2Status: null, extra: { v2_locked: true } },
  "account.unlocked": { status: null, v2Status: null, extra: { v2_locked: false } },
  "account.initial_sync.running": { status: null, v2Status: null, extra: { v2_initial_sync: "running" } },
  "account.initial_sync.completed": { status: null, v2Status: null, extra: { v2_initial_sync: "completed" } },
  "account.initial_sync.failed": { status: null, v2Status: null, extra: { v2_initial_sync: "failed" } },
};

function mapAccountEvent(type) {
  return ACCOUNT_EVENT_MAP[type] || null;
}

/** The v2 account id of an event, wherever Unipile put it. */
function eventAccountId(event) {
  return event.account_id || event.payload?.account?.id || null;
}

function eventProvider(event) {
  return event.account_provider || event.payload?.account?.provider || null;
}

// ==================== PROCESSING ====================

/**
 * Find the Mongo record an account event belongs to, linking it to the v2 id
 * when it is found through the v1 id.
 */
async function resolveAccountDoc({ store, event, v2AccountId, writePrimary, apiClient, log }) {
  // 1. Already linked to this v2 id.
  let doc = await store.findByAnyAccountId(v2AccountId);
  if (doc) return { doc, via: "v2_account_id" };

  const type = event.type;
  const state = event.payload?.state;
  const isLinkEvent = type === "account.add" || type === "account.reconnect";

  // 2. Hosted auth `state` carries our user_id.
  if (state && isLinkEvent) {
    const meta = ACCOUNT_EVENT_MAP[type];
    if (writePrimary) {
      const action = await store.upsertForUser(state, {
        v2AccountId,
        name: event.payload?.account?.name || event.account_name,
        status: meta.status,
        connected: meta.connected,
        eventType: type,
      });
      log(`✅ ${action} ${store.provider} record for user ${state} → ${v2AccountId} (state)`);
      return { doc: null, via: "state_upsert", handled: true };
    }
    // v1 mode: only link an existing record, never create one v1 code can't use.
    doc = await store.findByUserId(state);
    if (doc) {
      await store.linkV2Account(doc._id, v2AccountId);
      return { doc, via: "state" };
    }
  }

  // 3. Migrated account: v2 account metadata.v1_account_id → existing v1 record.
  let v1AccountId = event.payload?.account?.metadata?.v1_account_id || null;
  if (!v1AccountId && type !== "account.remove") {
    try {
      const res = await apiClient.get(`/accounts/${encodeURIComponent(v2AccountId)}`, {
        timeout: 4000,
        maxRetries: 0,
      });
      v1AccountId = res.data?.metadata?.v1_account_id || null;
    } catch (err) {
      log(`⚠️ Could not fetch v2 account ${v2AccountId}: ${err.response?.status || ""} ${err.message}`);
    }
  }
  if (v1AccountId) {
    doc = await store.findByAnyAccountId(v1AccountId);
    if (doc) {
      await store.linkV2Account(doc._id, v2AccountId);
      log(`🔗 Linked v1 account ${v1AccountId} → v2 ${v2AccountId} (user ${doc.user_id})`);
      return { doc, via: "v1_account_id" };
    }
  }

  return { doc: null, via: "unmatched" };
}

async function processAccountEvent(event, deps) {
  const { writePrimary, log } = deps;
  const meta = mapAccountEvent(event.type);
  if (!meta) return { handled: false, reason: "unknown_account_event" };

  const store = deps.storeForProvider(eventProvider(event));
  if (!store) {
    log(`ℹ️ ${event.type} for ${eventProvider(event) || "unknown"} account ${eventAccountId(event) || "?"} received — not stored (only LinkedIn/WhatsApp are tracked)`);
    return { handled: false, reason: `unsupported_provider:${eventProvider(event)}` };
  }

  const v2AccountId = eventAccountId(event);
  if (!v2AccountId) return { handled: false, reason: "missing_account_id" };

  const resolved = await resolveAccountDoc({
    store,
    event,
    v2AccountId,
    writePrimary,
    apiClient: deps.apiClient,
    log,
  });
  if (resolved.handled) return { handled: true, via: resolved.via };
  if (!resolved.doc) {
    log(`⚠️ No ${store.provider} record matches v2 account ${v2AccountId} (${event.type})`);
    return { handled: false, reason: "unmatched_account" };
  }

  await store.applyStatus(resolved.doc._id, {
    v2Status: meta.v2Status,
    status: meta.status,
    connected: meta.connected,
    reason: event.payload?.reason,
    eventType: event.type,
    extra: meta.extra,
    writePrimary,
  });
  log(
    `✅ ${event.type} applied to ${store.provider} user ${resolved.doc.user_id}` +
      (writePrimary && meta.status ? ` (status=${meta.status})` : " (v2 fields only)"),
  );
  return { handled: true, via: resolved.via };
}

function processMessageEvent(event, { eventCache, log }) {
  const p = event.payload || {};
  const messageId = p.message_id || p.message?.id || p.id;
  const base = {
    account_id: event.account_id,
    provider: event.account_provider,
    chat_id: p.chat_id || p.message?.chat_id,
    event: event.type,
    at: event.created_at || new Date().toISOString(),
  };

  switch (event.type) {
    case "message.new":
      eventCache.set(`incoming_msg:${messageId || event.id}`, { ...p, ...base });
      break;
    case "message.receipt.delivery":
      if (messageId) {
        eventCache.set(`msg_status:${messageId}`, {
          ...(eventCache.get(`msg_status:${messageId}`) || {}),
          delivered: true,
          delivered_at: base.at,
        });
      }
      break;
    case "message.receipt.read":
      if (messageId) {
        eventCache.set(`msg_status:${messageId}`, {
          ...(eventCache.get(`msg_status:${messageId}`) || {}),
          delivered: true,
          seen: true,
          seen_at: base.at,
          seen_by: p.user ? [p.user] : p.users || undefined,
        });
      }
      break;
    case "message.reaction.new":
    case "message.reaction.delete":
    case "message.update":
    case "message.delete":
      if (messageId) eventCache.set(`msg_event:${messageId}`, { ...p, ...base });
      break;
    default:
      return { handled: false, reason: "unknown_message_event" };
  }
  log(`💬 ${event.type} cached (${base.provider || "?"} message ${messageId || "?"})`);
  return { handled: true };
}

async function processEvent(event, deps) {
  const type = String(event?.type || "");
  if (type.startsWith("account.")) return processAccountEvent(event, deps);
  if (type.startsWith("message.")) return processMessageEvent(event, deps);
  deps.log(`ℹ️ Ignoring v2 webhook event ${type || "(no type)"}`);
  return { handled: false, reason: "ignored_event_type" };
}

// ==================== ROUTER ====================

function createWebhookRouter(overrides = {}) {
  const deps = {
    getSecret: config.getWebhookSecret,
    isV2Mode: config.isV2Mode,
    apiClient: client,
    storeForProvider,
    eventCache: defaultEventCache,
    log: (msg) => console.log(`[unipile-v2-webhook] ${msg}`),
    seenEvents: new NodeCache({ stdTTL: 60 * 60, checkperiod: 120 }),
    ...overrides,
  };

  const router = express.Router();

  router.get(WEBHOOK_PATH, (req, res) => {
    res.json({
      success: true,
      endpoint: WEBHOOK_PATH,
      secret_configured: Boolean(deps.getSecret()),
      api_version: deps.isV2Mode() ? "v2" : "v1",
    });
  });

  router.post(
    WEBHOOK_PATH,
    express.raw({ type: "*/*", limit: "10mb" }),
    (req, res) => {
      const secret = deps.getSecret();
      if (!secret) {
        deps.log("❌ UNIPILE_V2_WEBHOOK_SECRET is not set — rejecting event");
        return res.status(503).json({ success: false, error: "Webhook secret not configured" });
      }

      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
      const check = verifySignature({
        header: req.get(SIGNATURE_HEADER),
        rawBody,
        secret,
      });
      if (!check.ok) {
        deps.log(`❌ Rejected webhook: ${check.reason}`);
        return res.status(401).json({ success: false, error: "Invalid signature" });
      }

      let event;
      try {
        event = JSON.parse(rawBody.toString("utf8"));
      } catch (err) {
        return res.status(400).json({ success: false, error: "Invalid JSON body" });
      }

      // Unipile retries failed deliveries (+2s, +12s): ignore duplicates.
      if (event.id && deps.seenEvents.get(event.id)) {
        return res.json({ success: true, duplicate: true });
      }
      if (event.id) deps.seenEvents.set(event.id, true);

      // Acknowledge first (Unipile requires < 5s), then process.
      res.json({ success: true, received: event.type || null });

      const writePrimary = deps.isV2Mode();
      setImmediate(() => {
        processEvent(event, { ...deps, writePrimary }).catch((err) => {
          deps.log(`❌ Failed to process ${event.type} (${event.id}): ${err.stack || err.message}`);
        });
      });
    },
  );

  return router;
}

const router = createWebhookRouter();

module.exports = router;
module.exports.WEBHOOK_PATH = WEBHOOK_PATH;
module.exports.createWebhookRouter = createWebhookRouter;
module.exports.parseSignatureHeader = parseSignatureHeader;
module.exports.computeSignature = computeSignature;
module.exports.verifySignature = verifySignature;
module.exports.mapAccountEvent = mapAccountEvent;
module.exports.processEvent = processEvent;
module.exports.ACCOUNT_EVENT_MAP = ACCOUNT_EVENT_MAP;
