/**
 * Minimal HTTP client for the Unipile v2 API (https://api.unipile.com/v2).
 *
 * - Sends X-API-KEY on every request.
 * - Retries `429` responses (api/too_many_requests) up to `maxRetries` times,
 *   waiting for the `retry-after` header (seconds), capped at 30s.
 * - Paths are relative to the v2 base, e.g. "/accounts/acc_123" or
 *   `${accountPath(accountId)}/chats`.
 */

const axios = require("axios");
const config = require("./config");

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRY_WAIT_MS = 30_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Parse a retry-after header (seconds or HTTP date) into milliseconds. */
const retryAfterMs = (headerValue, fallbackMs = 1000) => {
  if (headerValue == null || headerValue === "") return fallbackMs;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(headerValue);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return fallbackMs;
};

/** Encode an account id as the first path segment: /{account_id} */
const accountPath = (accountId) => {
  if (!accountId) {
    const err = new Error("Unipile v2 account id is required");
    err.status = 400;
    throw err;
  }
  return `/${encodeURIComponent(accountId)}`;
};

/**
 * Perform a request against the v2 API.
 * @param {Object} opts
 * @param {string} opts.method   HTTP method (default GET)
 * @param {string} opts.path     path relative to the v2 base (must start with "/")
 * @param {Object} [opts.params] query params
 * @param {*}      [opts.data]   JSON body
 * @param {Object} [opts.headers]
 * @param {number} [opts.timeout]
 * @param {string} [opts.responseType] e.g. "stream" for file downloads
 * @param {number} [opts.maxRetries]   429 retries (default 2)
 * @returns {Promise<import('axios').AxiosResponse>}
 */
async function request({
  method = "GET",
  path,
  params,
  data,
  headers = {},
  timeout = DEFAULT_TIMEOUT_MS,
  responseType,
  maxRetries = 2,
  http = axios,
} = {}) {
  if (!path || !path.startsWith("/")) {
    throw new Error(`Unipile v2 path must start with "/": ${path}`);
  }
  const apiKey = config.getApiKey();
  if (!apiKey) {
    const err = new Error("UNIPILE_V2_API_KEY is not set");
    err.status = 500;
    throw err;
  }

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await http.request({
        method,
        url: `${config.getBaseUrl()}${path}`,
        params,
        data,
        timeout,
        responseType,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        headers: {
          "X-API-KEY": apiKey,
          Accept: "application/json",
          ...(data !== undefined && { "Content-Type": "application/json" }),
          ...headers,
        },
      });
    } catch (err) {
      const status = err.response?.status;
      if (status === 429 && attempt < maxRetries) {
        attempt += 1;
        const waitMs = Math.min(
          retryAfterMs(err.response.headers?.["retry-after"], 1000 * attempt),
          MAX_RETRY_WAIT_MS,
        );
        console.warn(
          `⏳ Unipile v2 rate limited (${method} ${path}); retry ${attempt}/${maxRetries} in ${waitMs}ms`,
        );
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }
}

const get = (path, opts = {}) => request({ ...opts, method: "GET", path });
const post = (path, data, opts = {}) =>
  request({ ...opts, method: "POST", path, data });
const patch = (path, data, opts = {}) =>
  request({ ...opts, method: "PATCH", path, data });
const del = (path, opts = {}) => request({ ...opts, method: "DELETE", path });

module.exports = {
  request,
  get,
  post,
  patch,
  del,
  accountPath,
  retryAfterMs,
};
