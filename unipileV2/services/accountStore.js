/**
 * Account records for unipileV2, stored in the SAME collections uniplieApi uses.
 *
 * One document per user and provider (unchanged from v1):
 *   { user_id, provider, account_id (v1 id), name, status, connected, ... }
 * v2 adds:
 *   v2_account_id     "acc_..." id of the same account in Unipile v2
 *   v2_status         raw v2 status (running | errored | disconnected | degraded | partial | removed)
 *   v2_status_reason  reason sent with account.status.errored / degraded
 *   v2_locked         from account.locked / account.unlocked
 *   v2_last_event     last v2 webhook event type applied
 *   v2_linked_at, v2_updated_at
 *
 * "Primary" fields (status / connected / last_error / connected_at /
 * disconnected_at) are what v1 code and the frontend read. They are only
 * written when the caller says so (writePrimary) — i.e. when unipileV2 is the
 * active version — so v1 and v2 webhooks never fight over them.
 */

const mongo = require("./mongo");

const WHATSAPP_INSERT_DEFAULTS = () => {
  const now = new Date();
  return {
    daily_chats_count: 0,
    daily_messages_count: 0,
    last_counter_reset: now,
    last_sent_at: null,
    limits_config: {
      daily_new_chat_limit: 20,
      daily_total_message_limit: 50,
      min_delay_seconds: 10,
      max_delay_seconds: 20,
      warmup_duration_hours: 24,
    },
  };
};

/** Fields written to the primary (v1-visible) status for a connected/disconnected change. */
function primaryStatusFields({ status, connected, reason, provider }) {
  const now = new Date();
  const fields = { status, connected };
  if (connected) {
    fields.last_error = null;
    fields.connected_at = now;
    if (provider === "WHATSAPP") {
      fields.warmup_ends_at = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }
  } else {
    fields.last_error = reason ? `Account status: ${status} (${reason})` : `Account status: ${status}`;
    fields.disconnected_at = now;
  }
  return fields;
}

/**
 * @param {Object} opts
 * @param {"LINKEDIN"|"WHATSAPP"} opts.provider
 * @param {string} opts.collectionName
 * @param {Function} [opts.getCollection] injectable for tests: (name) => Promise<Collection>
 */
function createAccountStore({
  provider,
  collectionName,
  getCollection = mongo.getCollection,
}) {
  const col = () => getCollection(collectionName);

  // Only this provider's records. The LinkedIn collection also holds hundreds of
  // provider:"WHATSAPP" records written by a v1 webhook bug — never match those.
  const anyIdFilter = (accountId) => ({
    provider,
    $or: [{ account_id: accountId }, { v2_account_id: accountId }],
  });

  // Placeholder records the v1 webhook creates before it knows the user.
  const NOT_TEMP = { $not: /^temp_/ };
  const isTemp = (doc) => typeof doc?.user_id === "string" && doc.user_id.startsWith("temp_");

  return {
    provider,
    collectionName,

    async findByUserId(userId) {
      if (!userId) return null;
      return (await col()).findOne({ user_id: String(userId), provider });
    },

    /** Match a v1 or a v2 account id; a real user's record wins over a temp_ one. */
    async findByAnyAccountId(accountId) {
      if (!accountId) return null;
      const docs = await (await col()).find(anyIdFilter(accountId)).limit(20).toArray();
      return docs.find((d) => !isTemp(d)) || docs[0] || null;
    },

    /** The v2 account id for a user, or null if the user has not been linked to v2 yet. */
    async getV2AccountId(userId) {
      const doc = await this.findByUserId(userId);
      return doc?.v2_account_id || null;
    },

    /** Attach a v2 account id to an existing document (matched by _id). */
    async linkV2Account(docId, v2AccountId) {
      const now = new Date();
      await (await col()).updateOne(
        { _id: docId },
        { $set: { v2_account_id: v2AccountId, v2_linked_at: now, v2_updated_at: now } },
      );
    },

    /**
     * Link by v1 account id (used by the backfill script). Only real users'
     * records of this provider are linked (no temp_ placeholders).
     * @returns {Promise<{ matched: number, users: string[], tempCount: number }>}
     */
    async linkV2AccountByV1Id(v1AccountId, v2AccountId, { dryRun = false } = {}) {
      const c = await col();
      const filter = { provider, account_id: v1AccountId, user_id: NOT_TEMP };
      const docs = await c.find(filter).project({ user_id: 1 }).toArray();
      const tempCount = await c.countDocuments({
        provider,
        account_id: v1AccountId,
        user_id: /^temp_/,
      });
      if (!dryRun && docs.length) {
        const now = new Date();
        await c.updateMany(filter, {
          $set: { v2_account_id: v2AccountId, v2_linked_at: now, v2_updated_at: now },
        });
      }
      return { matched: docs.length, users: docs.map((d) => d.user_id), tempCount };
    },

    /**
     * Apply a v2 status change to the document matched by _id.
     * @param {*} docId
     * @param {Object} change
     * @param {string|null} change.v2Status
     * @param {string|null} change.status       v1-vocabulary status (null = leave primary fields alone)
     * @param {boolean} [change.connected]
     * @param {string} [change.reason]
     * @param {string} change.eventType
     * @param {Object} [change.extra]           extra v2_* fields to set
     * @param {boolean} change.writePrimary
     */
    async applyStatus(docId, { v2Status, status, connected, reason, eventType, extra = {}, writePrimary }) {
      const now = new Date();
      const set = {
        v2_last_event: eventType,
        v2_updated_at: now,
        ...extra,
      };
      if (v2Status) set.v2_status = v2Status;
      if (reason !== undefined) set.v2_status_reason = reason || null;
      if (writePrimary && status) {
        Object.assign(set, primaryStatusFields({ status, connected, reason, provider }), {
          updated_at: now,
        });
      }
      await (await col()).updateOne({ _id: docId }, { $set: set });
    },

    /**
     * Create or update the user's record from an account.add / account.reconnect
     * event in v2 mode (one record per user — a new account replaces the old one).
     */
    async upsertForUser(userId, { v2AccountId, name, status, connected, eventType }) {
      const now = new Date();
      const set = {
        user_id: String(userId),
        provider,
        v2_account_id: v2AccountId,
        v2_status: "running",
        v2_last_event: eventType,
        v2_linked_at: now,
        v2_updated_at: now,
        updated_at: now,
        "metadata.connected_via": "unipile_v2_webhook",
        ...primaryStatusFields({ status, connected, provider }),
      };
      if (name) set.name = name;
      const setOnInsert = {
        created_at: now,
        ...(provider === "WHATSAPP" ? WHATSAPP_INSERT_DEFAULTS() : {}),
      };
      const result = await (await col()).updateOne(
        { user_id: String(userId), provider },
        { $set: set, $setOnInsert: setOnInsert },
        { upsert: true },
      );
      return result.upsertedCount > 0 ? "created" : "updated";
    },
  };
}

const linkedinStore = createAccountStore({
  provider: "LINKEDIN",
  collectionName: mongo.COLLECTIONS.LINKEDIN,
});

const whatsappStore = createAccountStore({
  provider: "WHATSAPP",
  collectionName: mongo.COLLECTIONS.WHATSAPP,
});

/** Map a v2 provider string ("linkedin", "WHATSAPP", ...) to its store, or null. */
function storeForProvider(provider) {
  const p = String(provider || "").toUpperCase();
  if (p === "LINKEDIN") return linkedinStore;
  if (p === "WHATSAPP") return whatsappStore;
  return null;
}

module.exports = {
  createAccountStore,
  primaryStatusFields,
  linkedinStore,
  whatsappStore,
  storeForProvider,
};
