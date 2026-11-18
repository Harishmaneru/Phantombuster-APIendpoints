/**
 * Unipile v2 configuration.
 *
 * Everything is read from process.env at call time (not at require time) so the
 * values can be changed in tests and so requiring this module never throws.
 *
 * Env vars:
 *   UNIPILE_API_VERSION        "v1" (default) | "v2" — which module app.js mounts
 *   UNIPILE_V2_API_KEY         v2 Global Account API Key (X-API-KEY)
 *   UNIPILE_V2_BASE_URL        default https://api.unipile.com/v2
 *   UNIPILE_V2_WEBHOOK_SECRET  secret of the v2 webhook endpoint (dashboard)
 */

const DEFAULT_BASE_URL = "https://api.unipile.com/v2";

const getApiVersion = () =>
  String(process.env.UNIPILE_API_VERSION || "v1").trim().toLowerCase() === "v2"
    ? "v2"
    : "v1";

const isV2Mode = () => getApiVersion() === "v2";

const getBaseUrl = () =>
  String(process.env.UNIPILE_V2_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");

const getApiKey = () => process.env.UNIPILE_V2_API_KEY || "";

const getWebhookSecret = () => process.env.UNIPILE_V2_WEBHOOK_SECRET || "";

/**
 * Throws if v2 is the active version but required settings are missing.
 * Called by unipileV2/index.js (v2 routes) — the webhook only needs the secret
 * and degrades gracefully without it.
 */
const assertV2Config = () => {
  if (isV2Mode() && !getApiKey()) {
    throw new Error(
      "UNIPILE_API_VERSION=v2 but UNIPILE_V2_API_KEY is not set",
    );
  }
};

module.exports = {
  DEFAULT_BASE_URL,
  getApiVersion,
  isV2Mode,
  getBaseUrl,
  getApiKey,
  getWebhookSecret,
  assertV2Config,
};
