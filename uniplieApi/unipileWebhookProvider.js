/**
 * Provider helpers for the v1 Unipile account webhook
 * (POST /api/unipile/webhook/unipile-account in linkedinMessaging.js).
 *
 * The webhook is registered in Unipile for ALL accounts, so it also receives
 * WhatsApp (and any other provider's) account status events. Those must not be
 * written to the LinkedIn accounts collection — WhatsApp status is handled in
 * whatsappMessaging.js.
 *
 * Kept free of DB/network dependencies so it can be unit-tested directly.
 */

/**
 * Read the provider from any of the payload shapes Unipile sends.
 * @param {Object} body - webhook request body
 * @returns {string|null} provider as sent (e.g. "LINKEDIN", "WHATSAPP"), or null if absent
 */
function extractWebhookProvider(body) {
  if (!body || typeof body !== "object") return null;
  const provider =
    body.AccountStatus?.account_type ||
    body.Account?.provider ||
    body.Account?.type ||
    body.provider ||
    null;
  return typeof provider === "string" && provider.trim() ? provider.trim() : null;
}

/**
 * True when the event should be ignored by the LinkedIn webhook: it names a
 * provider and that provider is not LinkedIn.
 *
 * Events with no provider at all are still processed — Unipile's hosted-auth
 * notify payload ({ status, account_id, name }) carries no provider, and the
 * handler has always treated those as LinkedIn.
 * @param {Object} body - webhook request body
 * @returns {boolean}
 */
function isNonLinkedInWebhookEvent(body) {
  const provider = extractWebhookProvider(body);
  return provider !== null && provider.toUpperCase() !== "LINKEDIN";
}

module.exports = { extractWebhookProvider, isNonLinkedInWebhookEvent };
