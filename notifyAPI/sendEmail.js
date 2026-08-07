const express = require("express");
const nodemailer = require("nodemailer");
const { ImapFlow: OriginalImapFlow } = require("imapflow");

class ImapFlow extends OriginalImapFlow {
  constructor(options) {
    super(options);
    // Prevent background socket errors/timeouts from crashing the Node.js process
    this.on("error", (err) => {
      console.error(
        "[ImapFlow Client Error Logged Safely]:",
        err.message || err,
      );
    });
  }
}
const { simpleParser } = require("mailparser");
const dns = require("node:dns").promises;
const crypto = require("crypto");
const mongoose = require("mongoose");
require("dotenv").config();

const ical = require("ical");
const IcalExpander = require("ical-expander");
const fetch = require("node-fetch");

const router = express.Router();

// Encryption setup
const algorithm = "aes-256-cbc";
const key = crypto.scryptSync(
  process.env.ENCRYPTION_SECRET || "default-secret-key-change-this",
  "salt",
  32,
);
const ivLength = 16;

function encrypt(text) {
  if (!text) return "";
  try {
    const iv = crypto.randomBytes(ivLength);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(text, "utf8"),
      cipher.final(),
    ]);
    return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
  } catch (error) {
    console.error("Encryption error:", error);
    throw new Error("Failed to encrypt password");
  }
}

function decrypt(encryptedText) {
  if (!encryptedText) return "";
  try {
    const [ivHex, encryptedHex] = encryptedText.split(":");
    if (!ivHex || !encryptedHex) throw new Error("Invalid encrypted format");
    const iv = Buffer.from(ivHex, "hex");
    const encrypted = Buffer.from(encryptedHex, "hex");
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch (error) {
    console.error("Decryption error:", error);
    throw new Error("Failed to decrypt password");
  }
}

const MICROSOFT_PERSONAL_DOMAINS = [
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
];

const MICROSOFT_WORK_DOMAINS = ["office365.com", "microsoft.com"];

const MICROSOFT_DOMAINS = [
  ...MICROSOFT_PERSONAL_DOMAINS,
  ...MICROSOFT_WORK_DOMAINS,
];

function getBaseUrl() {
  return (
    process.env.BASE_URL || "https://videoresponse.onepgr.com:3001"
  ).replace(/\/api\/?$/, "");
}

function getMicrosoftOAuthUrl(email) {
  return `${getBaseUrl()}/api/auth/microsoft/authorize?email=${encodeURIComponent(
    email,
  )}`;
}

function isMicrosoftAddress(email = "") {
  const domain = email.split("@")[1]?.toLowerCase() || "";
  return MICROSOFT_DOMAINS.some((item) => domain.includes(item));
}

function isMicrosoftHost(host = "") {
  const normalizedHost = host.toLowerCase();
  return (
    normalizedHost.includes("office365.com") ||
    normalizedHost.includes("outlook.com") ||
    normalizedHost.includes("live.com") ||
    normalizedHost.includes("hotmail.com")
  );
}

function isMicrosoftMailbox(smtpRecord, email) {
  return Boolean(
    (smtpRecord?.oauth2?.provider || "").toLowerCase() === "microsoft" ||
    isMicrosoftHost(smtpRecord?.host || "") ||
    isMicrosoftAddress(email),
  );
}

// Helper to determine accurate IMAP host from SMTP host
function getImapHost(smtpHost, email, providerHint) {
  const normalizedHost = smtpHost ? smtpHost.toLowerCase() : "";
  const normalizedProvider = (providerHint || "").toLowerCase();
  const domain = email.split("@")[1]?.toLowerCase() || "";

  if (
    normalizedProvider === "microsoft" ||
    isMicrosoftHost(normalizedHost) ||
    isMicrosoftAddress(email)
  ) {
    // Check if personal Outlook/Hotmail account
    const isPersonal = MICROSOFT_PERSONAL_DOMAINS.some((d) =>
      domain.includes(d),
    );

    if (isPersonal) {
      return "imap-mail.outlook.com"; // ✅ Personal Outlook/Hotmail
    } else {
      return "outlook.office365.com"; // ✅ Work/School Microsoft 365
    }
  }

  if (!normalizedHost) return "";

  // Generic fallback if not explicitly matched
  return normalizedHost.replace("smtp.", "imap.");
}

function isAuthenticationFailure(error) {
  return Boolean(
    error?.authenticationFailed ||
    error?.serverResponseCode === "AUTHENTICATIONFAILED" ||
    /auth/i.test(error?.message || "") ||
    /AUTHENTICATE|LOGIN/i.test(error?.executedCommand || ""),
  );
}

function buildMicrosoftOAuthRequiredResponse(
  email,
  error,
  operation = "access this mailbox",
) {
  return {
    success: false,
    provider: "microsoft",
    requiresOAuth: true,
    recommendedAuthMethod: "oauth2",
    oauthUrl: getMicrosoftOAuthUrl(email),
    error: "Microsoft rejected the mailbox login.",
    details: `Reconnect this Outlook/Microsoft 365 mailbox with OAuth2 to ${operation}. Password-based IMAP logins are commonly blocked by Microsoft unless the account supports app passwords and IMAP is enabled.`,
    imapError: error?.message || null,
    serverResponseCode: error?.serverResponseCode || null,
    executedCommand: error?.executedCommand || null,
  };
}

async function detectProvider(email) {
  const domain = email.split("@")[1].toLowerCase();

  if (MICROSOFT_DOMAINS.some((d) => domain.includes(d))) {
    return "microsoft";
  }
  if (domain.includes("gmail.com") || domain.includes("googlemail.com")) {
    return "google";
  }

  // Check MX for custom domains on Microsoft 365
  try {
    const mxRecords = await cachedMxLookup(domain);
    if (
      mxRecords.some(
        (mx) =>
          mx.exchange.includes("outlook") ||
          mx.exchange.includes("protection.outlook.com") ||
          mx.exchange.includes("microsoft"),
      )
    ) {
      return "microsoft";
    }
    if (
      mxRecords.some(
        (mx) =>
          mx.exchange.includes("google") ||
          mx.exchange.includes("aspmx.l.google.com"),
      )
    ) {
      return "google";
    }
  } catch (e) {
    console.log(
      `MX lookup failed for provider detection of ${domain}:`,
      e.message,
    );
  }

  return "other";
}

// Microsoft OAuth2 token refresh
async function refreshMicrosoftToken(smtpRecord) {
  const refreshToken = decrypt(smtpRecord.oauth2.refreshToken);

  const response = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    },
  );

  const data = await response.json();

  if (data.error) {
    console.error(
      `Microsoft token refresh failed for ${smtpRecord.email}:`,
      data.error_description,
    );
    throw new Error(`Token refresh failed: ${data.error_description}`);
  }

  // Update DB with new tokens
  await SMTPAuth.updateOne(
    { email: smtpRecord.email },
    {
      "oauth2.accessToken": encrypt(data.access_token),
      "oauth2.refreshToken": encrypt(data.refresh_token || refreshToken),
      "oauth2.expiresAt": new Date(Date.now() + data.expires_in * 1000),
      "oauth2.scope": data.scope,
    },
  );

  console.log(`✅ Microsoft token refreshed for ${smtpRecord.email}`);
  return data.access_token;
}

// In-memory lock to prevent concurrent token refreshes for same email
const _refreshLocks = new Map();

async function getValidAccessToken(smtpRecord) {
  if (!smtpRecord.oauth2 || !smtpRecord.oauth2.accessToken) {
    throw new Error("No OAuth2 tokens found for this account");
  }

  const now = new Date();
  const expiresAt = smtpRecord.oauth2.expiresAt
    ? new Date(smtpRecord.oauth2.expiresAt)
    : new Date(0);

  // Refresh if expired or expiring within 5 minutes
  if (now >= new Date(expiresAt.getTime() - 5 * 60 * 1000)) {
    // Prevent concurrent refreshes
    if (_refreshLocks.has(smtpRecord.email)) {
      return _refreshLocks.get(smtpRecord.email);
    }

    const refreshPromise = refreshMicrosoftToken(smtpRecord).finally(() => {
      _refreshLocks.delete(smtpRecord.email);
    });
    _refreshLocks.set(smtpRecord.email, refreshPromise);
    return refreshPromise;
  }

  return decrypt(smtpRecord.oauth2.accessToken);
}

// Microsoft Graph API Email Sending
// async function sendViaMicrosoftGraph(
//   smtpRecord,
//   from,
//   to,
//   cc,
//   bcc,
//   subject,
//   html,
//   text,
//   attachments,
// ) {
//   const accessToken = await getValidAccessToken(smtpRecord);

//   // Build recipient list
//   const toRecipients = Array.isArray(to) ? to : [to];
//   const ccRecipients = cc ? (Array.isArray(cc) ? cc : [cc]) : [];
//   const bccRecipients = bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : [];

//   const emailAddressList = (emails) =>
//     emails.map((email) => ({ emailAddress: { address: email } }));

//   // Build message object
//   const message = {
//     subject: subject,
//     body: {
//       contentType: html ? "HTML" : "Text",
//       content: html || text || "",
//     },
//     from: {
//       emailAddress: {
//         address: from,
//       },
//     },
//     toRecipients: emailAddressList(toRecipients),
//     ccRecipients:
//       ccRecipients.length > 0 ? emailAddressList(ccRecipients) : undefined,
//     bccRecipients:
//       bccRecipients.length > 0 ? emailAddressList(bccRecipients) : undefined,
//   };

//   // Handle attachments (Graph API requires base64 content)
//   if (attachments && attachments.length > 0) {
//     message.attachments = await Promise.all(
//       attachments.map(async (att) => {
//         // If content is already base64 string, use it; otherwise convert buffer
//         let contentBytes = att.content;
//         if (Buffer.isBuffer(att.content)) {
//           contentBytes = att.content.toString("base64");
//         } else if (typeof att.content === "string") {
//           // Assume already base64 or convert
//           contentBytes = Buffer.from(att.content).toString("base64");
//         }

//         return {
//           "@odata.type": "#microsoft.graph.fileAttachment",
//           name: att.filename || "attachment",
//           contentType: att.contentType || "application/octet-stream",
//           contentBytes: contentBytes,
//         };
//       }),
//     );
//   }

//   // Send via Graph API
//   const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
//     method: "POST",
//     headers: {
//       Authorization: `Bearer ${accessToken}`,
//       "Content-Type": "application/json",
//     },
//     body: JSON.stringify({ message: message, saveToSentItems: true }),
//   });

//   if (!response.ok) {
//     const error = await response.text();
//     throw new Error(`Graph API error (${response.status}): ${error}`);
//   }

//   return { success: true, method: "graph-api" };
// }

// Microsoft Graph API Email Sending
// Inject the open-tracking pixel and rewrite links for click tracking.
// Mirrors the SMTP send path so Graph-sent mail is tracked identically.
// Returns the processed HTML (unchanged when html is empty or trackLinks off).
function applyEmailTracking(html, trackLinks, trackingId) {
  if (!html || !trackLinks) return html;

  const baseUrl = (
    process.env.BASE_URL || "https://videoresponse.onepgr.com:3001"
  ).replace(/\/api\/?$/, "");
  const trackingPixelUrl = `${baseUrl}/api/track/open/${trackingId}`;
  const pixelTag = `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none;border:0;" alt=""/>`;

  let out = html;
  if (out.includes("</body>")) {
    out = out.replace("</body>", `${pixelTag}</body>`);
  } else if (out.includes("</html>")) {
    out = out.replace("</html>", `${pixelTag}</html>`);
  } else {
    out += pixelTag;
  }

  out = out.replace(
    /<a\s+([^>]*)href=["']([^"']+)["']([^>]*)>(.*?)<\/a>/gi,
    (match, beforeHref, url, afterHref, content) => {
      const fullAttributes = beforeHref + 'href="' + url + '"' + afterHref;
      const shouldSkipTracking =
        fullAttributes.includes('data-no-track="true"') ||
        fullAttributes.includes("data-no-track='true'") ||
        fullAttributes.includes('data-media-link="true"') ||
        fullAttributes.includes("data-media-link='true'");
      if (shouldSkipTracking) return match;
      if (url.startsWith("http") && !url.includes(baseUrl)) {
        const encodedUrl = encodeURIComponent(url);
        return `<a ${beforeHref}href="${baseUrl}/api/track/click/${trackingId}?url=${encodedUrl}"${afterHref}>${content}</a>`;
      }
      return match;
    },
  );
  return out;
}

async function sendViaMicrosoftGraph(
  smtpRecord,
  from,
  to,
  cc,
  bcc,
  subject,
  html,
  text,
  attachments,
  internetMessageId,
) {
  const accessToken = await getValidAccessToken(smtpRecord);

  // Helper to parse email strings (handles comma-separated, arrays, or single)
  const parseEmailList = (input) => {
    if (!input) return [];
    if (Array.isArray(input)) return input;
    // Split by comma and trim whitespace
    return input
      .split(",")
      .map((email) => email.trim())
      .filter((e) => e);
  };

  // Build recipient list
  const toRecipients = parseEmailList(to);
  const ccRecipients = parseEmailList(cc);
  const bccRecipients = parseEmailList(bcc);

  const emailAddressList = (emails) =>
    emails.map((email) => ({ emailAddress: { address: email } }));

  // Build message object
  const message = {
    subject: subject,
    body: {
      contentType: html ? "HTML" : "Text",
      content: html || text || "",
    },
    from: {
      emailAddress: {
        address: from,
      },
    },
    toRecipients: emailAddressList(toRecipients),
    ccRecipients:
      ccRecipients.length > 0 ? emailAddressList(ccRecipients) : undefined,
    bccRecipients:
      bccRecipients.length > 0 ? emailAddressList(bccRecipients) : undefined,
  };

  // Pin our own Message-ID so replies (In-Reply-To/References) can be matched.
  if (internetMessageId) {
    message.internetMessageId = internetMessageId;
  }

  // Handle attachments (Graph API requires base64 content)
  if (attachments && attachments.length > 0) {
    message.attachments = await Promise.all(
      attachments.map(async (att) => {
        let contentBytes = att.content;
        if (Buffer.isBuffer(att.content)) {
          contentBytes = att.content.toString("base64");
        } else if (typeof att.content === "string") {
          contentBytes = Buffer.from(att.content).toString("base64");
        }

        return {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: att.filename || "attachment",
          contentType: att.contentType || "application/octet-stream",
          contentBytes: contentBytes,
        };
      }),
    );
  }

  // Send via Graph API
  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: message, saveToSentItems: true }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Graph API error (${response.status}): ${error}`);
  }

  return { success: true, method: "graph-api" };
}

// Microsoft Graph API Inbox Fetching
async function fetchInboxViaGraph(
  accessToken,
  folder = "inbox",
  top = 20,
  skip = 0,
) {
  const url = `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages?$top=${top}&$skip=${skip}&$orderby=receivedDateTime desc&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,hasAttachments`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) throw new Error(`Graph API error: ${response.status}`);

  const data = await response.json();

  return data.value.map((msg) => ({
    uid: msg.id,
    subject: msg.subject,
    from: msg.from?.emailAddress?.address || "Unknown",
    to: msg.toRecipients?.map((r) => r.emailAddress.address).join(", "),
    date: msg.receivedDateTime,
    read: msg.isRead,
    text: msg.bodyPreview,
    messageId: msg.id,
    hasAttachments: msg.hasAttachments,
  }));
}

async function fetchMimeContentViaGraph(accessToken, messageId) {
  const url = `https://graph.microsoft.com/v1.0/me/messages/${messageId}/$value`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Graph API raw MIME fetch error (${response.status}): ${body}`,
    );
  }
  return await response.buffer();
}

// Microsoft Graph reply detection.
// Microsoft OAuth tokens here carry Graph scopes only (Mail.Read/Mail.Send) and
// NOT IMAP.AccessAsUser.All, so IMAP XOAUTH2 fails with "Command failed".
// We read the inbox over Graph and match replies by the original Message-ID.
async function fetchInboxForReplyMatch(accessToken, sinceIso) {
  const select = [
    "id",
    "subject",
    "from",
    "toRecipients",
    "receivedDateTime",
    "conversationId",
    "internetMessageId",
    "internetMessageHeaders",
    "bodyPreview",
  ].join(",");

  let url =
    `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages` +
    `?$top=100&$orderby=receivedDateTime%20desc&$select=${encodeURIComponent(select)}`;
  if (sinceIso) {
    url += `&$filter=${encodeURIComponent(`receivedDateTime ge ${sinceIso}`)}`;
  }

  const messages = [];
  let next = url;
  let pages = 0;
  while (next && pages < 5) {
    const response = await fetch(next, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Graph API error (${response.status}): ${body}`);
    }
    const data = await response.json();
    if (Array.isArray(data.value)) messages.push(...data.value);
    next = data["@odata.nextLink"] || null;
    pages++;
  }
  return messages;
}

function getInternetHeader(message, name) {
  const headers = message.internetMessageHeaders || [];
  const lower = name.toLowerCase();
  const found = headers.find((h) => (h.name || "").toLowerCase() === lower);
  return found ? found.value : "";
}

// Mirrors the IMAP match methods (In-Reply-To / References / "Re:" from recipient).
function graphMessageMatchesTracking(message, tracking) {
  const orig = tracking.originalMessageId;
  if (!orig) return null;

  const inReplyTo = getInternetHeader(message, "In-Reply-To");
  if (inReplyTo && inReplyTo.includes(orig)) return "in_reply_to";

  const references = getInternetHeader(message, "References");
  if (references && references.includes(orig)) return "references";

  const fromAddr = message.from?.emailAddress?.address?.toLowerCase() || "";
  const subj = (message.subject || "").toLowerCase();
  if (
    tracking.toEmail &&
    fromAddr === tracking.toEmail.toLowerCase() &&
    subj.startsWith("re:") &&
    references &&
    references.includes(orig)
  ) {
    return "subject";
  }
  return null;
}

// Auth helpers for SMTP and IMAP
async function getAuthForSMTP(smtpRecord, email) {
  if (smtpRecord.authType === "oauth2") {
    const accessToken = await getValidAccessToken(smtpRecord);
    return { type: "OAuth2", user: email, accessToken };
  }
  return { user: email, pass: decrypt(smtpRecord.pass) };
}

async function getAuthForIMAP(smtpRecord, email) {
  if (smtpRecord.authType === "oauth2") {
    const accessToken = await getValidAccessToken(smtpRecord);
    return { user: email, accessToken };
  }
  return { user: email, pass: decrypt(smtpRecord.pass) };
}

// SMTP host/port for provider
function getSMTPHostForProvider(smtpRecord) {
  if (smtpRecord.authType === "oauth2") {
    const domain = smtpRecord.email.split("@")[1]?.toLowerCase() || "";
    const isPersonal = MICROSOFT_PERSONAL_DOMAINS.some((d) =>
      domain.includes(d),
    );

    if (isPersonal) {
      return { host: "smtp-mail.outlook.com", port: 587, secure: false };
    } else {
      return { host: "smtp.office365.com", port: 587, secure: false };
    }
  }
  return {
    host: smtpRecord.host,
    port: smtpRecord.port,
    secure: smtpRecord.port === 465,
  };
}

// MongoDB Models
const smtpAuthSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    host: String,
    port: Number,
    pass: String,
    token: String,
    authType: {
      type: String,
      enum: ["password", "oauth2"],
      default: "password",
    },
    oauth2: {
      provider: String,
      accessToken: String,
      refreshToken: String,
      expiresAt: Date,
      scope: String,
    },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "email_smtp_auth" },
);

const SMTPAuth = mongoose.model("SMTPAuth", smtpAuthSchema);

const emailTrackingSchema = new mongoose.Schema(
  {
    messageId: { type: String, required: true, unique: true },
    originalMessageId: String,
    fromEmail: { type: String, required: true },
    toEmail: { type: String, required: true },
    subject: String,
    sentAt: { type: Date, default: Date.now },
    openedAt: Date,
    openedCount: { type: Number, default: 0 },
    lastOpenedIP: String,
    repliedAt: Date,
    webhookUrl: String,
    // Store email content for tracking data extraction
    emailContent: {
      html: String,
      text: String,
    },
    // Store tracking payload directly
    trackingPayload: {
      email: String,
      sender_user_id: String,
      object_type: String,
      object_id: String,
      contaction_id: String,
      page_id: String,
      list_id: String,
      action_block_id: String,
    },
    // Enhanced open tracking
    openEvents: [
      {
        openedAt: Date,
        ip: String,
        userAgent: String,
        sessionId: String, // To track unique sessions
        isMachineOpen: { type: Boolean, default: false },
      },
    ],
    // Replay open tracking (re-opens by the same session within the dedup window)
    replayCount: { type: Number, default: 0 },
    replayEvents: [
      {
        replayedAt: Date,
        ip: String,
        userAgent: String,
        sessionId: String,
        isMachineOpen: { type: Boolean, default: false },
      },
    ],
    clickEvents: [
      {
        url: String,
        clickedAt: Date,
        ip: String,
        userAgent: String,
      },
    ],
  },
  {
    collection: "email_tracking_v2",
    timestamps: true,
  },
);

const EmailTracking = mongoose.model("EmailTracking", emailTrackingSchema);

// MongoDB Connection
mongoose.connect(process.env.ONEPGR_MONGO_URI, {
  dbName: "onepgr_apps",
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// MX Cache for performance
const mxCache = new Map();

// Cached MX lookup function
async function cachedMxLookup(domain) {
  if (mxCache.has(domain)) {
    const cached = mxCache.get(domain);
    // Cache for 1 hour
    if (Date.now() - cached.timestamp < 3600000) {
      return cached.records;
    }
  }

  try {
    const records = await dns.resolveMx(domain);
    mxCache.set(domain, { records, timestamp: Date.now() });
    return records;
  } catch (error) {
    console.error(`MX lookup failed for ${domain}:`, error);
    throw error;
  }
}

// SMTP Settings Helper
// Import cPanel API helper
const { cpanelRequest } = require("../domainManagementAPI/cpanelApi.js");

async function getSMTPSettings(email, customHost, customPort) {
  const domain = email.split("@")[1].toLowerCase();

  // 1. Check for custom settings provided by caller first
  if (customHost) {
    return {
      host: customHost,
      port: parseInt(customPort) || 587,
    };
  }

  // 2. Check for known provider domains via detectProvider (Google, Microsoft)
  const provider = await detectProvider(email);
  if (provider === "google") {
    return { host: "smtp.gmail.com", port: 587 };
  }
  if (provider === "microsoft") {
    return { host: "smtp-mail.outlook.com", port: 587 };
  }

  // 3. Check for other static known provider domains
  const providerSettings = {
    "gmail.com": { host: "smtp.gmail.com", port: 587 },
    "googlemail.com": { host: "smtp.gmail.com", port: 587 },
    "outlook.com": { host: "smtp-mail.outlook.com", port: 587 },
    "hotmail.com": { host: "smtp-mail.outlook.com", port: 587 },
    "live.com": { host: "smtp-mail.outlook.com", port: 587 },
    "msn.com": { host: "smtp-mail.outlook.com", port: 587 },
    "yahoo.com": { host: "smtp.mail.yahoo.com", port: 587 },
    "ymail.com": { host: "smtp.mail.yahoo.com", port: 587 },
    "icloud.com": { host: "smtp.mail.me.com", port: 587 },
    "me.com": { host: "smtp.mail.me.com", port: 587 },
    "mac.com": { host: "smtp.mail.me.com", port: 587 },
    "protonmail.com": { host: "127.0.0.1", port: 1025 },
    "proton.me": { host: "127.0.0.1", port: 1025 },
    "zoho.com": { host: "smtp.zoho.com", port: 587 },
    "yandex.com": { host: "smtp.yandex.com", port: 587 },
    "fastmail.com": { host: "smtp.fastmail.com", port: 587 },
    "aol.com": { host: "smtp.aol.com", port: 587 },
  };

  if (providerSettings[domain]) return providerSettings[domain];

  // 4. DNS MX record lookup to detect real email server for custom domains
  try {
    const mxRecords = await cachedMxLookup(domain);
    const sorted = mxRecords.sort((a, b) => a.priority - b.priority);

    // Detect Zoho
    const isZoho = sorted.some((mx) => mx.exchange.includes("zoho"));
    if (isZoho) return { host: "smtp.zoho.com", port: 587 };

    // Detect GoDaddy
    const isGoDaddy = sorted.some((mx) =>
      mx.exchange.includes("secureserver.net"),
    );
    if (isGoDaddy) return { host: "smtpout.secureserver.net", port: 465 };

    // Detect Namecheap PrivateEmail
    const isPrivateEmail = sorted.some((mx) =>
      mx.exchange.includes("privateemail.com"),
    );
    if (isPrivateEmail) return { host: "mail.privateemail.com", port: 465 };

    // Detect Mailgun
    const isMailgun = sorted.some((mx) => mx.exchange.includes("mailgun"));
    if (isMailgun) return { host: "smtp.mailgun.org", port: 587 };

    // Detect SendGrid
    const isSendGrid = sorted.some((mx) => mx.exchange.includes("sendgrid"));
    if (isSendGrid) return { host: "smtp.sendgrid.net", port: 587 };

    // Detect Fastmail
    const isFastmail = sorted.some((mx) =>
      mx.exchange.includes("messagingengine.com"),
    );
    if (isFastmail) return { host: "smtp.fastmail.com", port: 587 };

    // Check if MX points strictly to internal cPanel server (WHM_HOST) or contains cPanel / WHM
    const rawWhmHost = process.env.WHM_HOST ? process.env.WHM_HOST.trim() : "";
    const whmHostDomain = rawWhmHost
      ? rawWhmHost
          .toLowerCase()
          .replace(/^https?:\/\//, "")
          .split(":")[0]
      : null;

    const isCPanelServer =
      Boolean(
        whmHostDomain &&
        (domain === whmHostDomain ||
          domain.endsWith("." + whmHostDomain) ||
          sorted.some((mx) =>
            mx.exchange.toLowerCase().includes(whmHostDomain),
          )),
      ) ||
      sorted.some(
        (mx) => mx.exchange.includes("cpanel") || mx.exchange.includes("whm"),
      );

    if (isCPanelServer) {
      try {
        console.log(
          `MX points to cPanel server. Attempting cPanel API lookup for domain: ${domain}`,
        );
        const cpanelResponse = await cpanelRequest(
          "Email/get_client_settings",
          {
            account: email,
          },
        );

        if (
          cpanelResponse &&
          cpanelResponse.status === 1 &&
          cpanelResponse.data &&
          cpanelResponse.data.smtp_host
        ) {
          const smtpData = cpanelResponse.data;
          return {
            host: smtpData.smtp_host,
            port: parseInt(smtpData.smtp_port) || 465,
          };
        }
      } catch (cpanelError) {
        console.log(`cPanel API failed for ${email}:`, cpanelError.message);
      }
      return { host: `mail.${domain}`, port: 465 };
    }

    // If top MX exchange host is custom like mail.domain.com or smtp.domain.com
    if (sorted[0] && sorted[0].exchange) {
      const topMx = sorted[0].exchange.toLowerCase().replace(/\.$/, "");
      if (topMx.startsWith("mail.") || topMx.startsWith("smtp.")) {
        return { host: topMx, port: 587 };
      }
    }

    // Default fallback for custom domain: mail.<domain>
    return { host: `mail.${domain}`, port: 587 };
  } catch (error) {
    console.log(`Could not resolve MX records for ${domain}:`, error.message);
    return { host: `mail.${domain}`, port: 587 };
  }
}

// Email Template Generator
// function generateEmailTemplate(templateName, data) {
//   const templates = {
//     default: {
//       html: `
//         <!DOCTYPE html>
//         <html>
//         <head>
//           <meta charset="utf-8">
//           <meta name="viewport" content="width=device-width, initial-scale=1.0">
//           <title>${data.subject || 'Professional Email'}</title>
//           <style>
//             body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
//             .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
//             .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
//             .content { padding: 40px 30px; }
//             .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 14px; }
//             .button { display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
//             .signature { border-top: 1px solid #eee; margin-top: 30px; padding-top: 20px; }
//           </style>
//         </head>
//         <body>
//           <div class="container">
//             <div class="header">
//               <h1>${data.subject || 'Professional Communication'}</h1>
//             </div>
//             <div class="content">
//               <p>${data.content || 'Thank you for your attention to this matter.'}</p>
//               ${data.callToAction ? `<a href="${data.callToAction.url}" class="button">${data.callToAction.text}</a>` : ''}
//               <div class="signature">
//                 <p><strong>Best regards,</strong><br>${data.senderName || 'Your Team'}</p>
//               </div>
//             </div>
//             <div class="footer">
//               <p>This email was sent from a professional email service.</p>
//             </div>
//           </div>
//         </body>
//         </html>
//       `,
//       text: `${data.subject || 'Professional Email'}\n\n${data.content || 'Thank you for your attention to this matter.'}\n\nBest regards,\n${data.senderName || 'Your Team'}`
//     }
//   };
//   return templates[templateName] || templates.default;
// }

// Webhook Notification Helper
async function sendWebhookNotification(webhookUrl, eventData) {
  if (!webhookUrl) return;
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventData),
    });

    if (response.ok) {
      console.log(
        `Webhook sent successfully to ${webhookUrl} - Status: ${response.status}`,
      );
      console.log(
        `Webhook Payload (${eventData.event || "unknown"}):`,
        JSON.stringify(eventData, null, 2),
      );
    } else {
      console.error(
        `Webhook failed to ${webhookUrl} - Status: ${response.status}`,
      );
      console.error(
        `Failed Payload (${eventData.event || "unknown"}):`,
        JSON.stringify(eventData, null, 2),
      );
    }
  } catch (error) {
    console.error(`❌ Webhook error to ${webhookUrl}: ${error.message}`);
  }
}

// HTML Subject Detection and Encoding Functions
function isHtmlContent(content) {
  if (!content || typeof content !== "string") return false;

  // Check for common HTML patterns
  const htmlPatterns = [
    /<[a-z][\s\S]*>/i, // HTML tags
    /&[a-zA-Z0-9#]+;/, // HTML entities
    /<br\s*\/?>/i, // Line breaks
    /<p\s*>/i, // Paragraphs
    /<div\s*>/i, // Divs
    /<span\s*>/i, // Spans
    /<b\s*>/i, // Bold
    /<i\s*>/i, // Italic
    /<strong\s*>/i, // Strong
    /<em\s*>/i, // Emphasis
    /style\s*=\s*["'][^"']*["']/i, // Style attributes
    /class\s*=\s*["'][^"']*["']/i, // Class attributes
  ];

  return htmlPatterns.some((pattern) => pattern.test(content));
}

function encodeSubjectForEmail(subject) {
  if (!subject || typeof subject !== "string") return "No Subject";

  const trimmedSubject = subject.trim();
  if (!trimmedSubject) return "No Subject";

  // If subject contains HTML, encode it properly for email headers
  if (isHtmlContent(trimmedSubject)) {
    // Use UTF-8 encoding for HTML content in subject
    return `=?UTF-8?B?${Buffer.from(trimmedSubject, "utf8").toString(
      "base64",
    )}?=`;
  }

  // For plain text, check if it needs encoding
  const needsEncoding = /[^\x00-\x7F]/.test(trimmedSubject);
  if (needsEncoding) {
    return `=?UTF-8?B?${Buffer.from(trimmedSubject, "utf8").toString(
      "base64",
    )}?=`;
  }

  // Plain ASCII text, use as-is
  return trimmedSubject;
}

// Log Email Event
async function logEmailEvent(eventType, trackingData) {
  try {
    console.log(`📧 Email Event: ${eventType}`, {
      trackingId: trackingData.trackingId,
      email: trackingData.email,
      from: trackingData.from,
      subject: trackingData.subject,
      timestamp: new Date(),
    });
    if (trackingData.webhookUrl) {
      await sendWebhookNotification(trackingData.webhookUrl, {
        event: eventType,
        ...trackingData,
      });
    }
  } catch (error) {
    console.error("Event logging error:", error);
  }
}

// 1️⃣ Setup Sender and generate API token
router.post("/api/senderemail/smtpauth", async (req, res) => {
  try {
    const { host, port, email, pass } = req.body;
    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: email",
      });
    }

    // Detect if this is a Microsoft account that needs OAuth
    const provider = await detectProvider(email);
    const oauthUrl = getMicrosoftOAuthUrl(email);

    if (provider === "microsoft" && !pass) {
      return res.json({
        success: false,
        requiresOAuth: true,
        provider: "microsoft",
        oauthUrl,
        message:
          "Microsoft accounts require OAuth authentication. Redirect the user to the oauthUrl to complete setup.",
      });
    }

    // For non-Microsoft or Microsoft with password (app password), require pass
    if (!pass) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: email, pass",
      });
    }

    const smtpSettings = await getSMTPSettings(email, host, port);
    const existingRecord = await SMTPAuth.findOne({ email });

    if (existingRecord) {
      return res.status(200).json({
        success: false,
        error: "Email already configured",
        message: `Email ${email} is already configured with token: ${existingRecord.token}`,
        isExistingToken: true,
        existingToken: existingRecord.token,
        createdAt: existingRecord.createdAt,
      });
    }

    const token = crypto.randomBytes(16).toString("hex");
    const encryptedPass = encrypt(pass);

    const result = await SMTPAuth.create({
      email,
      host: smtpSettings.host,
      port: smtpSettings.port,
      pass: encryptedPass,
      token,
    });

    // Determine detection method for better user feedback
    const domain = email.split("@")[1].toLowerCase();
    const knownProviders = [
      "gmail.com",
      "outlook.com",
      "hotmail.com",
      "yahoo.com",
      "icloud.com",
      "protonmail.com",
      "zoho.com",
      "yandex.com",
    ];
    const detectionMethod = knownProviders.includes(domain)
      ? "Known Provider"
      : smtpSettings.host.includes("mail.")
        ? "cPanel API"
        : "DNS MX Lookup";

    return res.json({
      success: true,
      token,
      smtpSettings,
      detectionMethod,
      provider,
      recommendedAuthMethod: provider === "microsoft" ? "oauth2" : "password",
      oauthUrl: provider === "microsoft" ? oauthUrl : null,
      warning:
        provider === "microsoft"
          ? "Microsoft accounts usually need OAuth2/Modern Auth. If inbox fetch fails with AUTHENTICATIONFAILED, reconnect this mailbox using the oauthUrl."
          : null,
      message: `New SMTP auth created for ${email} (${detectionMethod}). Use token: ${token} to send and retrieve emails`,
    });
  } catch (error) {
    console.error("SMTP Auth Error:", error);
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: "Email already exists",
      });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
});

// 🏥 Health Check - Verify SMTP & IMAP connectivity
router.post("/api/email/healthcheck", async (req, res) => {
  const { token, email } = req.body;

  if (!token || !email) {
    return res
      .status(400)
      .json({ success: false, error: "Missing token or email" });
  }

  const smtp = await SMTPAuth.findOne({ email, token });
  if (!smtp) {
    return res
      .status(403)
      .json({ success: false, error: "Invalid token or email" });
  }

  const results = { smtp: null, imap: null };

  // Test SMTP
  try {
    const smtpAuth = await getAuthForSMTP(smtp, email);
    const smtpHost = getSMTPHostForProvider(smtp);
    const transporter = nodemailer.createTransport({
      host: smtpHost.host,
      port: smtpHost.port,
      secure: smtpHost.secure,
      auth: smtpAuth,
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10000,
    });
    await transporter.verify();
    results.smtp = { success: true, host: smtpHost.host, port: smtpHost.port };
  } catch (err) {
    results.smtp = {
      success: false,
      host: smtp.host,
      port: smtp.port,
      error: err.message,
    };
  }

  // Test IMAP
  const imapHost = getImapHost(smtp.host, email, smtp.oauth2?.provider);
  try {
    const imapAuth = await getAuthForIMAP(smtp, email);
    const client = new ImapFlow({
      host: imapHost,
      port: 993,
      secure: true,
      auth: imapAuth,
      logger: false,
      timeout: 10000,
    });
    await client.connect();
    await client.logout();
    results.imap = { success: true, host: imapHost, port: 993 };
  } catch (err) {
    results.imap = {
      success: false,
      host: imapHost,
      port: 993,
      error: err.message,
    };

    if (
      smtp.authType !== "oauth2" &&
      isMicrosoftMailbox(smtp, email) &&
      isAuthenticationFailure(err)
    ) {
      Object.assign(results.imap, {
        provider: "microsoft",
        requiresOAuth: true,
        recommendedAuthMethod: "oauth2",
        oauthUrl: getMicrosoftOAuthUrl(email),
        details:
          "Microsoft rejected password-based IMAP authentication. Reconnect this mailbox with OAuth2/Modern Auth.",
      });
    }
  }

  const allHealthy = results.smtp.success && results.imap.success;

  return res.status(allHealthy ? 200 : 503).json({
    success: allHealthy,
    email,
    status: allHealthy ? "healthy" : "degraded",
    services: results,
    timestamp: new Date().toISOString(),
  });
});

// 2️⃣ Send Email
// router.post('/api/emailsend', async (req, res) => {
//   try {
//     const {
//       token,
//       from,
//       to,
//       cc,
//       bcc,
//       subject,
//       html,
//       text,
//       trackLinks,
//       sender_name,
//       trackingPayload,
//       attachments
//     } = req.body;

//     if (!token || !from || !to) {
//       return res.status(400).json({ success: false, error: 'Missing required fields: token, from, to' });
//     }

//     // Validate that user provided email content
//     if (!html && !text) {
//       return res.status(400).json({
//         success: false,
//         error: 'Email content is required. Please provide either html or text content.'
//       });
//     }

//     const smtp = await SMTPAuth.findOne({ email: from, token });
//     if (!smtp) {
//       return res.status(403).json({ success: false, error: 'Invalid token or sender email' });
//     }

//     const decryptedPass = decrypt(smtp.pass);
//     const transporter = nodemailer.createTransport({
//       host: smtp.host,
//       port: smtp.port,
//       secure: smtp.port === 465,
//       auth: { user: from, pass: decryptedPass },
//       tls: { rejectUnauthorized: false }
//     });

//     await transporter.verify();

//     const trackingId = crypto.randomBytes(16).toString('hex');
//     const baseUrl = process.env.BASE_URL || 'https://videoresponse.onepgr.com:3001';
//     const trackingPixelUrl = `${baseUrl}/api/track/open/${trackingId}`;

//     // Use exactly what user provided - no template processing
//     let emailHtml = html;
//     let emailText = text;

//     // Add tracking pixel only if HTML content exists
//     if (emailHtml) {
//       emailHtml += `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none;border:0;" alt=""/>\n`;
//     }

//     // Track links only if requested and HTML content exists
//     if (emailHtml && trackLinks) {
//       emailHtml = emailHtml.replace(/href=["'](.*?)["']/g, (match, url) => {
//         if (url.startsWith('http') && !url.includes(baseUrl)) {
//           const encodedUrl = encodeURIComponent(url);
//           return `href="${baseUrl}/api/track/click/${trackingId}?url=${encodedUrl}"`;
//         }
//         return match;
//       });
//     }

//     // Format from field with sender name if provided
//     const fromField = sender_name ? `${sender_name} <${from}>` : from;

//     // Encode subject properly for email headers (handles HTML content)
//     const encodedSubject = encodeSubjectForEmail(subject);

//     const emailOptions = {
//       from: fromField,
//       to,
//       subject: encodedSubject,
//       html: emailHtml,
//       text: emailText,
//       messageId: `<${trackingId}@${from.split('@')[1]}>`,
//       headers: {
//         'X-Tracking-ID': trackingId,
//         'References': `<${trackingId}@${from.split('@')[1]}>`
//       }
//     };

//     if (cc) emailOptions.cc = cc;
//     if (bcc) emailOptions.bcc = bcc;
//     if (attachments && Array.isArray(attachments) && attachments.length > 0) {
//       emailOptions.attachments = attachments;
//     }

//     const info = await transporter.sendMail(emailOptions);

//     // Set webhook URL for all events
//     const webhookUrl = 'https://meet.onepgr.com/session/smatpTracking';

//     const trackingRecord = new EmailTracking({
//       messageId: trackingId,
//       originalMessageId: info.messageId,
//       fromEmail: from,
//       toEmail: to,
//       subject,
//       webhookUrl: webhookUrl, // Always store webhook URL for all emails
//       emailContent: {
//         html: html,
//         text: text
//       },
//       trackingPayload: trackingPayload || null
//     });

//     await trackingRecord.save();

//     // Send immediate notification for all emails
//     await sendWebhookNotification(webhookUrl, {
//       event: 'sent',
//       trackingId,
//       email: to,
//       from,
//       subject: subject, // Use original subject for webhook
//       timestamp: new Date(),
//       messageId: info.messageId,
//       recipients: { to, cc: cc || null, bcc: bcc || null },
//       contentUsed: {
//         html: !!html,
//         text: !!text,
//         trackingEnabled: !!trackLinks,
//         attachmentsCount: attachments ? attachments.length : 0
//       },
//       trackingPayload: trackingPayload || null,
//       senderName: sender_name || null
//     });

//     return res.json({
//       success: true,
//       messageId: info.messageId,
//       trackingId,
//       recipients: { to, cc: cc || null, bcc: bcc || null },
//       contentUsed: {
//         html: !!html,
//         text: !!text,
//         trackingEnabled: !!trackLinks,
//         attachmentsCount: attachments ? attachments.length : 0
//       },
//       trackingPayload: trackingPayload || null,
//       senderName: sender_name || null
//     });
//   } catch (err) {
//     console.error('Email Send Error:', err);
//     return res.status(500).json({ success: false, error: err.message });
//   }
// });

router.post("/api/emailsend", async (req, res) => {
  try {
    const {
      token,
      from,
      to,
      cc,
      bcc,
      subject,
      html,
      text,
      trackLinks,
      sender_name,
      trackingPayload,
      attachments,
    } = req.body;

    console.log(`✉️ [API Triggered] POST /api/emailsend`, {
      from,
      to,
      cc: cc || null,
      bcc: bcc || null,
      subject,
      hasHtml: !!html,
      hasText: !!text,
      trackLinks: !!trackLinks,
      senderName: sender_name || null,
      attachmentsCount: attachments ? attachments.length : 0,
      trackingPayload: trackingPayload || null,
      timestamp: new Date().toISOString(),
    });

    if (!token || !from || !to) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: token, from, to",
      });
    }

    // Validate that user provided email content
    if (!html && !text) {
      return res.status(400).json({
        success: false,
        error:
          "Email content is required. Please provide either html or text content.",
      });
    }

    const smtp = await SMTPAuth.findOne({ email: from, token });
    if (!smtp) {
      return res
        .status(403)
        .json({ success: false, error: "Invalid token or sender email" });
    }

    // Check if this is a Microsoft OAuth2 account - use Graph API for sending
    if (smtp.authType === "oauth2" && smtp.oauth2?.provider === "microsoft") {
      try {
        // Generate the tracking id BEFORE sending so the open pixel, click
        // tracking, and Message-ID can all be embedded in the outgoing mail.
        const trackingId = crypto.randomBytes(16).toString("hex");
        const messageId = `<${trackingId}@${from.split("@")[1]}>`;
        const trackedHtml = applyEmailTracking(html, trackLinks, trackingId);

        const result = await sendViaMicrosoftGraph(
          smtp,
          from,
          to,
          cc,
          bcc,
          subject,
          trackedHtml,
          text,
          attachments,
          messageId,
        );

        const webhookUrl = "https://meet.onepgr.com/session/smatpTracking";

        // Save tracking and send webhook asynchronously
        Promise.all([
          EmailTracking.create({
            messageId: trackingId,
            originalMessageId: messageId,
            fromEmail: from,
            toEmail: Array.isArray(to) ? to[0] : to,
            subject,
            webhookUrl,
            emailContent: { html, text },
            trackingPayload: trackingPayload || null,
          }),
          sendWebhookNotification(webhookUrl, {
            event: "sent",
            trackingId,
            email: Array.isArray(to) ? to[0] : to,
            from,
            subject,
            timestamp: new Date(),
            messageId,
            recipients: { to, cc: cc || null, bcc: bcc || null },
            contentUsed: {
              html: !!html,
              text: !!text,
              trackingEnabled: !!trackLinks,
              attachmentsCount: attachments ? attachments.length : 0,
            },
            trackingPayload: trackingPayload || null,
            senderName: sender_name || null,
          }),
        ]).catch((err) => console.error("Tracking background error:", err));

        return res.json({
          success: true,
          messageId,
          trackingId,
          recipients: { to, cc: cc || null, bcc: bcc || null },
          contentUsed: {
            html: !!html,
            text: !!text,
            trackingEnabled: !!trackLinks,
            attachmentsCount: attachments ? attachments.length : 0,
          },
          trackingPayload: trackingPayload || null,
          senderName: sender_name || null,
          method: "microsoft-graph",
          message: "Email sent via Microsoft Graph API",
        });
      } catch (graphError) {
        console.error(
          `❌ Graph API Send Error (To: ${to}, From: ${from}):`,
          graphError,
        );
        return res
          .status(500)
          .json({ success: false, error: graphError.message });
      }
    }

    const smtpAuth = await getAuthForSMTP(smtp, from);
    const smtpHost = getSMTPHostForProvider(smtp);
    const transporter = nodemailer.createTransport({
      host: smtpHost.host,
      port: smtpHost.port,
      secure: smtpHost.secure,
      auth: smtpAuth,
      tls: { rejectUnauthorized: false },
    });

    await transporter.verify();

    const trackingId = crypto.randomBytes(16).toString("hex");
    const baseUrl = (
      process.env.BASE_URL || "https://videoresponse.onepgr.com:3001"
    ).replace(/\/api\/?$/, "");
    const trackingPixelUrl = `${baseUrl}/api/track/open/${trackingId}`;

    // Use exactly what user provided - no template processing
    let emailHtml = html;
    let emailText = text;

    // Add tracking pixel only if HTML content exists AND link tracking is enabled
    if (emailHtml && trackLinks) {
      const pixelTag = `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none;border:0;" alt=""/>`;
      if (emailHtml.includes("</body>")) {
        emailHtml = emailHtml.replace("</body>", `${pixelTag}</body>`);
        console.log(
          `🔍 Tracking pixel injected inside </body>: ${trackingPixelUrl}`,
        );
      } else if (emailHtml.includes("</html>")) {
        emailHtml = emailHtml.replace("</html>", `${pixelTag}</html>`);
        console.log(
          `🔍 Tracking pixel injected inside </html>: ${trackingPixelUrl}`,
        );
      } else {
        emailHtml += pixelTag;
        console.log(
          `🔍 Tracking pixel appended (no closing tags): ${trackingPixelUrl}`,
        );
      }
    }

    // Track links only if requested and HTML content exists
    // Track links only if requested and HTML content exists
    // Skip tracking for links with data-no-track or data-media-link attributes
    if (emailHtml && trackLinks) {
      // Use a more sophisticated regex that captures the full <a> tag
      emailHtml = emailHtml.replace(
        /<a\s+([^>]*)href=["']([^"']+)["']([^>]*)>(.*?)<\/a>/gi,
        (match, beforeHref, url, afterHref, content) => {
          const fullAttributes = beforeHref + 'href="' + url + '"' + afterHref;

          // Check if this link should NOT be tracked
          const shouldSkipTracking =
            fullAttributes.includes('data-no-track="true"') ||
            fullAttributes.includes("data-no-track='true'") ||
            fullAttributes.includes('data-media-link="true"') ||
            fullAttributes.includes("data-media-link='true'");

          // If it's a media link or marked as no-track, keep the direct URL
          if (shouldSkipTracking) {
            return match; // Return original link unchanged
          }

          // Otherwise, wrap with tracking URL
          if (url.startsWith("http") && !url.includes(baseUrl)) {
            const encodedUrl = encodeURIComponent(url);
            return `<a ${beforeHref}href="${baseUrl}/api/track/click/${trackingId}?url=${encodedUrl}"${afterHref}>${content}</a>`;
          }

          return match;
        },
      );
    }

    // Format from field with sender name if provided
    const fromField = sender_name ? `${sender_name} <${from}>` : from;

    // Encode subject properly for email headers (handles HTML content)
    const encodedSubject = encodeSubjectForEmail(subject);

    const emailOptions = {
      from: fromField,
      to,
      subject: encodedSubject,
      html: emailHtml,
      text: emailText,
      messageId: `<${trackingId}@${from.split("@")[1]}>`,
      headers: {
        "X-Tracking-ID": trackingId,
        References: `<${trackingId}@${from.split("@")[1]}>`,
      },
    };

    if (cc) emailOptions.cc = cc;
    if (bcc) emailOptions.bcc = bcc;
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      emailOptions.attachments = attachments;
    }

    const info = await transporter.sendMail(emailOptions);

    // Set webhook URL for all events
    const webhookUrl = "https://meet.onepgr.com/session/smatpTracking";

    const trackingRecord = new EmailTracking({
      messageId: trackingId,
      originalMessageId:
        info.messageId || `<${trackingId}@${from.split("@")[1]}>`,
      fromEmail: from,
      toEmail: to,
      subject,
      webhookUrl: webhookUrl, // Always store webhook URL for all emails
      emailContent: {
        html: html,
        text: text,
      },
      trackingPayload: trackingPayload || null,
    });

    await trackingRecord.save();

    // Send immediate notification for all emails
    await sendWebhookNotification(webhookUrl, {
      event: "sent",
      trackingId,
      email: to,
      from,
      subject: subject, // Use original subject for webhook
      timestamp: new Date(),
      messageId: info.messageId,
      recipients: { to, cc: cc || null, bcc: bcc || null },
      contentUsed: {
        html: !!html,
        text: !!text,
        trackingEnabled: !!trackLinks,
        attachmentsCount: attachments ? attachments.length : 0,
      },
      trackingPayload: trackingPayload || null,
      senderName: sender_name || null,
    });

    return res.json({
      success: true,
      messageId: info.messageId,
      trackingId,
      recipients: { to, cc: cc || null, bcc: bcc || null },
      contentUsed: {
        html: !!html,
        text: !!text,
        trackingEnabled: !!trackLinks,
        attachmentsCount: attachments ? attachments.length : 0,
      },
      trackingPayload: trackingPayload || null,
      senderName: sender_name || null,
    });
  } catch (err) {
    console.error(`❌ Email Send Error (To: ${to}, From: ${from}):`, err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

//  Forward Email
// Fixed Email Forward API - Gmail-style forwarding
router.post("/api/emailforward", async (req, res) => {
  let imapClient;

  try {
    const {
      token,
      from,
      to,
      cc,
      bcc,
      originalMessageId, // Message-ID of the email to forward
      forwardMessage = "", // Brief message to add at top (max 1000 chars)
      sender_name,
      includeAttachments = true,
      addForwardPrefix = true,
    } = req.body;

    console.log("📧 Forward API called:", { from, to, originalMessageId });

    // Limit forwardMessage to prevent payload issues (1000 chars max)
    const safeForwardMessage = forwardMessage
      ? forwardMessage.substring(0, 1000)
      : "";

    // Validation
    if (!token || !from || !to || !originalMessageId) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: token, from, to, originalMessageId",
      });
    }

    // Get SMTP auth
    const smtp = await SMTPAuth.findOne({ email: from, token });
    if (!smtp) {
      return res.status(403).json({
        success: false,
        error: "Invalid token or sender email",
      });
    }

    const imapAuth = await getAuthForIMAP(smtp, from);

    // Step 1: Connect to IMAP and fetch the original email
    console.log("🔌 Connecting to IMAP to fetch original email...");

    imapClient = new ImapFlow({
      host: getImapHost(smtp.host, from, smtp.oauth2?.provider),
      port: 993,
      secure: true,
      auth: imapAuth,
      logger: false,
      timeout: 60000, // 60 seconds for large emails
    });

    await imapClient.connect();
    console.log("✅ IMAP connected");

    // Try common mailbox locations
    const mailboxes = [
      "INBOX",
      "Sent",
      "[Gmail]/Sent Mail",
      "Sent Items",
      "Sent Messages",
    ];
    let originalEmail = null;
    let foundMailbox = null;

    for (const mailbox of mailboxes) {
      try {
        await imapClient.mailboxOpen(mailbox);
        console.log(
          `📂 Searching in ${mailbox} for Message-ID: ${originalMessageId}`,
        );

        const messageUids = await imapClient.search({
          header: { "Message-ID": originalMessageId },
        });

        if (messageUids && messageUids.length > 0) {
          console.log(`✅ Found message in ${mailbox}, UID: ${messageUids[0]}`);
          foundMailbox = mailbox;

          // Fetch only the first matching message
          const fetchMessages = imapClient.fetch(messageUids.slice(0, 1), {
            byUid: true,
            envelope: true,
            uid: true,
            flags: true,
            source: true,
            bodyStructure: true,
          });

          // Get first message and break immediately
          for await (let msg of fetchMessages) {
            console.log("📧 Parsing fetched message...");
            const parsed = await simpleParser(msg.source);

            originalEmail = {
              envelope: msg.envelope,
              parsed: parsed,
              uid: msg.uid,
              flags: msg.flags,
            };

            console.log("✅ Original email parsed successfully");
            break; // Critical: exit loop immediately
          }

          console.log("✅ Message retrieved, breaking from mailbox search");
          break; // Exit mailbox search loop
        }
      } catch (err) {
        console.log(`⚠️ Mailbox ${mailbox} not accessible: ${err.message}`);
        continue;
      }
    }

    // Close IMAP connection in background - don't wait
    console.log("🔒 Closing IMAP connection in background...");
    const closeImapPromise = (async () => {
      try {
        await Promise.race([
          imapClient.logout(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Logout timeout")), 5000),
          ),
        ]);
        console.log("✅ IMAP connection closed gracefully");
      } catch (logoutErr) {
        console.log("⚠️ IMAP logout failed/timeout, forcing close");
        try {
          await imapClient.close();
          console.log("✅ IMAP connection force-closed");
        } catch (closeErr) {
          console.log("⚠️ IMAP force-close failed, destroying connection");
          try {
            imapClient.connection?.destroy();
          } catch (e) {}
        }
      }
    })();

    imapClient = null; // Unset reference immediately

    if (!originalEmail) {
      return res.status(404).json({
        success: false,
        error: "Original email not found in any mailbox",
      });
    }

    console.log(
      "📝 Building forwarded email content (IMAP closing in background)...",
    );

    // Step 2: Build the forwarded email (Gmail-style)
    const original = originalEmail.parsed;
    const envelope = originalEmail.envelope;

    // Prepare subject with "Fwd:" prefix
    let forwardSubject = envelope.subject || "(No Subject)";
    if (addForwardPrefix && !forwardSubject.toLowerCase().startsWith("fwd:")) {
      forwardSubject = `Fwd: ${forwardSubject}`;
    }

    // Build forwarded email header info
    const forwardedFrom = envelope.from
      ? envelope.from.map((f) => `${f.name || ""} <${f.address}>`).join(", ")
      : "Unknown";

    const forwardedTo = envelope.to
      ? envelope.to.map((t) => `${t.name || ""} <${t.address}>`).join(", ")
      : "";

    const forwardedDate = envelope.date
      ? new Date(envelope.date).toLocaleString("en-US", {
          weekday: "short",
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
        })
      : "";

    const forwardedCc = envelope.cc
      ? envelope.cc.map((c) => `${c.name || ""} <${c.address}>`).join(", ")
      : "";

    // Build HTML content (Gmail-style)
    const forwardedHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: Arial, sans-serif;
            font-size: 14px;
            line-height: 1.6;
            color: #333;
          }
          .gmail-quote {
            margin: 0 0 0 0.8ex;
            border-left: 1px solid #ccc;
            padding-left: 1ex;
          }
          .gmail-attr {
            color: #666;
            font-size: 12px;
            margin: 20px 0 10px 0;
          }
          .forward-message {
            margin-bottom: 20px;
            padding: 10px;
            background-color: #f9f9f9;
            border-left: 3px solid #4285f4;
          }
        </style>
      </head>
      <body>
        ${
          safeForwardMessage
            ? `<div class="forward-message">${safeForwardMessage.replace(
                /\n/g,
                "<br>",
              )}</div>`
            : ""
        }
        
        <div class="gmail-attr">
          ---------- Forwarded message ---------<br>
          From: <strong>${forwardedFrom}</strong><br>
          Date: ${forwardedDate}<br>
          Subject: ${envelope.subject || "(No Subject)"}<br>
          To: ${forwardedTo}${forwardedCc ? `<br>Cc: ${forwardedCc}` : ""}
        </div>
        
        <div class="gmail-quote">
          ${
            original.html ||
            original.textAsHtml ||
            `<pre>${original.text || ""}</pre>`
          }
        </div>
      </body>
      </html>
    `;

    // Build plain text content
    const forwardedText = `
${safeForwardMessage ? `${safeForwardMessage}\n\n` : ""}
---------- Forwarded message ---------
From: ${forwardedFrom}
Date: ${forwardedDate}
Subject: ${envelope.subject || "(No Subject)"}
To: ${forwardedTo}${forwardedCc ? `\nCc: ${forwardedCc}` : ""}

${original.text || "No text content"}
    `.trim();

    // Step 3: Prepare attachments
    let forwardedAttachments = [];
    if (
      includeAttachments &&
      original.attachments &&
      original.attachments.length > 0
    ) {
      console.log(
        `📎 Processing ${original.attachments.length} attachments...`,
      );

      // Limit to 10 attachments or 25MB total to prevent timeouts
      let totalSize = 0;
      const maxTotalSize = 25 * 1024 * 1024; // 25MB
      const maxAttachments = 10;

      for (const att of original.attachments.slice(0, maxAttachments)) {
        const attSize = att.content ? att.content.length : 0;
        if (totalSize + attSize > maxTotalSize) {
          console.log(
            `⚠️ Attachment size limit reached, skipping remaining attachments`,
          );
          break;
        }

        forwardedAttachments.push({
          filename: att.filename || "attachment",
          content: att.content,
          contentType: att.contentType || "application/octet-stream",
          encoding: "base64",
        });

        totalSize += attSize;
      }

      console.log(
        `✅ Prepared ${forwardedAttachments.length} attachments (${(
          totalSize /
          1024 /
          1024
        ).toFixed(2)} MB)`,
      );
    }

    // Step 4: Send the forwarded email via SMTP
    console.log("📤 Sending forwarded email via SMTP...");

    const smtpAuth = await getAuthForSMTP(smtp, from);
    const smtpHost = getSMTPHostForProvider(smtp);
    const transporter = nodemailer.createTransport({
      host: smtpHost.host,
      port: smtpHost.port,
      secure: smtpHost.secure,
      auth: smtpAuth,
      tls: { rejectUnauthorized: false },
    });

    // Verify SMTP connection
    await transporter.verify();
    console.log("✅ SMTP connection verified");

    // Generate tracking ID for the forwarded email
    const trackingId = crypto.randomBytes(16).toString("hex");
    const fromField = sender_name ? `${sender_name} <${from}>` : from;

    const emailOptions = {
      from: fromField,
      to: to,
      subject: forwardSubject,
      html: forwardedHtml,
      text: forwardedText,
      messageId: `<fwd-${trackingId}@${from.split("@")[1]}>`,
      headers: {
        "X-Forwarded-Message-ID": originalMessageId,
        "X-Forwarded-By": from,
        References: originalMessageId,
        "In-Reply-To": originalMessageId,
      },
    };

    // Add optional fields only if provided
    if (cc) emailOptions.cc = cc;
    if (bcc) emailOptions.bcc = bcc;
    if (forwardedAttachments.length > 0) {
      emailOptions.attachments = forwardedAttachments;
    }

    console.log("📤 Sending email via SMTP...");
    const info = await transporter.sendMail(emailOptions);
    console.log(`✅ Forwarded email sent successfully: ${info.messageId}`);

    // Step 5: Save tracking record (async, don't wait)
    const webhookUrl = "https://meet.onepgr.com/session/smatpTracking";

    // Don't await these - send response immediately
    Promise.all([
      EmailTracking.create({
        messageId: trackingId,
        originalMessageId: info.messageId,
        fromEmail: from,
        toEmail: to,
        subject: forwardSubject,
        webhookUrl: webhookUrl,
        emailContent: {
          html: forwardedHtml,
          text: forwardedText,
        },
      }),
      sendWebhookNotification(webhookUrl, {
        event: "forwarded",
        trackingId,
        email: to,
        from,
        subject: forwardSubject,
        timestamp: new Date(),
        messageId: info.messageId,
        originalMessageId: originalMessageId,
        recipients: { to, cc: cc || null, bcc: bcc || null },
        attachmentsCount: forwardedAttachments.length,
        senderName: sender_name || null,
      }),
    ]).catch((err) => console.error("Background task error:", err));

    console.log("✅ Sending response to client...");

    // Send response immediately
    return res.json({
      success: true,
      message: "Email forwarded successfully",
      messageId: info.messageId,
      trackingId,
      forwardedFrom: originalMessageId,
      forwardedTo: to,
      subject: forwardSubject,
      attachmentsCount: forwardedAttachments.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ Email Forward Error:", err);

    // Cleanup IMAP connection if still open
    if (imapClient) {
      console.log("🔒 Force closing IMAP on error...");
      try {
        // Force close immediately on error - don't wait
        imapClient.close().catch(() => {});
        imapClient.connection?.destroy();
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    return res.status(500).json({
      success: false,
      error: err.message,
      details:
        "Failed to forward email. Please check the original message ID and try again.",
    });
  }
});

// 3️⃣ Inbox Fetch with Read/Unread
router.post("/api/fetchinbox", async (req, res) => {
  const { token, email, page = 1, limit = 20 } = req.body;
  let smtp;
  let client;
  try {
    if (!token || !email) {
      return res
        .status(400)
        .json({ success: false, error: "Missing token or email" });
    }

    smtp = await SMTPAuth.findOne({ email, token });
    if (!smtp) {
      return res
        .status(403)
        .json({ success: false, error: "Invalid token or sender email" });
    }

    // Check if this is a Microsoft OAuth2 account - use Graph API for fetching
    if (smtp.authType === "oauth2" && smtp.oauth2?.provider === "microsoft") {
      try {
        const accessToken = await getValidAccessToken(smtp);
        const limitInt = parseInt(limit) || 20;
        const pageInt = parseInt(page) || 1;
        const skip = (pageInt - 1) * limitInt;

        const messages = await fetchInboxViaGraph(
          accessToken,
          "inbox",
          limitInt,
          skip,
        );

        return res.json({
          success: true,
          inbox: messages,
          pagination: {
            currentPage: pageInt,
            limit: limitInt,
            totalMessages: messages.length,
            hasNextPage: messages.length === limitInt, // Basic heuristic
          },
        });
      } catch (err) {
        console.error("Graph Inbox Fetch Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    const imapAuth = await getAuthForIMAP(smtp, email);

    client = new ImapFlow({
      host: getImapHost(smtp.host, email, smtp.oauth2?.provider),
      port: 993,
      secure: true,
      auth: imapAuth,
      logger: false,
    });

    console.log(
      `IMAP CONNECT: email=${email}, host=${getImapHost(smtp.host, email, smtp.oauth2?.provider)}, smtp.host=${smtp.host}, provider=${smtp.oauth2?.provider}`,
    );

    await client.connect();
    const lock = await client.mailboxOpen("INBOX");
    const totalMessages = lock.exists;

    // Calculate pagination
    const maxLimit = Math.min(limit, 50); // Max 50 per page
    const currentPage = Math.max(parseInt(page), 1);
    const totalPages = Math.ceil(totalMessages / maxLimit);

    // Calculate message range (IMAP uses 1-based indexing, newest first)
    const startSeq = Math.max(totalMessages - currentPage * maxLimit + 1, 1);
    const endSeq = Math.max(totalMessages - (currentPage - 1) * maxLimit, 1);

    console.log(
      `Fetching messages ${startSeq}:${endSeq} (Page ${currentPage}, Limit ${maxLimit})`,
    );

    const messages = [];

    if (startSeq <= endSeq) {
      for await (let msg of client.fetch(`${startSeq}:${endSeq}`, {
        envelope: true,
        uid: true,
        flags: true,
        source: true,
        bodyStructure: true,
      })) {
        const parsed = await simpleParser(msg.source);

        // Clean HTML content
        let cleanHtml = parsed.html || "";
        if (cleanHtml) {
          cleanHtml = cleanHtml.replace(
            /https:\/\/tracking\.inflection\.io\/[^"']+/g,
            (url) => {
              try {
                const urlObj = new URL(url);
                const redirect = urlObj.searchParams.get("redirect");
                return redirect || url;
              } catch {
                return url;
              }
            },
          );

          cleanHtml = cleanHtml.replace(
            /<span[^>]*id="inflection-email-preheader"[^>]*>.*?<\/span>/gis,
            "",
          );
        }

        // Extract clean text
        let cleanText = parsed.text || "";
        if (cleanText) {
          cleanText = cleanText.replace(
            /https:\/\/tracking\.inflection\.io\/[^\s]+/g,
            "",
          );
        }

        // FIXED: Properly handle attachments
        // Method 1: Check parsed.attachments array
        let attachments = [];
        if (parsed.attachments && Array.isArray(parsed.attachments)) {
          const baseUrl = (
            process.env.BASE_URL || "https://videoresponse.onepgr.com:3001"
          ).replace(/\/api\/?$/, "");
          attachments = parsed.attachments.map((att) => ({
            filename: att.filename || "unnamed_attachment",
            contentType: att.contentType || "application/octet-stream",
            size: att.size || 0,
            contentId: att.contentId || null,
            // Generate unique identifier for the attachment
            attachmentId: `${msg.uid}-${att.filename || Date.now()}`,
            // URL to download the attachment
            url: `${baseUrl}/api/email/attachment?email=${encodeURIComponent(
              email,
            )}&token=${encodeURIComponent(token)}&uid=${
              msg.uid
            }&messageId=${encodeURIComponent(
              msg.envelope.messageId,
            )}&filename=${encodeURIComponent(
              att.filename || "unnamed_attachment",
            )}&checksum=${encodeURIComponent(att.checksum || "")}`,
          }));
        }
        // Method 2: Alternative - check for attachments in email structure
        else if (msg.bodyStructure && msg.bodyStructure.childNodes) {
          // You may need to recursively traverse the body structure
          attachments = extractAttachmentsFromStructure(
            msg.bodyStructure,
            msg.uid,
            email,
            token,
          );
        }

        // Method 3: Debug - log what we received
        console.log(
          `Message ${msg.uid}: attachments found:`,
          parsed.attachments ? parsed.attachments.length : 0,
        );
        if (parsed.attachments && parsed.attachments.length > 0) {
          console.log(
            "Attachment details:",
            parsed.attachments.map((a) => ({
              filename: a.filename,
              contentType: a.contentType,
              size: a.size,
            })),
          );
        }

        messages.push({
          subject: msg.envelope.subject,
          from: msg.envelope.from
            .map((f) => `${f.name || ""} <${f.address}>`)
            .join(", "),
          date: msg.envelope.date,
          uid: msg.uid,
          seq: msg.seq,
          read: Array.isArray(msg.flags) ? msg.flags.includes("\\Seen") : false,
          text: cleanText,
          html: cleanHtml,
          to: msg.envelope.to
            ?.map((t) => `${t.name || ""} <${t.address}>`)
            .join(", "),
          cc: msg.envelope.cc
            ?.map((c) => `${c.name || ""} <${c.address}>`)
            .join(", "),
          messageId: msg.envelope.messageId,
          attachments: attachments,
          hasAttachments: attachments.length > 0,
        });
      }
    }

    await client.logout();

    // Reverse to show newest first in the array
    const sortedMessages = messages.reverse();

    return res.json({
      success: true,
      inbox: sortedMessages,
      pagination: {
        currentPage,
        totalPages,
        totalMessages,
        limit: maxLimit,
        hasNextPage: currentPage < totalPages,
        hasPrevPage: currentPage > 1,
      },
    });
  } catch (err) {
    console.error("Inbox Fetch Error:", err);

    if (client) {
      await client.logout().catch(() => {});
    }

    if (
      smtp &&
      smtp.authType !== "oauth2" &&
      isMicrosoftMailbox(smtp, email) &&
      isAuthenticationFailure(err)
    ) {
      return res
        .status(401)
        .json(
          buildMicrosoftOAuthRequiredResponse(email, err, "fetch inbox mail"),
        );
    }

    return res.status(500).json({ success: false, error: err.message });
  }
});

// Helper function to extract attachments from body structure
function extractAttachmentsFromStructure(structure, uid, email, token) {
  const attachments = [];
  const baseUrl = (
    process.env.BASE_URL || "https://videoresponse.onepgr.com:3001"
  ).replace(/\/api\/?$/, "");

  function traverse(node, path = "") {
    if (!node) return;

    // Check if this is an attachment
    if (
      node.disposition &&
      node.disposition.type &&
      (node.disposition.type.toLowerCase() === "attachment" ||
        (node.disposition.type.toLowerCase() === "inline" && node.filename))
    ) {
      attachments.push({
        filename: node.filename || node.name || "unnamed_attachment",
        contentType: node.type || "application/octet-stream",
        size: node.size || 0,
        contentId: node.contentId || null,
        attachmentId: `${uid}-${node.filename || Date.now()}`,
        url: `${baseUrl}/api/email/attachment?email=${encodeURIComponent(
          email,
        )}&token=${encodeURIComponent(token)}&uid=${uid}&part=${path}`,
      });
    }

    // Recursively check child nodes
    if (node.childNodes && Array.isArray(node.childNodes)) {
      node.childNodes.forEach((child, index) => {
        traverse(child, path ? `${path}.${index + 1}` : `${index + 1}`);
      });
    }
  }

  traverse(structure);
  return attachments;
}

// 9️⃣ Fetch Specific Email by Message ID
router.get("/api/email/attachment", async (req, res) => {
  try {
    const { email, token, uid, filename } = req.query;

    if (!email || !token || !uid || !filename) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required parameters" });
    }

    // Verify token
    const smtp = await SMTPAuth.findOne({ email, token });
    if (!smtp) {
      return res
        .status(403)
        .json({ success: false, error: "Invalid token or email" });
    }

    const imapAuth = await getAuthForIMAP(smtp, email);

    const client = new ImapFlow({
      host: getImapHost(smtp.host, email, smtp.oauth2?.provider),
      port: 993,
      secure: true,
      auth: imapAuth,
      logger: false,
    });

    await client.connect();
    await client.mailboxOpen("INBOX");

    // Fetch message by UID directly (more efficient)
    console.log(`[Attachment] Fetching UID: ${uid}`);

    let sequenceNumber = null;

    // 1. Try to find sequence number by UID
    const searchResult = await client.search({ uid: uid });
    console.log(`[Attachment] Search for UID ${uid} returned:`, searchResult);

    if (searchResult && searchResult.length > 0) {
      sequenceNumber = searchResult[0];
      console.log(
        `[Attachment] Found sequence number via UID: ${sequenceNumber}`,
      );
    }

    // 2. Fallback: Try Message-ID if UID search failed
    const messageId = req.query.messageId;
    if (!sequenceNumber && messageId) {
      console.log(
        `[Attachment] UID search failed, falling back to Message-ID: ${messageId}`,
      );
      const messageUids = await client.search({
        header: { "Message-ID": messageId },
      });

      if (messageUids && messageUids.length > 0) {
        sequenceNumber = messageUids[0];
        console.log(
          `[Attachment] Found sequence number via Message-ID: ${sequenceNumber}`,
        );
      } else {
        console.log(`[Attachment] Message-ID search also failed`);
      }
    }

    if (!sequenceNumber) {
      await client.logout();
      return res
        .status(404)
        .json({ success: false, error: "Message not found" });
    }

    // Fetch by sequence number (no uid: true option)
    console.log(`[Attachment] Fetching sequence number: ${sequenceNumber}`);
    const fetchResult = client.fetch(String(sequenceNumber), {
      source: true,
    });

    let foundAttachment = null;
    let messageCount = 0;

    for await (let msg of fetchResult) {
      messageCount++;
      console.log(`[Attachment] Processing message UID: ${msg.uid}`);
      const parsed = await simpleParser(msg.source);

      console.log(`[Attachment] Parsed subject: ${parsed.subject}`);
      console.log(
        `[Attachment] Parsed attachments count: ${
          parsed.attachments ? parsed.attachments.length : 0
        }`,
      );

      if (parsed.attachments) {
        parsed.attachments.forEach((a, i) => {
          console.log(
            `[Attachment] #${i}: filename="${a.filename}", checksum="${a.checksum}", contentId="${a.contentId}", size=${a.size}`,
          );
        });
      }

      if (parsed.attachments && Array.isArray(parsed.attachments)) {
        const decodedFilename = decodeURIComponent(filename);
        console.log(`[Attachment] Looking for filename: ${decodedFilename}`);
        console.log(
          `[Attachment] Available attachments:`,
          parsed.attachments.map((a) => a.filename),
        );

        // 1. Try to match by checksum if provided
        const checksum = req.query.checksum;
        if (checksum) {
          foundAttachment = parsed.attachments.find(
            (att) => att.checksum === checksum,
          );
          if (foundAttachment) console.log(`[Attachment] Matched by checksum`);
        }

        // 2. Try to match by filename
        if (!foundAttachment) {
          foundAttachment = parsed.attachments.find(
            (att) =>
              att.filename === decodedFilename || att.filename === filename,
          );
          if (foundAttachment) console.log(`[Attachment] Matched by filename`);
        }

        // 3. Try to match by contentId
        if (!foundAttachment) {
          const contentId = req.query.contentId;
          if (contentId) {
            foundAttachment = parsed.attachments.find(
              (att) =>
                att.contentId === contentId ||
                (att.contentId &&
                  att.contentId.includes(contentId.replace(/[<>]/g, ""))),
            );
            if (foundAttachment)
              console.log(`[Attachment] Matched by contentId`);
          }
        }

        if (foundAttachment) {
          console.log(
            `[Attachment] Found attachment: ${foundAttachment.filename}, Size: ${foundAttachment.size}`,
          );

          // Send response immediately
          res.setHeader(
            "Content-Type",
            foundAttachment.contentType || "application/octet-stream",
          );
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${encodeURIComponent(
              foundAttachment.filename,
            )}"`,
          );
          res.setHeader("Content-Length", foundAttachment.size);

          if (foundAttachment.content) {
            res.send(foundAttachment.content);
            console.log(`[Attachment] Response sent successfully`);
          } else {
            res
              .status(500)
              .json({ success: false, error: "Attachment content is empty" });
          }

          // Logout after sending response (don't await strictly if it blocks)
          try {
            await client.logout();
          } catch (e) {
            console.error("Logout error:", e);
          }
          return;
        }
        break;
      } else {
        console.log(`[Attachment] No attachments found in parsed message`);
      }
    }

    console.log(`[Attachment] Total messages processed: ${messageCount}`);

    await client.logout();

    // If we get here, attachment was not found
    return res
      .status(404)
      .json({ success: false, error: "Attachment not found" });
  } catch (err) {
    console.error("Attachment Fetch Error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 9️⃣ Fetch Specific Email by Message ID - Fixed version
router.post("/api/fetchsingleemail", async (req, res) => {
  let client;
  try {
    const { token, email, messageId, mailbox = "INBOX" } = req.body;

    console.log(`📥 [FetchSingle] START request for: ${email}`);
    console.log(
      `👉 [FetchSingle] Looking for Message-ID: ${messageId} in Box: ${mailbox}`,
    );

    if (!token || !email || !messageId) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
    }

    const smtp = await SMTPAuth.findOne({ email, token });
    if (!smtp) {
      return res
        .status(403)
        .json({ success: false, error: "Invalid token or sender email" });
    }

    const imapAuth = await getAuthForIMAP(smtp, email);

    console.log(`🔌 [FetchSingle] Using SMTP Host for IMAP: ${smtp.host}`);

    client = new ImapFlow({
      host: getImapHost(smtp.host, email, smtp.oauth2?.provider),
      port: 993,
      secure: true,
      auth: imapAuth,
      logger: false,
      timeout: 45000, // Increased timeout
    });

    console.log(`🔌 [FetchSingle] Attempting IMAP connection...`);

    await client.connect();
    console.log(`✅ [FetchSingle] IMAP connection successful`);

    const lock = await client.mailboxOpen(mailbox);
    console.log(
      `📂 [FetchSingle] Mailbox opened. Total messages: ${lock.exists}`,
    );
    console.log(`🔎 [FetchSingle] Searching for Message-ID: ${messageId}`);

    // Search for the message
    const messageUids = await client.search({
      header: { "Message-ID": messageId },
    });

    console.log(
      `🔢 [FetchSingle] Found ${messageUids.length} matching message(s)`,
    );

    if (!messageUids || messageUids.length === 0) {
      // Quick logout for not found case
      try {
        await client.logout();
      } catch (e) {
        await client.close();
      }
      return res.status(404).json({
        success: false,
        error: "Email not found with the provided Message-ID",
      });
    }

    let foundEmail = null;
    let processedCount = 0;

    console.log(
      `📨 [FetchSingle] Starting to fetch message with UID: ${messageUids[0]}`,
    );

    // Fetch the message
    for await (let msg of client.fetch(messageUids, {
      byUid: true,
      envelope: true,
      uid: true,
      flags: true,
      source: true,
    })) {
      console.log(`🔄 [FetchSingle] Processing message ${++processedCount}`);

      const parsed = await simpleParser(msg.source);
      console.log(
        `📝 [FetchSingle] Email parsed successfully, subject: "${msg.envelope.subject}"`,
      );

      // Clean HTML content
      let cleanHtml = parsed.html || "";
      if (cleanHtml) {
        console.log(`🧹 [FetchSingle] Cleaning HTML content...`);
        cleanHtml = cleanHtml.replace(
          /https:\/\/tracking\.inflection\.io\/[^"']+/g,
          (url) => {
            try {
              const urlObj = new URL(url);
              const redirect = urlObj.searchParams.get("redirect");
              return redirect || url;
            } catch {
              return url;
            }
          },
        );

        cleanHtml = cleanHtml.replace(
          /<span[^>]*id="inflection-email-preheader"[^>]*>.*?<\/span>/gis,
          "",
        );
      }

      // Extract clean text
      let cleanText = parsed.text || "";
      if (cleanText) {
        cleanText = cleanText.replace(
          /https:\/\/tracking\.inflection\.io\/[^\s]+/g,
          "",
        );
      }

      foundEmail = {
        subject: msg.envelope.subject,
        from: msg.envelope.from.map((f) => ({
          name: f.name || "",
          address: f.address,
        })),
        date: msg.envelope.date,
        uid: msg.uid,
        read: Array.isArray(msg.flags) ? msg.flags.includes("\\Seen") : false,
        text: cleanText,
        html: cleanHtml,
        to:
          msg.envelope.to?.map((t) => ({
            name: t.name || "",
            address: t.address,
          })) || [],
        cc:
          msg.envelope.cc?.map((c) => ({
            name: c.name || "",
            address: c.address,
          })) || [],
        messageId: msg.envelope.messageId,
        attachments: parsed.attachments
          ? parsed.attachments.map((att) => ({
              filename: att.filename,
              contentType: att.contentType,
              size: att.size,
            }))
          : [],
      };

      console.log(`✅ [FetchSingle] Message processed successfully`);
      break;
    }

    // SEND RESPONSE FIRST, then cleanup connection
    console.log(
      `🎉 [FetchSingle] SUCCESS - Sending response first for: "${foundEmail.subject}"`,
    );

    // Send response immediately
    res.json({
      success: true,
      email: foundEmail,
    });

    console.log(
      `✅ [FetchSingle] Response sent to client, now cleaning up connection...`,
    );

    // Then cleanup connection in background
    try {
      await client.logout();
      console.log(`🔒 [FetchSingle] IMAP connection closed gracefully`);
    } catch (logoutError) {
      console.log(
        `⚠️ [FetchSingle] Logout failed, forcing close:`,
        logoutError.message,
      );
      try {
        await client.close();
        console.log(`🔒 [FetchSingle] IMAP connection force-closed`);
      } catch (closeError) {
        console.log(`⚠️ [FetchSingle] Close also failed:`, closeError.message);
      }
    }
  } catch (err) {
    console.error("❌ [FetchSingle] Final Error:", err);

    // Send error response first
    if (!res.headersSent) {
      if (err.code === "ETIMEDOUT" || err.code === "ETIMEOUT") {
        return res.status(408).json({
          success: false,
          error: "Connection timeout",
        });
      }

      return res.status(500).json({
        success: false,
        error: err.message,
      });
    } else {
      console.log(
        "⚠️ [FetchSingle] Response already sent, but error occurred during cleanup",
      );
    }

    // Then cleanup connection
    if (client) {
      try {
        await client.close();
      } catch (closeErr) {
        // Ignore cleanup errors
      }
    }
  }
});

//_________________________Tracking API's_________________________

// Helper to identify automated machine opens (scanners/pre-fetchers) for all major email providers
function checkIsMachineOpen(userAgent = "") {
  const ua = userAgent.toLowerCase();

  // 1. Google/Gmail Scanners & Prefetchers
  if (
    ua.includes("gmail-content-sampling") ||
    ua.includes("googleimageproxy") ||
    ua.includes("google-image-proxy") ||
    ua.includes("via ggpht.com")
  ) {
    return true;
  }

  // 2. Microsoft/Outlook/Office 365 Scanners & SafeLinks
  if (
    ua.includes("office365") ||
    ua.includes("outlook-express") ||
    ua.includes("microsoft-office") ||
    ua.includes("safelinks")
  ) {
    return true;
  }

  // 3. Yahoo Mail Proxy
  if (ua.includes("yahoomailproxy") || ua.includes("yahoo-mail-proxy")) {
    return true;
  }

  // 4. Apple Mail Privacy Protection (MPP) & generic masked agents (ends with "Mozilla/5.0" or is exactly "Mozilla/5.0")
  if (
    userAgent.trim() === "Mozilla/5.0" ||
    userAgent.trim() === "mozilla/5.0" ||
    ua.endsWith("mozilla/5.0")
  ) {
    return true;
  }

  // 5. General Security Scanners, Crawlers, and Bots
  if (
    ua.includes("bot") ||
    ua.includes("crawler") ||
    ua.includes("spider") ||
    ua.includes("scanner") ||
    ua.includes("pingdom") ||
    ua.includes("headless")
  ) {
    return true;
  }

  return false;
}

// 3️⃣ Track Email Opens with Better Accuracy
router.get("/api/track/open/:trackingId", async (req, res) => {
  try {
    const trackingId = req.params.trackingId;
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.connection?.remoteAddress ||
      req.socket?.remoteAddress ||
      "";
    const userAgent = req.headers["user-agent"] || "";
    const referer = req.headers["referer"] || "";

    // Create a session ID based on IP and User Agent to detect unique opens
    const sessionId = crypto
      .createHash("md5")
      .update(`${ip}-${userAgent}`)
      .digest("hex");

    // Detect if this is an automated scanner/machine open
    const isMachineOpen = checkIsMachineOpen(userAgent);

    /* 
      FUTURE TOGGLE: If you want to completely ignore machine/bot opens in the future 
      and get back to a "no machine open" state (meaning bots/scanners won't trigger 
      any database updates or webhooks), uncomment the block below:
      
      if (isMachineOpen) {
        console.log(`Ignored machine open for trackingId: ${trackingId}`);
        res.set("Content-Type", "image/png");
        res.set("Cache-Control", "no-store, no-cache, must-revalidate, private, max-age=0, post-check=0, pre-check=0");
        res.set("Pragma", "no-cache");
        res.set("Expires", "0");
        return res.send(
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
            "base64",
          ),
        );
      }
    */

    // Get current time
    const now = new Date();

    // Find the tracking record
    const tracking = await EmailTracking.findOne({ messageId: trackingId });
    if (!tracking) {
      console.log(`Tracking not found for: ${trackingId}`);
      res.set("Content-Type", "image/png");
      res.set(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, private, max-age=0, post-check=0, pre-check=0",
      );
      res.set("Pragma", "no-cache");
      res.set("Expires", "0");
      return res.send(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
          "base64",
        ),
      );
    }

    // Get tracking payload data (directly stored or extracted from content)
    let extractedTrackingData = {};

    // First, check if tracking payload was directly stored
    if (tracking.trackingPayload) {
      extractedTrackingData = { ...tracking.trackingPayload };
      console.log("📊 Direct Tracking Payload Found:", {
        trackingId,
        email: tracking.toEmail,
        trackingPayload: extractedTrackingData,
        timestamp: now,
      });
    } else {
      // Fallback: Try to extract tracking data from the email content
      try {
        if (tracking.emailContent && tracking.emailContent.html) {
          const htmlContent = tracking.emailContent.html;

          // Extract tracking payload using regex patterns
          const trackingPatterns = {
            email: /data-tracking-email=["']([^"']+)["']/i,
            sender_user_id: /data-sender-user-id=["']([^"']+)["']/i,
            object_type: /data-object-type=["']([^"']+)["']/i,
            object_id: /data-object-id=["']([^"']+)["']/i,
            contact_action_id: /data-contact-action-id=["']([^"']+)["']/i,
            page_id: /data-page-id=["']([^"']+)["']/i,
            sequence_id: /data-sequence-id=["']([^"']+)["']/i,
            action_block_id: /data-action-block-id=["']([^"']+)["']/i,
          };

          // Extract each tracking field
          Object.keys(trackingPatterns).forEach((key) => {
            const match = htmlContent.match(trackingPatterns[key]);
            if (match && match[1]) {
              extractedTrackingData[key] = match[1];
            }
          });

          // Also try to extract from URL parameters or hidden inputs
          const urlPattern = /tracking-data=([^&\s]+)/i;
          const urlMatch = htmlContent.match(urlPattern);
          if (urlMatch && urlMatch[1]) {
            try {
              const decodedData = JSON.parse(decodeURIComponent(urlMatch[1]));
              extractedTrackingData = {
                ...extractedTrackingData,
                ...decodedData,
              };
            } catch (e) {
              console.log("Failed to parse URL tracking data");
            }
          }
        }
      } catch (extractError) {
        console.log("Error extracting tracking data:", extractError.message);
      }
    }

    // Log extracted tracking data
    if (Object.keys(extractedTrackingData).length > 0) {
      console.log("📊 Extracted Tracking Data:", {
        trackingId,
        email: tracking.toEmail,
        extractedData: extractedTrackingData,
        timestamp: now,
      });
    }

    // Check if this is a duplicate open (same session within 30 seconds)
    const thirtySecondsAgo = new Date(now.getTime() - 30 * 1000);
    const recentOpen =
      tracking.openEvents &&
      tracking.openEvents.find(
        (event) =>
          event.sessionId === sessionId && event.openedAt > thirtySecondsAgo,
      );

    let shouldCount = false;
    let isReplay = false;
    let updatedTracking = tracking;

    if (!recentOpen) {
      // This is a new open or first open
      shouldCount = true;

      // Update tracking with new open event
      updatedTracking = await EmailTracking.findOneAndUpdate(
        { messageId: trackingId },
        {
          $inc: { openedCount: 1 },
          $set: {
            openedAt: now,
            lastOpenedIP: ip,
          },
          $push: {
            openEvents: {
              openedAt: now,
              ip: ip,
              userAgent: userAgent,
              sessionId: sessionId,
              isMachineOpen: isMachineOpen,
            },
          },
        },
        { new: true },
      );

      console.log(
        `New email open detected: ${trackingId} (Recipient: ${tracking.toEmail}) from IP: ${ip}, Count: ${updatedTracking.openedCount}`,
      );
    } else {
      // This is a replay: same session re-opened within the dedup window.
      // Record it separately so repeat-engagement is not lost.
      isReplay = true;

      updatedTracking = await EmailTracking.findOneAndUpdate(
        { messageId: trackingId },
        {
          $inc: { replayCount: 1 },
          $push: {
            replayEvents: {
              replayedAt: now,
              ip: ip,
              userAgent: userAgent,
              sessionId: sessionId,
              isMachineOpen: isMachineOpen,
            },
          },
        },
        { new: true },
      );

      console.log(
        `📧 Replay open logged: ${trackingId} (Recipient: ${tracking.toEmail}) from IP: ${ip} (same session within 30 seconds), Replay Count: ${updatedTracking.replayCount}`,
      );
    }

    // Send webhook notification only for new opens
    if (shouldCount) {
      await sendWebhookNotification(
        "https://meet.onepgr.com/session/smatpTracking",
        {
          event: "opened",
          trackingId,
          email: tracking.toEmail,
          from: tracking.fromEmail,
          subject: tracking.subject,
          ip,
          userAgent,
          openedCount: updatedTracking.openedCount,
          sessionId: sessionId,
          isNewOpen: true,
          isMachineOpen: isMachineOpen,
          timestamp: now,
          extractedTrackingData,
          openEvents: updatedTracking.openEvents || [],
          uniqueOpens: updatedTracking.openEvents
            ? updatedTracking.openEvents.length
            : 0,
        },
      );
    }

    // Send webhook notification for replay opens
    // if (isReplay) {
    //   await sendWebhookNotification(
    //     "https://meet.onepgr.com/session/smatpTracking",
    //     {
    //       event: "replayed",
    //       trackingId,
    //       email: tracking.toEmail,
    //       from: tracking.fromEmail,
    //       subject: tracking.subject,
    //       ip,
    //       userAgent,
    //       openedCount: updatedTracking.openedCount,
    //       replayCount: updatedTracking.replayCount,
    //       sessionId: sessionId,
    //       isNewOpen: false,
    //       isMachineOpen: isMachineOpen,
    //       timestamp: now,
    //       extractedTrackingData,
    //       replayEvents: updatedTracking.replayEvents || [],
    //     },
    //   );
    // }

    // Disable cache completely to ensure accurate tracking on every email open
    res.set("Content-Type", "image/png");
    res.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private, max-age=0, post-check=0, pre-check=0",
    );
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.send(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "base64",
      ),
    );
  } catch (error) {
    console.error(
      `❌ Open tracking error for trackingId ${req.params.trackingId || "unknown"}:`,
      error,
    );
    res.set("Content-Type", "image/png");
    res.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, private, max-age=0, post-check=0, pre-check=0",
    );
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res
      .status(200)
      .send(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
          "base64",
        ),
      );
  }
});

// 4️⃣ Track Link Clicks
router.get("/api/track/click/:trackingId", async (req, res) => {
  try {
    const trackingId = req.params.trackingId;
    const url = decodeURIComponent(req.query.url);
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.connection.remoteAddress;
    const userAgent = req.headers["user-agent"];

    const tracking = await EmailTracking.findOneAndUpdate(
      { messageId: trackingId },
      {
        $push: {
          clickEvents: {
            url,
            clickedAt: new Date(),
            ip,
            userAgent,
          },
        },
      },
      { new: true },
    );

    // Get tracking payload data (directly stored or extracted from content)
    let extractedTrackingData = {};

    // First, check if tracking payload was directly stored
    if (tracking.trackingPayload) {
      extractedTrackingData = { ...tracking.trackingPayload };
      console.log("🔗 Click Tracking - Direct Payload Found:", {
        trackingId,
        email: tracking.toEmail,
        clickedUrl: url,
        trackingPayload: extractedTrackingData,
        timestamp: new Date(),
      });
    } else {
      // Fallback: Try to extract tracking data from the email content
      try {
        if (tracking.emailContent && tracking.emailContent.html) {
          const htmlContent = tracking.emailContent.html;

          // Extract tracking payload using regex patterns
          const trackingPatterns = {
            email: /data-tracking-email=["']([^"']+)["']/i,
            sender_user_id: /data-sender-user-id=["']([^"']+)["']/i,
            object_type: /data-object-type=["']([^"']+)["']/i,
            object_id: /data-object-id=["']([^"']+)["']/i,
            contact_action_id: /data-contact-action-id=["']([^"']+)["']/i,
            page_id: /data-page-id=["']([^"']+)["']/i,
            sequence_id: /data-sequence-id=["']([^"']+)["']/i,
            action_block_id: /data-action-block-id=["']([^"']+)["']/i,
          };

          // Extract each tracking field
          Object.keys(trackingPatterns).forEach((key) => {
            const match = htmlContent.match(trackingPatterns[key]);
            if (match && match[1]) {
              extractedTrackingData[key] = match[1];
            }
          });

          // Also try to extract from URL parameters
          const urlPattern = /tracking-data=([^&\s]+)/i;
          const urlMatch = htmlContent.match(urlPattern);
          if (urlMatch && urlMatch[1]) {
            try {
              const decodedData = JSON.parse(decodeURIComponent(urlMatch[1]));
              extractedTrackingData = {
                ...extractedTrackingData,
                ...decodedData,
              };
            } catch (e) {
              console.log("Failed to parse URL tracking data");
            }
          }
        }
      } catch (extractError) {
        console.log(
          "Error extracting tracking data from click:",
          extractError.message,
        );
      }
    }

    // Log extracted tracking data
    if (Object.keys(extractedTrackingData).length > 0) {
      console.log("🔗 Click Tracking Data:", {
        trackingId,
        email: tracking.toEmail,
        clickedUrl: url,
        extractedData: extractedTrackingData,
        timestamp: new Date(),
      });
    }

    if (tracking) {
      await sendWebhookNotification(
        "https://meet.onepgr.com/session/smatpTracking",
        {
          event: "clicked",
          trackingId,
          email: tracking.toEmail,
          from: tracking.fromEmail,
          subject: tracking.subject,
          url,
          ip,
          userAgent,
          timestamp: new Date(),
          extractedTrackingData,
          clickEvents: tracking.clickEvents || [],
          totalClicks: tracking.clickEvents ? tracking.clickEvents.length : 0,
        },
      );
    }

    res.redirect(url);
  } catch (error) {
    console.error(
      `❌ Click tracking error for trackingId ${req.params.trackingId || "unknown"} (URL: ${req.query.url || "unknown"}):`,
      error,
    );
    res.redirect(decodeURIComponent(req.query.url));
  }
});

// 5️⃣ Reply Detection
let replyCheckRunning = false; // prevents overlapping cycles

// Structured JSON-line logger for the reply-detection cycle
function replyLog(level, event, data = {}) {
  // console.log(
  //   JSON.stringify(
  //     {
  //       ts: new Date().toISOString(),
  //       scope: "checkForReplies",
  //       level, // "info" | "warn" | "error"
  //       event,
  //       ...data,
  //     },
  //     null,
  //     2,
  //   ),
  // );
}

// Human-readable cycle summary printed alongside the cycle_done JSON line.
// Additive — does not replace any existing JSON-line log.
function printCycleSummary(
  report,
  totals,
  durationMs,
  candidatesLoaded,
  startedAtIso,
) {
  const STATUS_ICON = {
    completed: "✅",
    skipped: "⚠️ ",
    failed: "❌",
    pending: "❔",
  };
  const rows = [];
  let counts = { completed: 0, skipped: 0, failed: 0 };
  let i = 0;
  for (const [mailbox, m] of report) {
    i++;
    counts[m.status] = (counts[m.status] || 0) + 1;
    const icon = STATUS_ICON[m.status] || "❔";
    let details;
    if (m.status === "skipped") {
      details = `${m.reason}${m.recordsSkipped ? ` (${m.recordsSkipped} record(s))` : ""}`;
    } else if (m.status === "failed") {
      details = `${m.reason || "error"}`;
    } else {
      const skipped = m.recordsSkipped ? `${m.recordsSkipped} dropped, ` : "";
      details = `${skipped}${m.checked} checked → ${m.replies} repl${m.replies === 1 ? "y" : "ies"}${m.errors ? `, ${m.errors} err` : ""}`;
    }
    rows.push({
      i,
      mailbox,
      icon,
      records: m.recordsTotal,
      host: m.host,
      details,
    });
  }

  const widths = {
    i: Math.max(1, ...rows.map((r) => String(r.i).length)),
    mailbox: Math.max(7, ...rows.map((r) => r.mailbox.length)),
    records: Math.max(7, ...rows.map((r) => String(r.records).length)),
    host: Math.max(4, ...rows.map((r) => r.host.length)),
    details: Math.max(7, ...rows.map((r) => r.details.length)),
  };
  const pad = (s, w) => String(s).padEnd(w);

  const lines = [];
  lines.push("");
  lines.push("================ Reply Check Cycle Summary ================");
  lines.push(
    `${startedAtIso} · duration ${(durationMs / 1000).toFixed(1)}s · ${totals.repliesFound} repl${totals.repliesFound === 1 ? "y" : "ies"} · ${totals.errors} error(s)`,
  );
  lines.push(
    `mailboxes: ${report.size} (✅ ${counts.completed || 0}  ⚠️  ${counts.skipped || 0}  ❌ ${counts.failed || 0})  ·  candidates: ${candidatesLoaded}  ·  records checked: ${totals.recordsChecked}`,
  );
  lines.push("");
  lines.push(
    `${pad("#", widths.i)}  ${pad("Mailbox", widths.mailbox)}  St  ${pad("Records", widths.records)}  ${pad("Host", widths.host)}  Details`,
  );
  for (const r of rows) {
    lines.push(
      `${pad(r.i, widths.i)}  ${pad(r.mailbox, widths.mailbox)}  ${r.icon}  ${pad(r.records, widths.records)}  ${pad(r.host, widths.host)}  ${r.details}`,
    );
  }
  lines.push("===========================================================");
  lines.push("");
  console.log(lines.join("\n"));
}

async function checkForReplies() {
  if (replyCheckRunning) {
    replyLog("warn", "cycle_skipped", { reason: "previous_cycle_running" });
    return;
  }
  replyCheckRunning = true;
  const startedAt = Date.now();

  try {
    const trackings = await EmailTracking.find({
      repliedAt: { $exists: false },
      fromEmail: { $exists: true },
      originalMessageId: { $exists: true, $ne: null },
    })
      .sort({ createdAt: -1 })
      .limit(200);

    // Group pending records by sender mailbox so each mailbox is opened once
    const byMailbox = new Map();
    for (const tracking of trackings) {
      if (!byMailbox.has(tracking.fromEmail)) {
        byMailbox.set(tracking.fromEmail, []);
      }
      byMailbox.get(tracking.fromEmail).push(tracking);
    }

    replyLog("info", "cycle_start", {
      candidates: trackings.length,
      mailboxes: byMailbox.size,
    });

    const cycleStartedAtIso = new Date(startedAt).toISOString();
    const mailboxReport = new Map();
    for (const [mailbox, records] of byMailbox) {
      mailboxReport.set(mailbox, {
        status: "pending",
        reason: null,
        recordsTotal: records.length,
        recordsSkipped: 0,
        host: "—",
        checked: 0,
        replies: 0,
        errors: 0,
      });
    }

    const totals = { recordsChecked: 0, repliesFound: 0, errors: 0 };

    // Sequential — one mailbox at a time
    for (const [mailbox, records] of byMailbox) {
      const smtp = await SMTPAuth.findOne({ email: mailbox });
      if (!smtp) {
        replyLog("warn", "mailbox_skipped", {
          mailbox,
          reason: "no_credentials",
          records: records.length,
        });
        const r = mailboxReport.get(mailbox);
        if (r) {
          r.status = "skipped";
          r.reason = "no_credentials";
        }
        continue;
      }

      // Drop records that can't be matched to a reply
      const valid = [];
      for (const tracking of records) {
        if (tracking.originalMessageId) {
          valid.push(tracking);
        } else {
          replyLog("warn", "record_skipped", {
            mailbox,
            trackingId: tracking.messageId,
            reason: "no_original_message_id",
          });
          const r = mailboxReport.get(mailbox);
          if (r) r.recordsSkipped += 1;
        }
      }
      if (valid.length === 0) {
        replyLog("warn", "mailbox_skipped", {
          mailbox,
          reason: "all_records_invalid",
          records: records.length,
        });
        const r = mailboxReport.get(mailbox);
        if (r) {
          r.status = "skipped";
          r.reason = "all_records_invalid";
        }
        continue;
      }

      // Microsoft OAuth mailboxes: tokens carry Graph scopes only (no IMAP
      // scope), so IMAP XOAUTH2 fails with "Command failed". Read replies over
      // Microsoft Graph instead. All other mailboxes keep the IMAP path below.
      if (isMicrosoftMailbox(smtp, mailbox) && smtp.authType === "oauth2") {
        const mb = { checked: 0, replies: 0, errors: 0 };
        const rConn = mailboxReport.get(mailbox);
        try {
          const accessToken = await getValidAccessToken(smtp);

          // Look back only as far as the oldest pending record (1-day buffer).
          let sinceIso = null;
          let oldest = null;
          for (const t of valid) {
            const ts = t.createdAt || t.sentAt;
            if (ts && (!oldest || new Date(ts) < new Date(oldest))) oldest = ts;
          }
          if (oldest) {
            sinceIso = new Date(
              new Date(oldest).getTime() - 24 * 60 * 60 * 1000,
            ).toISOString();
          }

          const messages = await fetchInboxForReplyMatch(accessToken, sinceIso);
          if (rConn) rConn.host = "graph.microsoft.com";
          replyLog("info", "mailbox_connected", {
            mailbox,
            host: "graph.microsoft.com",
            records: valid.length,
          });

          for (const tracking of valid) {
            try {
              let matchMethod = null;
              let matchedMsg = null;
              for (const msg of messages) {
                const m = graphMessageMatchesTracking(msg, tracking);
                if (m) {
                  matchMethod = m;
                  matchedMsg = msg;
                  break;
                }
              }

              mb.checked++;
              totals.recordsChecked++;

              if (!matchMethod) {
                replyLog("info", "reply_not_found", {
                  mailbox,
                  trackingId: tracking.messageId,
                  originalMessageId: tracking.originalMessageId,
                });
                continue;
              }

              const replyTime = new Date();
              let replyText = matchedMsg.bodyPreview || "";
              let replyHtml = "";

              try {
                const mimeContent = await fetchMimeContentViaGraph(
                  accessToken,
                  matchedMsg.id,
                );
                const parsed = await simpleParser(mimeContent);
                if (parsed.text) replyText = parsed.text;
                if (parsed.html) replyHtml = parsed.html;
              } catch (mimeErr) {
                replyLog("warn", "graph_mime_fetch_failed", {
                  mailbox,
                  messageId: matchedMsg.id,
                  error: mimeErr.message,
                });
              }

              const replyDetails = {
                replyFrom: matchedMsg.from
                  ? `${matchedMsg.from.emailAddress?.name || ""} <${matchedMsg.from.emailAddress?.address || ""}>`
                  : "Unknown",
                replySubject: matchedMsg.subject || "(No Subject)",
                replyDate: matchedMsg.receivedDateTime,
                replyText,
                replyHtml,
                replyMessageId: matchedMsg.internetMessageId || matchedMsg.id,
              };

              await EmailTracking.findOneAndUpdate(
                { messageId: tracking.messageId },
                { $set: { repliedAt: replyTime } },
              );

              replyLog("info", "reply_found", {
                mailbox,
                trackingId: tracking.messageId,
                method: matchMethod,
                originalMessageId: tracking.originalMessageId,
                replyFrom: replyDetails.replyFrom,
              });

              let extractedTrackingData = {};
              if (tracking.trackingPayload) {
                extractedTrackingData = { ...tracking.trackingPayload };
              }

              await sendWebhookNotification(
                "https://meet.onepgr.com/session/smatpTracking",
                {
                  event: "replied",
                  trackingId: tracking.messageId,
                  email: tracking.toEmail,
                  from: tracking.fromEmail,
                  subject: tracking.subject,
                  timestamp: replyTime,
                  extractedTrackingData,
                  replyDetails,
                  originalMessageId: tracking.originalMessageId,
                  replyCount: 1,
                },
              );

              replyLog("info", "reply_webhook_sent", {
                mailbox,
                trackingId: tracking.messageId,
              });

              mb.replies++;
              totals.repliesFound++;
            } catch (recordErr) {
              mb.errors++;
              totals.errors++;
              replyLog("error", "record_error", {
                mailbox,
                trackingId: tracking.messageId,
                error: recordErr.message,
              });
            }
          }
        } catch (graphErr) {
          mb.errors++;
          totals.errors++;
          replyLog("error", "mailbox_connect_failed", {
            mailbox,
            host: "graph.microsoft.com",
            error: graphErr.message,
          });
          if (rConn) {
            rConn.status = "failed";
            rConn.reason = graphErr.message;
            rConn.host = "graph.microsoft.com";
          }
        }

        replyLog("info", "mailbox_done", {
          mailbox,
          checked: mb.checked,
          replies: mb.replies,
          errors: mb.errors,
        });
        const rDone = mailboxReport.get(mailbox);
        if (rDone) {
          if (rDone.status === "pending") rDone.status = "completed";
          rDone.checked = mb.checked;
          rDone.replies = mb.replies;
          rDone.errors = mb.errors;
        }
        continue; // handled via Graph — skip the IMAP path
      }

      const host = getImapHost(smtp.host, mailbox, smtp.oauth2?.provider);
      let client;
      const mb = { checked: 0, replies: 0, errors: 0 };

      try {
        const imapAuth = await getAuthForIMAP(smtp, mailbox);
        client = new ImapFlow({
          host,
          port: 993,
          secure: true,
          auth: imapAuth,
          logger: false,
          timeout: 60000,
          keepalive: true,
          maxRetries: 1,
        });

        await Promise.race([
          client.connect(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Connection timeout")), 30000),
          ),
        ]);

        await Promise.race([
          client.mailboxOpen("INBOX"),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Mailbox open timeout")), 15000),
          ),
        ]);

        replyLog("info", "mailbox_connected", {
          mailbox,
          host,
          records: valid.length,
        });
        const rConn = mailboxReport.get(mailbox);
        if (rConn) rConn.host = host;

        // Reuse the SAME connection for every pending record of this mailbox
        for (const tracking of valid) {
          try {
            let foundReplies = false;
            let matchMethod = null;

            // Method 1: In-Reply-To header
            try {
              const inReplyToMessages = await client.search({
                header: { "In-Reply-To": tracking.originalMessageId },
              });
              if (inReplyToMessages.length > 0) {
                foundReplies = true;
                matchMethod = "in_reply_to";
              }
            } catch (error) {
              if (/Connection|timeout/i.test(error.message)) throw error;
              replyLog("warn", "search_failed", {
                mailbox,
                trackingId: tracking.messageId,
                method: "in_reply_to",
                error: error.message,
              });
            }

            // Method 2: References header
            if (!foundReplies) {
              try {
                const referencesMessages = await client.search({
                  header: { References: tracking.originalMessageId },
                });
                if (referencesMessages.length > 0) {
                  foundReplies = true;
                  matchMethod = "references";
                }
              } catch (error) {
                if (/Connection|timeout/i.test(error.message)) throw error;
                replyLog("warn", "search_failed", {
                  mailbox,
                  trackingId: tracking.messageId,
                  method: "references",
                  error: error.message,
                });
              }
            }

            // Method 3: Subject "Re:" from the recipient
            if (!foundReplies) {
              try {
                const subjectReplies = await client.search({
                  from: tracking.toEmail,
                  subject: "Re:",
                });
                for await (let msg of client.fetch(subjectReplies, {
                  source: true,
                })) {
                  const parsed = await simpleParser(msg.source);
                  if (
                    parsed.references &&
                    parsed.references.includes(tracking.originalMessageId)
                  ) {
                    foundReplies = true;
                    matchMethod = "subject";
                    break;
                  }
                }
              } catch (error) {
                if (/Connection|timeout/i.test(error.message)) throw error;
                replyLog("warn", "search_failed", {
                  mailbox,
                  trackingId: tracking.messageId,
                  method: "subject",
                  error: error.message,
                });
              }
            }

            mb.checked++;
            totals.recordsChecked++;

            if (!foundReplies) {
              replyLog("info", "reply_not_found", {
                mailbox,
                trackingId: tracking.messageId,
                originalMessageId: tracking.originalMessageId,
              });
              continue;
            }

            // Reply found — fetch detailed reply information
            const replyTime = new Date();
            let replyDetails = null;
            try {
              const replyMessages = await client.search({
                header: { "In-Reply-To": tracking.originalMessageId },
              });
              if (replyMessages.length > 0) {
                for await (let msg of client.fetch(replyMessages.slice(0, 1), {
                  envelope: true,
                  source: true,
                })) {
                  const parsed = await simpleParser(msg.source);
                  replyDetails = {
                    replyFrom: msg.envelope.from
                      ? msg.envelope.from
                          .map((f) => `${f.name || ""} <${f.address}>`)
                          .join(", ")
                      : "Unknown",
                    replySubject: msg.envelope.subject || "(No Subject)",
                    replyDate: msg.envelope.date,
                    replyText: parsed.text || "",
                    replyHtml: parsed.html || "",
                    replyMessageId: parsed.messageId,
                  };
                  break;
                }
              }
            } catch (error) {
              replyLog("warn", "reply_details_failed", {
                mailbox,
                trackingId: tracking.messageId,
                error: error.message,
              });
              // Continue with basic reply detection even if details fetch fails
            }

            await EmailTracking.findOneAndUpdate(
              { messageId: tracking.messageId },
              { $set: { repliedAt: replyTime } },
            );

            replyLog("info", "reply_found", {
              mailbox,
              trackingId: tracking.messageId,
              method: matchMethod,
              originalMessageId: tracking.originalMessageId,
              replyFrom: replyDetails ? replyDetails.replyFrom : null,
            });

            let extractedTrackingData = {};
            if (tracking.trackingPayload) {
              extractedTrackingData = { ...tracking.trackingPayload };
            }

            await sendWebhookNotification(
              "https://meet.onepgr.com/session/smatpTracking",
              {
                event: "replied",
                trackingId: tracking.messageId,
                email: tracking.toEmail,
                from: tracking.fromEmail,
                subject: tracking.subject,
                timestamp: replyTime,
                extractedTrackingData,
                replyDetails: replyDetails,
                originalMessageId: tracking.originalMessageId,
                replyCount: 1,
              },
            );

            replyLog("info", "reply_webhook_sent", {
              mailbox,
              trackingId: tracking.messageId,
            });

            mb.replies++;
            totals.repliesFound++;
          } catch (recordErr) {
            mb.errors++;
            totals.errors++;
            replyLog("error", "record_error", {
              mailbox,
              trackingId: tracking.messageId,
              error: recordErr.message,
            });
            // A connection-level error means the mailbox session is dead
            if (/Connection|timeout/i.test(recordErr.message)) break;
          }
        }
      } catch (connErr) {
        mb.errors++;
        totals.errors++;
        replyLog("error", "mailbox_connect_failed", {
          mailbox,
          host,
          error: connErr.message,
        });
        const rFail = mailboxReport.get(mailbox);
        if (rFail) {
          rFail.status = "failed";
          rFail.reason = connErr.message;
          rFail.host = host;
        }
      } finally {
        try {
          if (client && typeof client.logout === "function") {
            await client.logout().catch(() => null);
          }
        } catch (logoutError) {
          /* ignore logout errors */
        }
      }

      replyLog("info", "mailbox_done", {
        mailbox,
        checked: mb.checked,
        replies: mb.replies,
        errors: mb.errors,
      });
      const rDone = mailboxReport.get(mailbox);
      if (rDone) {
        if (rDone.status === "pending") rDone.status = "completed";
        rDone.checked = mb.checked;
        rDone.replies = mb.replies;
        rDone.errors = mb.errors;
      }
    }

    const cycleDurationMs = Date.now() - startedAt;
    replyLog("info", "cycle_done", {
      mailboxes: byMailbox.size,
      recordsChecked: totals.recordsChecked,
      repliesFound: totals.repliesFound,
      errors: totals.errors,
      durationMs: cycleDurationMs,
    });
    printCycleSummary(
      mailboxReport,
      totals,
      cycleDurationMs,
      trackings.length,
      cycleStartedAtIso,
    );
  } catch (err) {
    replyLog("error", "cycle_error", { error: err.message });
  } finally {
    replyCheckRunning = false;
  }
}

// 5️⃣.1️⃣ Manual Reply Check API
router.post("/api/check-replies", async (req, res) => {
  try {
    const { token, email, messageId } = req.body;
    if (!token || !email || !messageId) {
      return res
        .status(400)
        .json({ success: false, error: "Missing token, email, or messageId" });
    }

    const smtp = await SMTPAuth.findOne({ email, token });
    if (!smtp) {
      return res
        .status(403)
        .json({ success: false, error: "Invalid token or sender email" });
    }

    // Decrypt the password
    const imapAuth = await getAuthForIMAP(smtp, email);

    const client = new ImapFlow({
      host: getImapHost(smtp.host, email, smtp.oauth2?.provider),
      port: 993,
      secure: true,
      auth: imapAuth,
      logger: false,
    });

    await client.connect();
    await client.mailboxOpen("INBOX");

    const replies = [];
    let foundReplies = false;

    // Method 1: Search by In-Reply-To header
    try {
      const inReplyToMessages = await client.search({
        header: { "In-Reply-To": messageId },
      });

      for await (let msg of client.fetch(inReplyToMessages, {
        envelope: true,
        uid: true,
        flags: true,
        source: true,
      })) {
        const parsed = await simpleParser(msg.source);
        const flags = Array.isArray(msg.flags) ? msg.flags : [];
        const isRead = flags.includes("Seen") || flags.includes("\\Seen");

        replies.push({
          subject: msg.envelope.subject || "(No Subject)",
          from: msg.envelope.from
            ? msg.envelope.from
                .map((f) => `${f.name || ""} <${f.address}>`)
                .join(", ")
            : "Unknown",
          date: msg.envelope.date,
          uid: msg.uid,
          read: isRead,
          status: isRead ? "read" : "unread",
          text: parsed.text || "",
          html: parsed.html || "",
          messageId: parsed.messageId,
          inReplyTo: parsed.inReplyTo,
          references: parsed.references,
          replyMethod: "In-Reply-To",
        });
        foundReplies = true;
      }
    } catch (error) {
      console.log("In-Reply-To search failed:", error.message);
    }

    // Method 2: Search by References header
    try {
      const referencesMessages = await client.search({
        header: { References: messageId },
      });

      for await (let msg of client.fetch(referencesMessages, {
        envelope: true,
        uid: true,
        flags: true,
        source: true,
      })) {
        const parsed = await simpleParser(msg.source);
        const flags = Array.isArray(msg.flags) ? msg.flags : [];
        const isRead = flags.includes("Seen") || flags.includes("\\Seen");

        // Avoid duplicates
        const existingReply = replies.find((r) => r.uid === msg.uid);
        if (!existingReply) {
          replies.push({
            subject: msg.envelope.subject || "(No Subject)",
            from: msg.envelope.from
              ? msg.envelope.from
                  .map((f) => `${f.name || ""} <${f.address}>`)
                  .join(", ")
              : "Unknown",
            date: msg.envelope.date,
            uid: msg.uid,
            read: isRead,
            status: isRead ? "read" : "unread",
            text: parsed.text || "",
            html: parsed.html || "",
            messageId: parsed.messageId,
            inReplyTo: parsed.inReplyTo,
            references: parsed.references,
            replyMethod: "References",
          });
          foundReplies = true;
        }
      }
    } catch (error) {
      console.log("References search failed:", error.message);
    }

    await client.logout();

    // Sort replies by date
    replies.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Get tracking payload if available
    let trackingPayload = null;
    try {
      const tracking = await EmailTracking.findOne({
        originalMessageId: messageId,
      });
      if (tracking && tracking.trackingPayload) {
        trackingPayload = tracking.trackingPayload;
      }
    } catch (error) {
      console.log("Error fetching tracking payload:", error.message);
    }

    return res.json({
      success: true,
      originalMessageId: messageId,
      foundReplies: foundReplies,
      replies: replies,
      totalReplies: replies.length,
      trackingPayload: trackingPayload,
    });
  } catch (err) {
    console.error("Manual Reply Check Error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6️⃣ Get Tracking Status with Reply Details
router.get("/api/track/:trackingId", async (req, res) => {
  try {
    const tracking = await EmailTracking.findOne({
      messageId: req.params.trackingId,
    });
    if (!tracking) {
      return res
        .status(200)
        .json({ success: false, error: "Tracking not found" });
    }

    // Format dates to readable format
    const formatDate = (date) => {
      if (!date) return null;
      return new Date(date).toLocaleString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      });
    };

    // Clean IP address (remove IPv6 prefix)
    const cleanIP = (ip) => {
      if (!ip) return null;
      return ip.replace("::ffff:", "");
    };

    // Get reply details if tracking has webhook enabled
    let replyDetails = null;
    if (tracking.webhookUrl) {
      try {
        const smtp = await SMTPAuth.findOne({ email: tracking.fromEmail });
        if (smtp) {
          const imapAuth = await getAuthForIMAP(smtp, tracking.fromEmail);
          const client = new ImapFlow({
            host: getImapHost(
              smtp.host,
              tracking.fromEmail,
              smtp.oauth2?.provider,
            ),
            port: 993,
            secure: true,
            auth: imapAuth,
            logger: false,
          });

          await client.connect();
          await client.mailboxOpen("INBOX");

          const replies = [];

          // Method 1: Search by In-Reply-To header
          try {
            const inReplyToMessages = await client.search({
              header: { "In-Reply-To": tracking.originalMessageId },
            });

            for await (let msg of client.fetch(inReplyToMessages, {
              envelope: true,
              uid: true,
              flags: true,
              source: true,
            })) {
              const parsed = await simpleParser(msg.source);
              const flags = Array.isArray(msg.flags) ? msg.flags : [];
              const isRead = flags.includes("Seen") || flags.includes("\\Seen");

              replies.push({
                subject: msg.envelope.subject || "(No Subject)",
                from: msg.envelope.from
                  ? msg.envelope.from
                      .map((f) => `${f.name || ""} <${f.address}>`)
                      .join(", ")
                  : "Unknown",
                date: formatDate(msg.envelope.date),
                uid: msg.uid,
                read: isRead,
                status: isRead ? "read" : "unread",
                text: parsed.text || "",
                html: parsed.html || "",
                messageId: parsed.messageId,
                inReplyTo: parsed.inReplyTo,
                references: parsed.references,
                replyMethod: "In-Reply-To",
              });
            }
          } catch (error) {
            console.log("In-Reply-To search failed:", error.message);
          }

          // Method 2: Search by References header
          try {
            const referencesMessages = await client.search({
              header: { References: tracking.originalMessageId },
            });

            for await (let msg of client.fetch(referencesMessages, {
              envelope: true,
              uid: true,
              flags: true,
              source: true,
            })) {
              const parsed = await simpleParser(msg.source);
              const flags = Array.isArray(msg.flags) ? msg.flags : [];
              const isRead = flags.includes("Seen") || flags.includes("\\Seen");

              // Avoid duplicates
              const existingReply = replies.find((r) => r.uid === msg.uid);
              if (!existingReply) {
                replies.push({
                  subject: msg.envelope.subject || "(No Subject)",
                  from: msg.envelope.from
                    ? msg.envelope.from
                        .map((f) => `${f.name || ""} <${f.address}>`)
                        .join(", ")
                    : "Unknown",
                  date: formatDate(msg.envelope.date),
                  uid: msg.uid,
                  read: isRead,
                  status: isRead ? "read" : "unread",
                  text: parsed.text || "",
                  html: parsed.html || "",
                  messageId: parsed.messageId,
                  inReplyTo: parsed.inReplyTo,
                  references: parsed.references,
                  replyMethod: "References",
                });
              }
            }
          } catch (error) {
            console.log("References search failed:", error.message);
          }

          await client.logout();

          // Sort replies by date
          replies.sort((a, b) => new Date(a.date) - new Date(b.date));

          replyDetails = {
            foundReplies: replies.length > 0,
            replies: replies,
            totalReplies: replies.length,
          };
        }
      } catch (error) {
        console.error("Reply details fetch error:", error);
        replyDetails = {
          foundReplies: false,
          replies: [],
          totalReplies: 0,
          error: "Failed to fetch reply details",
        };
      }
    }

    res.json({
      success: true,
      tracking: {
        // Email Details
        fromEmail: tracking.fromEmail,
        toEmail: tracking.toEmail,
        subject: tracking.subject,
        messageId: tracking.messageId,
        originalMessageId: tracking.originalMessageId,

        // Timing
        sentAt: formatDate(tracking.sentAt),
        opened: !!tracking.openedAt,
        openedCount: tracking.openedCount,
        lastOpenedAt: formatDate(tracking.openedAt),
        lastOpenedIP: cleanIP(tracking.lastOpenedIP),
        replied: !!tracking.repliedAt,
        repliedAt: formatDate(tracking.repliedAt),

        // Enhanced Open Tracking
        openEvents: tracking.openEvents
          ? tracking.openEvents.map((event) => ({
              openedAt: formatDate(event.openedAt),
              ip: cleanIP(event.ip),
              userAgent: event.userAgent,
              sessionId: event.sessionId,
              isMachineOpen: event.isMachineOpen || false,
            }))
          : [],
        uniqueOpens: tracking.openEvents ? tracking.openEvents.length : 0,

        // Replay Open Tracking
        replayCount: tracking.replayCount || 0,
        replayEvents: tracking.replayEvents
          ? tracking.replayEvents.map((event) => ({
              replayedAt: formatDate(event.replayedAt),
              ip: cleanIP(event.ip),
              userAgent: event.userAgent,
              sessionId: event.sessionId,
              isMachineOpen: event.isMachineOpen || false,
            }))
          : [],

        // Click Events
        clicks: tracking.clickEvents
          ? tracking.clickEvents.map((click) => ({
              ...click,
              clickedAt: formatDate(click.clickedAt),
              ip: cleanIP(click.ip),
            }))
          : [],
        totalClicks: tracking.clickEvents ? tracking.clickEvents.length : 0,

        // Webhook (only if trackLinks was enabled)
        webhookUrl: tracking.webhookUrl || null,

        // Reply Details
        replyDetails: replyDetails,

        // Timestamps
        createdAt: formatDate(tracking.createdAt),
        updatedAt: formatDate(tracking.updatedAt),
      },
    });
  } catch (error) {
    console.error("Tracking status error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6️⃣.1️⃣ Batch Get Tracking Status (by trackingIds or recipient toEmail)
router.post("/api/track/batch", async (req, res) => {
  try {
    const { trackingIds, toEmail } = req.body;

    let query = {};
    if (trackingIds && Array.isArray(trackingIds)) {
      query.messageId = { $in: trackingIds };
    } else if (toEmail) {
      query.toEmail = toEmail;
    } else {
      return res.status(400).json({
        success: false,
        error:
          "Either 'trackingIds' (array) or 'toEmail' (string) must be provided in request body",
      });
    }

    const trackings = await EmailTracking.find(query).sort({ createdAt: -1 });

    // Format dates to readable format
    const formatDate = (date) => {
      if (!date) return null;
      return new Date(date).toLocaleString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      });
    };

    // Clean IP address (remove IPv6 prefix)
    const cleanIP = (ip) => {
      if (!ip) return null;
      return ip.replace("::ffff:", "");
    };

    // Group tracking records by fromEmail to optimize IMAP connections
    const trackingsBySender = {};
    for (const tracking of trackings) {
      if (!trackingsBySender[tracking.fromEmail]) {
        trackingsBySender[tracking.fromEmail] = [];
      }
      trackingsBySender[tracking.fromEmail].push(tracking);
    }

    const replyDetailsMap = {};

    // Connect to IMAP once per sender email
    for (const fromEmail of Object.keys(trackingsBySender)) {
      const senderTrackings = trackingsBySender[fromEmail];
      const needsReplies = senderTrackings.some((t) => t.webhookUrl);
      if (!needsReplies) continue;

      try {
        const smtp = await SMTPAuth.findOne({ email: fromEmail });
        if (smtp) {
          const imapAuth = await getAuthForIMAP(smtp, fromEmail);
          const client = new ImapFlow({
            host: getImapHost(smtp.host, fromEmail, smtp.oauth2?.provider),
            port: 993,
            secure: true,
            auth: imapAuth,
            logger: false,
          });

          await client.connect();
          await client.mailboxOpen("INBOX");

          for (const tracking of senderTrackings) {
            if (!tracking.webhookUrl) continue;

            const replies = [];

            // Method 1: Search by In-Reply-To header
            try {
              const inReplyToMessages = await client.search({
                header: { "In-Reply-To": tracking.originalMessageId },
              });

              for await (let msg of client.fetch(inReplyToMessages, {
                envelope: true,
                uid: true,
                flags: true,
                source: true,
              })) {
                const parsed = await simpleParser(msg.source);
                const flags = Array.isArray(msg.flags) ? msg.flags : [];
                const isRead =
                  flags.includes("Seen") || flags.includes("\\Seen");

                replies.push({
                  subject: msg.envelope.subject || "(No Subject)",
                  from: msg.envelope.from
                    ? msg.envelope.from
                        .map((f) => `${f.name || ""} <${f.address}>`)
                        .join(", ")
                    : "Unknown",
                  date: formatDate(msg.envelope.date),
                  uid: msg.uid,
                  read: isRead,
                  status: isRead ? "read" : "unread",
                  text: parsed.text || "",
                  html: parsed.html || "",
                  messageId: parsed.messageId,
                  inReplyTo: parsed.inReplyTo,
                  references: parsed.references,
                  replyMethod: "In-Reply-To",
                });
              }
            } catch (error) {
              console.log("In-Reply-To search failed in batch:", error.message);
            }

            // Method 2: Search by References header
            try {
              const referencesMessages = await client.search({
                header: { References: tracking.originalMessageId },
              });

              for await (let msg of client.fetch(referencesMessages, {
                envelope: true,
                uid: true,
                flags: true,
                source: true,
              })) {
                const parsed = await simpleParser(msg.source);
                const flags = Array.isArray(msg.flags) ? msg.flags : [];
                const isRead =
                  flags.includes("Seen") || flags.includes("\\Seen");

                // Avoid duplicates
                const existingReply = replies.find((r) => r.uid === msg.uid);
                if (!existingReply) {
                  replies.push({
                    subject: msg.envelope.subject || "(No Subject)",
                    from: msg.envelope.from
                      ? msg.envelope.from
                          .map((f) => `${f.name || ""} <${f.address}>`)
                          .join(", ")
                      : "Unknown",
                    date: formatDate(msg.envelope.date),
                    uid: msg.uid,
                    read: isRead,
                    status: isRead ? "read" : "unread",
                    text: parsed.text || "",
                    html: parsed.html || "",
                    messageId: parsed.messageId,
                    inReplyTo: parsed.inReplyTo,
                    references: parsed.references,
                    replyMethod: "References",
                  });
                }
              }
            } catch (error) {
              console.log("References search failed in batch:", error.message);
            }

            replies.sort((a, b) => new Date(a.date) - new Date(b.date));

            replyDetailsMap[tracking.messageId] = {
              foundReplies: replies.length > 0,
              replies: replies,
              totalReplies: replies.length,
            };
          }

          await client.logout();
        }
      } catch (error) {
        console.error(
          `Reply details batch fetch error for ${fromEmail}:`,
          error,
        );
      }
    }

    const formattedTrackings = trackings.map((tracking) => ({
      fromEmail: tracking.fromEmail,
      toEmail: tracking.toEmail,
      subject: tracking.subject,
      messageId: tracking.messageId,
      originalMessageId: tracking.originalMessageId,
      sentAt: formatDate(tracking.sentAt),
      opened: !!tracking.openedAt,
      openedCount: tracking.openedCount,
      lastOpenedAt: formatDate(tracking.openedAt),
      lastOpenedIP: cleanIP(tracking.lastOpenedIP),
      replied: !!tracking.repliedAt,
      repliedAt: formatDate(tracking.repliedAt),
      openEvents: tracking.openEvents
        ? tracking.openEvents.map((event) => ({
            openedAt: formatDate(event.openedAt),
            ip: cleanIP(event.ip),
            userAgent: event.userAgent,
            sessionId: event.sessionId,
            isMachineOpen: event.isMachineOpen || false,
          }))
        : [],
      uniqueOpens: tracking.openEvents ? tracking.openEvents.length : 0,
      replayCount: tracking.replayCount || 0,
      replayEvents: tracking.replayEvents
        ? tracking.replayEvents.map((event) => ({
            replayedAt: formatDate(event.replayedAt),
            ip: cleanIP(event.ip),
            userAgent: event.userAgent,
            sessionId: event.sessionId,
            isMachineOpen: event.isMachineOpen || false,
          }))
        : [],
      clickEvents: tracking.clickEvents
        ? tracking.clickEvents.map((click) => ({
            url: click.url,
            clickedAt: formatDate(click.clickedAt),
            ip: cleanIP(click.ip),
            userAgent: click.userAgent,
          }))
        : [],
      replyDetails: replyDetailsMap[tracking.messageId] || {
        foundReplies: false,
        replies: [],
        totalReplies: 0,
      },
      createdAt: formatDate(tracking.createdAt),
      updatedAt: formatDate(tracking.updatedAt),
    }));

    res.json({
      success: true,
      count: formattedTrackings.length,
      trackings: formattedTrackings,
    });
  } catch (error) {
    console.error("Batch tracking status error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 7️⃣ Webhook Endpoint for POST Notifications (Legacy)
router.post("/emailtrachwebhook", async (req, res) => {
  try {
    const {
      event,
      trackingId,
      email,
      from,
      subject,
      timestamp,
      ip,
      userAgent,
      openedCount,
      url,
      extractedTrackingData,
      replyDetails,
    } = req.body;

    if (!event || !trackingId) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: event, trackingId",
      });
    }

    console.log(`Webhook received: ${event}`, {
      trackingId,
      email,
      from,
      subject,
      timestamp,
      ip,
      userAgent,
      openedCount,
      url,
      trackingPayload: extractedTrackingData || null,
      replyDetails: replyDetails || null,
    });

    // Log tracking payload separately if present
    if (
      extractedTrackingData &&
      Object.keys(extractedTrackingData).length > 0
    ) {
      console.log("📊 Webhook Tracking Payload:", {
        trackingId,
        event,
        trackingPayload: extractedTrackingData,
      });
    }

    // Log reply details separately if present
    if (replyDetails && event === "replied") {
      console.log("📧 Webhook Reply Details:", {
        trackingId,
        event,
        replyDetails: replyDetails,
      });
    }

    // Optionally, update your database or perform other actions based on the event
    const tracking = await EmailTracking.findOne({ messageId: trackingId });
    if (!tracking) {
      return res
        .status(404)
        .json({ success: false, error: "Tracking record not found" });
    }

    // Update tracking record based on event type
    switch (event) {
      case "opened":
        await EmailTracking.findOneAndUpdate(
          { messageId: trackingId },
          {
            $inc: { openedCount: 1 },
            $set: {
              openedAt: new Date(timestamp),
              lastOpenedIP: ip,
            },
          },
        );
        break;
      case "clicked":
        await EmailTracking.findOneAndUpdate(
          { messageId: trackingId },
          {
            $push: {
              clickEvents: {
                url,
                clickedAt: new Date(timestamp),
                ip,
                userAgent,
              },
            },
          },
        );
        break;
      case "replied":
        await EmailTracking.findOneAndUpdate(
          { messageId: trackingId },
          { $set: { repliedAt: new Date(timestamp) } },
        );
        break;
      case "sent":
        // No additional update needed for sent event
        break;
      default:
        return res
          .status(400)
          .json({ success: false, error: "Invalid event type" });
    }

    // Your UI update logic goes here
    // For example, you could emit a socket event or update a database for frontend polling
    console.log(
      `Processed webhook event: ${event} for trackingId: ${trackingId}`,
    );

    res
      .status(200)
      .json({ success: true, message: "Webhook processed successfully" });
  } catch (error) {
    console.error("Webhook processing error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 8️⃣ New Webhook Endpoint for SMTP Tracking
router.post("/session/smatpTracking", async (req, res) => {
  try {
    const {
      event,
      trackingId,
      email,
      from,
      subject,
      timestamp,
      ip,
      userAgent,
      openedCount,
      url,
      extractedTrackingData,
      replyDetails,
      messageId,
      recipients,
      contentUsed,
      trackingPayload,
      senderName,
      openEvents,
      uniqueOpens,
      clickEvents,
      totalClicks,
      originalMessageId,
      replyCount,
      replayCount,
      replayEvents,
    } = req.body;

    if (!event || !trackingId) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: event, trackingId",
      });
    }

    console.log(`📧 SMTP Tracking Webhook: ${event}`, {
      trackingId,
      email,
      from,
      subject,
      timestamp,
      ip,
      userAgent,
      openedCount,
      url,
      trackingPayload: extractedTrackingData || null,
      replyDetails: replyDetails || null,
      messageId,
      recipients,
      contentUsed,
      senderName,
      openEvents,
      uniqueOpens,
      clickEvents,
      totalClicks,
      originalMessageId,
      replyCount,
      replayCount,
      replayEvents,
    });

    // Log detailed event data
    const detailedEventData = {
      event,
      trackingId,
      email,
      from,
      subject,
      timestamp,
      ip,
      userAgent,
      openedCount,
      url,
      extractedTrackingData,
      replyDetails,
      messageId,
      recipients,
      contentUsed,
      trackingPayload,
      senderName,
      openEvents,
      uniqueOpens,
      clickEvents,
      totalClicks,
      originalMessageId,
      replyCount,
      replayCount,
      replayEvents,
      receivedAt: new Date().toISOString(),
    };

    console.log(
      "📊 Detailed Event Data:",
      JSON.stringify(detailedEventData, null, 2),
    );

    res.status(200).json({
      success: true,
      message: "SMTP tracking webhook processed successfully",
      eventData: detailedEventData,
    });
  } catch (error) {
    console.error("SMTP tracking webhook error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5️⃣ Detailed Email Provider Detection API
router.get("/api/email-provider", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email.includes("@")) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid email format" });
    }

    const domain = email.split("@")[1];
    const smtpSettings = await getSMTPSettings(email);

    // Get detailed MX analysis
    const mxRecords = await cachedMxLookup(domain);
    const sorted = mxRecords.sort((a, b) => a.priority - b.priority);

    // Comprehensive provider detection
    const providerAnalysis = {
      domain: domain,
      mx_records: sorted.map((mx) => ({
        priority: mx.priority,
        exchange: mx.exchange,
        is_self_hosted:
          mx.exchange === domain || mx.exchange.endsWith(`.${domain}`),
        is_google: mx.exchange.includes("google"),
        is_microsoft:
          mx.exchange.includes("outlook") ||
          mx.exchange.includes("hotmail") ||
          mx.exchange.includes("microsoft"),
        is_yahoo: mx.exchange.includes("yahoo"),
        is_cpanel:
          mx.exchange.includes("cpanel") || mx.exchange.includes("whm"),
      })),

      provider_detection: {
        is_google_workspace: sorted.some((mx) =>
          mx.exchange.includes("google"),
        ),
        is_outlook: sorted.some(
          (mx) =>
            mx.exchange.includes("outlook") ||
            mx.exchange.includes("hotmail") ||
            mx.exchange.includes("microsoft"),
        ),
        is_yahoo: sorted.some((mx) => mx.exchange.includes("yahoo")),
        is_cpanel: sorted.some(
          (mx) =>
            mx.exchange.includes("cpanel") ||
            mx.exchange.includes("whm") ||
            mx.exchange === domain ||
            mx.exchange.endsWith(`.${domain}`),
        ),
        is_self_hosted: sorted.some(
          (mx) => mx.exchange === domain || mx.exchange.endsWith(`.${domain}`),
        ),
        is_known_provider: [
          "gmail.com",
          "outlook.com",
          "hotmail.com",
          "yahoo.com",
          "zoho.com",
        ].includes(domain),
      },

      recommended_settings: {
        smtp_host: smtpSettings.host,
        smtp_port: smtpSettings.port,
        imap_host: smtpSettings.host.replace("smtp.", "imap."),
        imap_port: 993,
        secure: smtpSettings.port === 465,
        tls: smtpSettings.port === 587,
      },

      alternative_settings: {
        cpanel_style: {
          smtp_host: `mail.${domain}`,
          smtp_port: 465,
          imap_host: `mail.${domain}`,
          imap_port: 993,
        },
        standard_style: {
          smtp_host: `smtp.${domain}`,
          smtp_port: 587,
          imap_host: `imap.${domain}`,
          imap_port: 993,
        },
      },

      confidence_score: calculateConfidenceScore(sorted, domain),
      recommendations: generateProviderRecommendations(
        sorted,
        domain,
        smtpSettings,
      ),
    };

    return res.json({
      success: true,
      email: email,
      analysis: providerAnalysis,
    });
  } catch (error) {
    console.error("Provider detection error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to analyze email provider",
      details: error.message,
    });
  }
});

// Helper function to calculate confidence score
function calculateConfidenceScore(mxRecords, domain) {
  let score = 0;
  const totalRecords = mxRecords.length;

  if (totalRecords === 0) return 0;

  // Check for known providers
  const hasGoogle = mxRecords.some((mx) => mx.exchange.includes("google"));
  const hasMicrosoft = mxRecords.some(
    (mx) =>
      mx.exchange.includes("outlook") ||
      mx.exchange.includes("hotmail") ||
      mx.exchange.includes("microsoft"),
  );
  const hasYahoo = mxRecords.some((mx) => mx.exchange.includes("yahoo"));
  const isSelfHosted = mxRecords.some(
    (mx) => mx.exchange === domain || mx.exchange.endsWith(`.${domain}`),
  );

  if (hasGoogle) score += 40;
  if (hasMicrosoft) score += 40;
  if (hasYahoo) score += 40;
  if (isSelfHosted) score += 30;

  // Bonus for multiple matching records
  const matchingRecords = mxRecords.filter(
    (mx) =>
      mx.exchange.includes("google") ||
      mx.exchange.includes("outlook") ||
      mx.exchange.includes("hotmail") ||
      mx.exchange.includes("microsoft") ||
      mx.exchange.includes("yahoo") ||
      mx.exchange === domain ||
      mx.exchange.endsWith(`.${domain}`),
  ).length;

  score += (matchingRecords / totalRecords) * 30;

  return Math.min(score, 100);
}

// Helper function to generate provider recommendations
function generateProviderRecommendations(mxRecords, domain, smtpSettings) {
  const recommendations = [];

  const isGoogle = mxRecords.some((mx) => mx.exchange.includes("google"));
  const isMicrosoft = mxRecords.some(
    (mx) =>
      mx.exchange.includes("outlook") ||
      mx.exchange.includes("hotmail") ||
      mx.exchange.includes("microsoft"),
  );
  const isSelfHosted = mxRecords.some(
    (mx) => mx.exchange === domain || mx.exchange.endsWith(`.${domain}`),
  );

  if (isGoogle) {
    recommendations.push({
      type: "primary",
      provider: "Google Workspace",
      settings: {
        smtp_host: "smtp.gmail.com",
        smtp_port: 587,
        imap_host: "imap.gmail.com",
        imap_port: 993,
        auth_method: "OAuth2 or App Password",
        security: "TLS",
      },
    });
  }

  if (isMicrosoft) {
    recommendations.push({
      type: "primary",
      provider: "Microsoft 365/Outlook",
      settings: {
        smtp_host: "smtp-mail.outlook.com",
        smtp_port: 587,
        imap_host: "outlook.office365.com",
        imap_port: 993,
        auth_method: "OAuth2 or App Password",
        security: "TLS",
      },
    });
  }

  if (isSelfHosted) {
    recommendations.push({
      type: "primary",
      provider: "Self-hosted (cPanel/WHM)",
      settings: {
        smtp_host: `mail.${domain}`,
        smtp_port: 465,
        imap_host: `mail.${domain}`,
        imap_port: 993,
        auth_method: "Username/Password",
        security: "SSL",
      },
    });
  }

  // Fallback recommendations
  if (!isGoogle && !isMicrosoft && !isSelfHosted) {
    recommendations.push({
      type: "fallback",
      provider: "Generic SMTP",
      settings: {
        smtp_host: `smtp.${domain}`,
        smtp_port: 587,
        imap_host: `imap.${domain}`,
        imap_port: 993,
        auth_method: "Username/Password",
        security: "TLS",
      },
    });

    recommendations.push({
      type: "fallback",
      provider: "cPanel Style",
      settings: {
        smtp_host: `mail.${domain}`,
        smtp_port: 465,
        imap_host: `mail.${domain}`,
        imap_port: 993,
        auth_method: "Username/Password",
        security: "SSL",
      },
    });
  }

  return recommendations;
}

/**
 * Reusable function to get SMTP settings for an email
 * @param {string} email - The email address to get SMTP settings for
 * @returns {Promise<Object>} - SMTP settings object
 */
async function getSMTPSettingsForEmail(email) {
  if (!email) {
    throw new Error("Email is required");
  }

  console.log(`🔍 Getting SMTP settings for: ${email}`);

  // Try cPanel API first
  try {
    const cpanelResponse = await cpanelRequest("Email/get_client_settings", {
      account: email,
    });

    if (
      cpanelResponse &&
      cpanelResponse.data &&
      cpanelResponse.data.smtp_host &&
      cpanelResponse.data.smtp_port
    ) {
      const smtpData = cpanelResponse.data;

      console.log(`✅ cPanel API success for ${email}:`, {
        host: smtpData.smtp_host,
        port: smtpData.smtp_port,
      });

      return {
        success: true,
        email: email,
        smtp: {
          smtp_host: smtpData.smtp_host,
          smtp_port: parseInt(smtpData.smtp_port) || 465,
          smtp_username: smtpData.smtp_username,
        },
        imap: {
          inbox_host: smtpData.inbox_host,
          inbox_port: smtpData.inbox_port,
          inbox_username: smtpData.inbox_username,
          inbox_service: smtpData.inbox_service,
          mail_domain: smtpData.mail_domain,
        },
        domain: smtpData.domain,
        account: smtpData.account,
        display: smtpData.display,
        source: "cPanel API",
      };
    } else {
      console.log(
        `❌ cPanel API response missing SMTP settings for ${email}:`,
        cpanelResponse,
      );
    }
  } catch (cpanelError) {
    console.log(`❌ cPanel API failed for ${email}:`, cpanelError.message);
  }

  // Fallback to DNS lookup
  try {
    const domain = email.split("@")[1].toLowerCase();
    const mxRecords = await cachedMxLookup(domain);

    console.log(`🔍 DNS MX lookup for domain: ${domain}`);

    // Use existing logic to determine SMTP settings
    const smtpSettings = await getSMTPSettings(email);

    return {
      success: true,
      email: email,
      host: smtpSettings.host,
      port: smtpSettings.port,
      source: "DNS MX Lookup",
    };
  } catch (dnsError) {
    console.log(`❌ DNS lookup failed for ${email}:`, dnsError.message);

    throw new Error("Could not determine SMTP settings");
  }
}

// Start periodic reply checking
setInterval(checkForReplies, 2 * 60 * 1000);

//___________________get smpt host & port cpanl API_____

// New API endpoint to get SMTP settings from cPanel API
router.post("/api/get-smtphost", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    const smtpSettings = await getSMTPSettingsForEmail(email);

    return res.json(smtpSettings);
  } catch (error) {
    console.error("Get SMTP Settings Error:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

//___________________delete SMTP config API_____

router.delete("/api/delete-smtpconfig", async (req, res) => {
  try {
    const { email, token } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    // If token is provided, verify it matches the email
    if (token) {
      const smtpRecord = await SMTPAuth.findOne({ email, token });
      if (!smtpRecord) {
        return res.status(403).json({
          success: false,
          error: "Invalid token or email not found",
        });
      }
    }

    // Delete the SMTP configuration
    const deletedRecord = await SMTPAuth.findOneAndDelete({ email });

    if (!deletedRecord) {
      return res.status(404).json({
        success: false,
        error: "SMTP configuration not found for this email",
      });
    }

    console.log(`✅ SMTP config deleted for: ${email}`);

    return res.json({
      success: true,
      message: `SMTP configuration deleted successfully for ${email}`,
      deletedEmail: email,
      deletedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Delete SMTP Config Error:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.post("/api/fetchcalendar", async (req, res) => {
  try {
    const { token, email, provider, rangeStart, rangeEnd } = req.body;
    if (!token || !email) {
      return res
        .status(400)
        .json({ success: false, error: "Missing token or email" });
    }

    const smtp = await SMTPAuth.findOne({ email, token });
    if (!smtp) {
      return res
        .status(403)
        .json({ success: false, error: "Invalid token or sender email" });
    }

    const domain = email.split("@")[1].toLowerCase();
    const now = new Date();
    const start = rangeStart
      ? new Date(rangeStart)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = rangeEnd
      ? new Date(rangeEnd)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0);

    let events = [];

    // 1️⃣ Google Workspace / Gmail ICS Feed
    if (domain.includes("gmail") || domain.includes("google")) {
      try {
        const googleFeedUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(
          email,
        )}/public/basic.ics`;
        const response = await fetch(googleFeedUrl);
        const icsData = await response.text();
        const icalExpander = new IcalExpander({
          ics: icsData,
          maxIterations: 1000,
        });
        const expanded = icalExpander.between(start, end);

        events = [
          ...expanded.events.map((e) => ({
            eventId: e.uid,
            summary: e.summary,
            description: e.description,
            location: e.location,
            start: e.startDate.toJSDate(),
            end: e.endDate.toJSDate(),
            attendees: e.attendee
              ? Array.isArray(e.attendee)
                ? e.attendee
                : [e.attendee]
              : [],
          })),
          ...expanded.occurrences.map((o) => ({
            eventId: o.item.uid,
            summary: o.item.summary,
            description: o.item.description,
            location: o.item.location,
            start: o.startDate.toJSDate(),
            end: o.endDate.toJSDate(),
            attendees: o.item.attendee
              ? Array.isArray(o.item.attendee)
                ? o.item.attendee
                : [o.item.attendee]
              : [],
          })),
        ];
      } catch (err) {
        console.log("Google calendar fetch failed:", err.message);
      }
    }

    // 2️⃣ Outlook / Microsoft 365 ICS (via autodiscover)
    else if (
      domain.includes("outlook") ||
      domain.includes("hotmail") ||
      domain.includes("microsoft")
    ) {
      try {
        const outlookFeedUrl = `https://outlook.office365.com/owa/calendar/${encodeURIComponent(
          email,
        )}/calendar.ics`;
        let authHeader;
        if (smtp.authType === "oauth2") {
          const accessToken = await getValidAccessToken(smtp);
          authHeader = `Bearer ${accessToken}`;
        } else {
          const decryptedPass = decrypt(smtp.pass);
          authHeader =
            "Basic " +
            Buffer.from(`${email}:${decryptedPass}`).toString("base64");
        }
        const response = await fetch(outlookFeedUrl, {
          headers: { Authorization: authHeader },
        });
        const icsData = await response.text();
        const icalExpander = new IcalExpander({
          ics: icsData,
          maxIterations: 1000,
        });
        const expanded = icalExpander.between(start, end);

        events = events.concat(
          expanded.events.map((e) => ({
            eventId: e.uid,
            summary: e.summary,
            description: e.description,
            start: e.startDate.toJSDate(),
            end: e.endDate.toJSDate(),
            attendees: e.attendee
              ? Array.isArray(e.attendee)
                ? e.attendee
                : [e.attendee]
              : [],
          })),
        );
      } catch (err) {
        console.log("Outlook calendar fetch failed:", err.message);
      }
    }

    // 3️⃣ Self-hosted / cPanel Calendar via IMAP ICS attachment
    else {
      try {
        const imapAuth = await getAuthForIMAP(smtp, email);
        const client = new ImapFlow({
          host: getImapHost(smtp.host, email, smtp.oauth2?.provider),
          port: 993,
          secure: true,
          auth: imapAuth,
          logger: false,
        });
        await client.connect();
        await client
          .mailboxOpen("Calendar")
          .catch(() => client.mailboxOpen("INBOX")); // fallback

        for await (let msg of client.fetch("1:*", { source: true })) {
          const parsed = await simpleParser(msg.source);
          if (parsed.attachments && parsed.attachments.length > 0) {
            for (const att of parsed.attachments) {
              if (
                att.contentType.includes("calendar") ||
                att.filename.endsWith(".ics")
              ) {
                const icalExpander = new IcalExpander({
                  ics: att.content.toString(),
                  maxIterations: 100,
                });
                const expanded = icalExpander.between(start, end);
                events.push(
                  ...expanded.events.map((e) => ({
                    eventId: e.uid,
                    summary: e.summary,
                    description: e.description,
                    start: e.startDate.toJSDate(),
                    end: e.endDate.toJSDate(),
                    attendees: e.attendee
                      ? Array.isArray(e.attendee)
                        ? e.attendee
                        : [e.attendee]
                      : [],
                  })),
                );
              }
            }
          }
        }
        await client.logout();
      } catch (err) {
        console.log("Self-hosted calendar fetch failed:", err.message);
      }
    }

    return res.json({
      success: true,
      provider: domain,
      range: { start, end },
      totalEvents: events.length,
      events: events.sort((a, b) => new Date(a.start) - new Date(b.start)),
    });
  } catch (error) {
    console.error("Calendar Fetch Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/api/fetchsent", async (req, res) => {
  let client;
  try {
    const { token, email, page = 1, limit = 20 } = req.body;
    if (!token || !email) {
      return res
        .status(400)
        .json({ success: false, error: "Missing token or email" });
    }

    const smtp = await SMTPAuth.findOne({ email, token });
    if (!smtp) {
      return res
        .status(403)
        .json({ success: false, error: "Invalid token or sender email" });
    }

    // Check if this is a Microsoft OAuth2 account - use Graph API for fetching sent items
    if (smtp.authType === "oauth2" && smtp.oauth2?.provider === "microsoft") {
      try {
        const accessToken = await getValidAccessToken(smtp);
        const limitInt = parseInt(limit) || 20;
        const pageInt = parseInt(page) || 1;
        const skip = (pageInt - 1) * limitInt;

        const messages = await fetchInboxViaGraph(
          accessToken,
          "SentItems", // ✅ Microsoft Graph folder for sent items
          limitInt,
          skip,
        );

        return res.json({
          success: true,
          mailbox: "Sent Items (Graph API)",
          sent: messages,
          pagination: {
            currentPage: pageInt,
            totalPages: Math.ceil(messages.length / limitInt),
            totalMessages: messages.length,
            limit: limitInt,
            hasNextPage: messages.length === limitInt,
            hasPrevPage: pageInt > 1,
          },
        });
      } catch (err) {
        console.error("Graph Sent Fetch Error:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    // For non-Microsoft accounts, continue with existing IMAP code...
    const imapAuth = await getAuthForIMAP(smtp, email);

    client = new ImapFlow({
      host: getImapHost(smtp.host, email, smtp.oauth2?.provider), // Use IMAP host, not SMTP
      port: 993,
      secure: true,
      auth: imapAuth,
      logger: false,
      timeout: 30000, // Add timeout to prevent hanging
    });

    await client.connect();

    // Try common Sent mailbox names across providers
    const candidateMailboxes = [
      "[Gmail]/Sent Mail", // Gmail
      "Sent Mail",
      "Sent Items", // Outlook / Microsoft 365
      "Sent", // cPanel/self-hosted
      "Sent Messages",
      "INBOX.Sent",
    ];

    let selectedBox = null;
    for (const box of candidateMailboxes) {
      try {
        const lock = await client.mailboxOpen(box);
        if (lock && typeof lock.exists === "number") {
          selectedBox = { name: box, lock };
          console.log(
            `Found sent mailbox: ${box} with ${lock.exists} messages`,
          );
          break;
        }
      } catch (error) {
        console.log(`Mailbox ${box} not found: ${error.message}`);
        // continue trying next mailbox
      }
    }

    if (!selectedBox) {
      // As a last resort, list mailboxes and try first containing 'Sent'
      try {
        for await (let mailbox of client.list()) {
          if (/sent/i.test(mailbox.name)) {
            try {
              const lock = await client.mailboxOpen(mailbox.name);
              selectedBox = { name: mailbox.name, lock };
              console.log(
                `Found sent mailbox via listing: ${mailbox.name} with ${lock.exists} messages`,
              );
              break;
            } catch (error) {
              console.log(`Mailbox ${mailbox.name} failed: ${error.message}`);
            }
          }
        }
      } catch (error) {
        console.log("Mailbox listing failed:", error.message);
      }
    }

    if (!selectedBox) {
      await client.logout();
      return res.json({
        success: true,
        mailbox: null,
        sent: [],
        pagination: {
          currentPage: 1,
          totalPages: 0,
          totalMessages: 0,
          limit: Math.min(limit, 50),
          hasNextPage: false,
          hasPrevPage: false,
        },
        message: "No sent mailbox found or sent mailbox is empty",
      });
    }

    const totalMessages = selectedBox.lock.exists;
    const maxLimit = Math.min(limit, 50);
    const currentPage = Math.max(parseInt(page), 1);

    // Fix: Handle empty mailbox case
    if (totalMessages === 0) {
      await client.logout();
      return res.json({
        success: true,
        mailbox: selectedBox.name,
        sent: [],
        pagination: {
          currentPage: 1,
          totalPages: 0,
          totalMessages: 0,
          limit: maxLimit,
          hasNextPage: false,
          hasPrevPage: false,
        },
      });
    }

    const totalPages = Math.ceil(totalMessages / maxLimit);

    // Fix: Calculate sequence numbers correctly (IMAP is 1-based)
    const startSeq = Math.max(totalMessages - currentPage * maxLimit + 1, 1);
    const endSeq = Math.max(totalMessages - (currentPage - 1) * maxLimit, 1);

    console.log(
      `Fetching sent messages ${startSeq}:${endSeq} (Page ${currentPage}, Total: ${totalMessages})`,
    );

    const messages = [];

    if (startSeq <= endSeq && startSeq >= 1 && endSeq >= 1) {
      try {
        for await (let msg of client.fetch(`${startSeq}:${endSeq}`, {
          envelope: true,
          uid: true,
          flags: true,
          source: true,
          bodyStructure: true,
        })) {
          try {
            const parsed = await simpleParser(msg.source);

            // Clean HTML content
            let cleanHtml = parsed.html || "";
            if (cleanHtml) {
              cleanHtml = cleanHtml.replace(
                /https:\/\/tracking\.inflection\.io\/[^"]+/g,
                (url) => {
                  try {
                    const urlObj = new URL(url);
                    const redirect = urlObj.searchParams.get("redirect");
                    return redirect || url;
                  } catch {
                    return url;
                  }
                },
              );

              cleanHtml = cleanHtml.replace(
                /<span[^>]*id="inflection-email-preheader"[^>]*>.*?<\/span>/gis,
                "",
              );
            }

            // Extract clean text
            let cleanText = parsed.text || "";
            if (cleanText) {
              cleanText = cleanText.replace(
                /https:\/\/tracking\.inflection\.io\/[^\s]+/g,
                "",
              );
            }

            // FIXED: Proper read status detection for different flag types
            let isRead = false;
            let flagsArray = [];

            // Handle different types of flags object
            if (msg.flags) {
              if (Array.isArray(msg.flags)) {
                flagsArray = msg.flags;
                isRead =
                  flagsArray.includes("\\Seen") || flagsArray.includes("Seen");
              } else if (msg.flags instanceof Set) {
                flagsArray = Array.from(msg.flags);
                isRead =
                  flagsArray.includes("\\Seen") || flagsArray.includes("Seen");
              } else if (typeof msg.flags === "object") {
                // Convert object to array of keys
                flagsArray = Object.keys(msg.flags);
                isRead =
                  flagsArray.includes("\\Seen") || flagsArray.includes("Seen");
              }
            }

            console.log(
              `Message ${msg.uid} - Flags:`,
              flagsArray,
              "Read:",
              isRead,
            );

            messages.push({
              subject: msg.envelope.subject || "(No Subject)",
              from:
                msg.envelope.from
                  ?.map((f) => `${f.name || ""} <${f.address}>`)
                  .join(", ") || email,
              date: msg.envelope.date || new Date(),
              uid: msg.uid,
              seq: msg.seq,
              read: isRead,
              flags: flagsArray, // Store as array for consistency
              text: cleanText,
              html: cleanHtml,
              to:
                msg.envelope.to
                  ?.map((t) => `${t.name || ""} <${t.address}>`)
                  .join(", ") || "",
              cc:
                msg.envelope.cc
                  ?.map((c) => `${c.name || ""} <${c.address}>`)
                  .join(", ") || "",
              bcc:
                msg.envelope.bcc
                  ?.map((b) => `${b.name || ""} <${b.address}>`)
                  .join(", ") || "",
              messageId: msg.envelope.messageId,
              inReplyTo: msg.envelope.inReplyTo,
              references: msg.envelope.references,
            });
          } catch (parseError) {
            console.error("Error parsing message:", parseError);
            // Continue with next message even if one fails
          }
        }
      } catch (fetchError) {
        console.error("Fetch error:", fetchError);
        // Return empty messages but don't fail the entire request
      }
    }

    await client.logout();

    const sortedMessages = messages.reverse();

    return res.json({
      success: true,
      mailbox: selectedBox.name,
      sent: sortedMessages,
      pagination: {
        currentPage,
        totalPages,
        totalMessages,
        limit: maxLimit,
        hasNextPage: currentPage < totalPages,
        hasPrevPage: currentPage > 1,
      },
    });
  } catch (err) {
    console.error("Sent Fetch Error:", err);

    // Ensure client is properly closed even on error
    if (client) {
      try {
        await client.logout();
      } catch (logoutError) {
        console.error("Error during logout:", logoutError);
      }
    }

    return res.status(500).json({
      success: false,
      error: err.message,
      details:
        "Failed to fetch sent emails. Please check your credentials and try again.",
    });
  }
});

// 🔟 Fetch Full Conversation (Sent Email + Replies)
router.post("/api/fetch-conversation", async (req, res) => {
  let client;
  try {
    const { token, email, messageId } = req.body;

    // 1. Validation
    if (!token || !email || !messageId) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: token, email, messageId",
      });
    }

    // 2. Auth Lookup
    const smtp = await SMTPAuth.findOne({ email, token });
    if (!smtp) {
      return res
        .status(403)
        .json({ success: false, error: "Invalid token or sender email" });
    }

    // 3. Get auth credentials
    const imapAuth = await getAuthForIMAP(smtp, email);

    // 4. Initialize IMAP Client
    client = new ImapFlow({
      host: getImapHost(smtp.host, email, smtp.oauth2?.provider),
      port: 993,
      secure: true,
      auth: imapAuth,
      logger: false,
      timeout: 30000,
    });

    await client.connect();

    // --- STEP A: Fetch the Original Sent Email ---
    let originalEmail = null;

    // Identify Sent Mailbox
    const candidateSentBoxes = [
      "[Gmail]/Sent Mail",
      "Sent Mail",
      "Sent Items",
      "Sent",
      "INBOX.Sent",
    ];
    let sentBoxName = null;

    for (const box of candidateSentBoxes) {
      try {
        const lock = await client.mailboxOpen(box);
        if (lock) {
          sentBoxName = box;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (sentBoxName) {
      // Search for the specific Message-ID in Sent
      const sentResult = await client.search({
        header: { "Message-ID": messageId },
      });

      if (sentResult.length > 0) {
        for await (let msg of client.fetch(sentResult[0], {
          envelope: true,
          source: true,
          flags: true,
          uid: true,
        })) {
          const parsed = await simpleParser(msg.source);
          originalEmail = {
            type: "sent",
            subject: msg.envelope.subject,
            from: msg.envelope.from.map((f) => f.address).join(", "),
            to: msg.envelope.to.map((t) => t.address).join(", "),
            date: msg.envelope.date,
            html: parsed.html || parsed.textAsHtml,
            text: parsed.text,
            messageId: msg.envelope.messageId,
            uid: msg.uid,
          };
          break;
        }
      }
    }

    // --- STEP B: Fetch Replies from Inbox ---
    await client.mailboxOpen("INBOX");

    // Search for messages referencing the original Message-ID
    // We search both In-Reply-To and References to catch all threads
    const replyIds = await client.search({
      or: [
        { header: { "In-Reply-To": messageId } },
        { header: { References: messageId } },
      ],
    });

    const replies = [];

    if (replyIds.length > 0) {
      for await (let msg of client.fetch(replyIds, {
        envelope: true,
        source: true,
        flags: true,
        uid: true,
      })) {
        const parsed = await simpleParser(msg.source);
        const flags = Array.isArray(msg.flags) ? msg.flags : [];

        replies.push({
          type: "reply",
          subject: msg.envelope.subject,
          from: msg.envelope.from.map((f) => f.address).join(", "),
          to: msg.envelope.to.map((t) => t.address).join(", "),
          date: msg.envelope.date,
          html: parsed.html || parsed.textAsHtml,
          text: parsed.text,
          messageId: msg.envelope.messageId,
          isRead: flags.includes("\\Seen") || flags.includes("Seen"),
          uid: msg.uid,
        });
      }
    }

    await client.logout();

    // 5. Sort replies by date (oldest to newest)
    replies.sort((a, b) => new Date(a.date) - new Date(b.date));

    // 6. Return Data
    return res.json({
      success: true,
      threadId: messageId, // Using the original MessageID as the thread identifier
      conversation: {
        original: originalEmail || {
          error:
            "Original sent email not found (might be deleted or not in standard Sent folder)",
        },
        replies: replies,
      },
      replyCount: replies.length,
    });
  } catch (error) {
    console.error("Fetch Conversation Error:", error);
    if (client) client.close().catch(() => {});
    return res.status(500).json({ success: false, error: error.message });
  }
});

// 🧵 Fetch Email Thread (Sent Email + Replies) by MessageId
// This API fetches the original sent email and all replies using the messageId stored client-side
router.post("/api/fetch-email-thread", async (req, res) => {
  let client;
  try {
    const { token, email, messageId } = req.body;

    console.log(`📧 [FetchThread] START request for messageId: ${messageId}`);

    // 1. Validation
    if (!token || !email || !messageId) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: token, email, messageId",
      });
    }

    // 2. Auth Lookup
    const smtp = await SMTPAuth.findOne({ email, token });
    if (!smtp) {
      return res
        .status(403)
        .json({ success: false, error: "Invalid token or sender email" });
    }

    // 3. Get auth credentials
    const imapAuth = await getAuthForIMAP(smtp, email);

    // 4. Initialize IMAP Client
    client = new ImapFlow({
      host: getImapHost(smtp.host, email, smtp.oauth2?.provider),
      port: 993,
      secure: true,
      auth: imapAuth,
      logger: false,
      timeout: 45000,
    });

    await client.connect();
    console.log(`✅ [FetchThread] IMAP connected`);

    // --- STEP A: Fetch the Original Sent Email ---
    let originalEmail = null;

    // Try common sent mailbox locations
    const candidateSentBoxes = [
      "[Gmail]/Sent Mail",
      "Sent Mail",
      "Sent Items",
      "Sent",
      "INBOX.Sent",
    ];
    let sentBoxName = null;

    for (const box of candidateSentBoxes) {
      try {
        const lock = await client.mailboxOpen(box);
        if (lock) {
          console.log(`📂 [FetchThread] Opened sent mailbox: ${box}`);
          sentBoxName = box;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (sentBoxName) {
      // Search for the specific Message-ID in Sent folder
      const sentResult = await client.search({
        header: { "Message-ID": messageId },
      });
      console.log(
        `🔍 [FetchThread] Search in ${sentBoxName} found ${sentResult.length} message(s)`,
      );

      if (sentResult.length > 0) {
        for await (let msg of client.fetch(sentResult.slice(0, 1), {
          envelope: true,
          source: true,
          flags: true,
          uid: true,
        })) {
          const parsed = await simpleParser(msg.source);

          // Process attachments
          let attachments = [];
          if (parsed.attachments && Array.isArray(parsed.attachments)) {
            attachments = parsed.attachments.map((att) => ({
              filename: att.filename || "unnamed_attachment",
              contentType: att.contentType || "application/octet-stream",
              size: att.size || 0,
              contentId: att.contentId || null,
            }));
          }

          originalEmail = {
            type: "sent",
            subject: msg.envelope.subject,
            from: msg.envelope.from
              ? msg.envelope.from.map((f) => ({
                  name: f.name || "",
                  address: f.address,
                }))
              : [],
            to: msg.envelope.to
              ? msg.envelope.to.map((t) => ({
                  name: t.name || "",
                  address: t.address,
                }))
              : [],
            cc: msg.envelope.cc
              ? msg.envelope.cc.map((c) => ({
                  name: c.name || "",
                  address: c.address,
                }))
              : [],
            date: msg.envelope.date,
            html: parsed.html || parsed.textAsHtml || "",
            text: parsed.text || "",
            messageId: msg.envelope.messageId,
            uid: msg.uid,
            attachments: attachments,
            hasAttachments: attachments.length > 0,
          };

          console.log(
            `✅ [FetchThread] Original email found: "${msg.envelope.subject}"`,
          );
          break;
        }
      }
    }

    // Fallback: If original email not found in Sent folder, get from EmailTracking database
    if (!originalEmail) {
      console.log(
        `📧 [FetchThread] Original email not in Sent folder, checking tracking database...`,
      );

      // Search by originalMessageId (the full Message-ID) or by messageId (tracking ID)
      let tracking = await EmailTracking.findOne({
        originalMessageId: messageId,
      });

      // Also try searching by the tracking messageId field
      if (!tracking) {
        // Extract tracking ID from messageId if it follows our format: <trackingId@domain>
        const trackingIdMatch = messageId.match(/<([^@]+)@/);
        if (trackingIdMatch) {
          tracking = await EmailTracking.findOne({
            messageId: trackingIdMatch[1],
          });
        }
      }

      if (tracking && tracking.emailContent) {
        console.log(
          `✅ [FetchThread] Found original email in tracking database`,
        );
        originalEmail = {
          type: "sent",
          subject: tracking.subject,
          from: [{ name: "", address: tracking.fromEmail }],
          to: [{ name: "", address: tracking.toEmail }],
          cc: [],
          date: tracking.sentAt || tracking.createdAt,
          html: tracking.emailContent.html || "",
          text: tracking.emailContent.text || "",
          messageId: tracking.originalMessageId,
          uid: null,
          attachments: [],
          hasAttachments: false,
        };
      } else {
        console.log(
          `⚠️ [FetchThread] Original email not found in tracking database either`,
        );
      }
    }

    // --- STEP B: Fetch Replies from Inbox ---
    await client.mailboxOpen("INBOX");
    console.log(`📂 [FetchThread] Opened INBOX for replies search`);

    // Search for messages referencing the original Message-ID
    let replyIds = [];

    try {
      // Method 1: Search by In-Reply-To header
      const inReplyToIds = await client.search({
        header: { "In-Reply-To": messageId },
      });
      replyIds = [...replyIds, ...inReplyToIds];
      console.log(
        `🔍 [FetchThread] In-Reply-To search found ${inReplyToIds.length} message(s)`,
      );
    } catch (e) {
      console.log(`⚠️ [FetchThread] In-Reply-To search failed:`, e.message);
    }

    try {
      // Method 2: Search by References header
      const referencesIds = await client.search({
        header: { References: messageId },
      });
      // Add only unique IDs
      for (const id of referencesIds) {
        if (!replyIds.includes(id)) {
          replyIds.push(id);
        }
      }
      console.log(
        `🔍 [FetchThread] References search found ${referencesIds.length} message(s)`,
      );
    } catch (e) {
      console.log(`⚠️ [FetchThread] References search failed:`, e.message);
    }

    const replies = [];

    if (replyIds.length > 0) {
      console.log(
        `📧 [FetchThread] Fetching ${replyIds.length} reply message(s)`,
      );

      for await (let msg of client.fetch(replyIds, {
        envelope: true,
        source: true,
        flags: true,
        uid: true,
      })) {
        const parsed = await simpleParser(msg.source);
        const flags = Array.isArray(msg.flags) ? msg.flags : [];
        const isRead = flags.includes("\\Seen") || flags.includes("Seen");

        // Process attachments
        let attachments = [];
        if (parsed.attachments && Array.isArray(parsed.attachments)) {
          attachments = parsed.attachments.map((att) => ({
            filename: att.filename || "unnamed_attachment",
            contentType: att.contentType || "application/octet-stream",
            size: att.size || 0,
            contentId: att.contentId || null,
          }));
        }

        replies.push({
          type: "reply",
          subject: msg.envelope.subject || "(No Subject)",
          from: msg.envelope.from
            ? msg.envelope.from.map((f) => ({
                name: f.name || "",
                address: f.address,
              }))
            : [],
          to: msg.envelope.to
            ? msg.envelope.to.map((t) => ({
                name: t.name || "",
                address: t.address,
              }))
            : [],
          cc: msg.envelope.cc
            ? msg.envelope.cc.map((c) => ({
                name: c.name || "",
                address: c.address,
              }))
            : [],
          date: msg.envelope.date,
          html: parsed.html || parsed.textAsHtml || "",
          text: parsed.text || "",
          messageId: msg.envelope.messageId,
          inReplyTo: parsed.inReplyTo,
          references: parsed.references,
          isRead: isRead,
          uid: msg.uid,
          attachments: attachments,
          hasAttachments: attachments.length > 0,
        });
      }
    }

    // Logout IMAP client
    try {
      await client.logout();
      console.log(`🔒 [FetchThread] IMAP connection closed`);
    } catch (logoutErr) {
      console.log(`⚠️ [FetchThread] Logout warning:`, logoutErr.message);
      try {
        client.close();
      } catch (e) {}
    }
    client = null;

    // Sort replies by date (oldest to newest)
    replies.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Build the complete thread (original + replies in chronological order)
    const thread = [];

    if (originalEmail) {
      thread.push(originalEmail);
    }

    thread.push(...replies);

    console.log(
      `✅ [FetchThread] SUCCESS - Thread has ${thread.length} message(s) (1 original + ${replies.length} replies)`,
    );

    // Return the complete thread with better naming
    return res.json({
      success: true,
      threadId: messageId,
      conversation: {
        originalSentEmail: originalEmail || null,
        replies: replies,
      },
      threadSummary: {
        totalMessages: thread.length,
        originalEmailSubject: originalEmail ? originalEmail.subject : null,
        sender: originalEmail ? originalEmail.from : null,
        recipient: originalEmail ? originalEmail.to : null,
        sentDate: originalEmail ? originalEmail.date : null,
        replyCount: replies.length,
        hasReplies: replies.length > 0,
        lastReplyDate:
          replies.length > 0 ? replies[replies.length - 1].date : null,
        lastReplyFrom:
          replies.length > 0 ? replies[replies.length - 1].from : null,
      },
    });
  } catch (error) {
    console.error("❌ [FetchThread] Error:", error);

    // Cleanup IMAP connection
    if (client) {
      try {
        await client.close();
      } catch (e) {}
    }

    return res.status(500).json({
      success: false,
      error: error.message,
      details:
        "Failed to fetch email thread. Please check your credentials and try again.",
    });
  }
});

// ─── Microsoft OAuth2 Endpoints ───────────────────────────────

// Detect email provider
router.get("/api/auth/detect-provider", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email || !email.includes("@")) {
      return res.status(400).json({
        success: false,
        error: "Invalid or missing email parameter",
      });
    }

    const provider = await detectProvider(email);
    const smtpSettings = await getSMTPSettings(email);
    const requiresOAuth = provider === "microsoft";
    const baseUrl = (
      process.env.BASE_URL || "https://videoresponse.onepgr.com:3001"
    ).replace(/\/api\/?$/, "");

    return res.json({
      success: true,
      email,
      provider,
      requiresOAuth,
      authMethod: requiresOAuth ? "oauth2" : "password",
      oauthUrl: requiresOAuth
        ? `${baseUrl}/api/auth/microsoft/authorize?email=${encodeURIComponent(email)}`
        : null,
      smtpSettings,
    });
  } catch (error) {
    console.error("Provider detection error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Microsoft OAuth2 authorization redirect
router.get("/api/auth/microsoft/authorize", (req, res) => {
  const { email, frontend } = req.query;

  if (!email) {
    return res.status(400).json({
      success: false,
      error: "Missing email parameter",
    });
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({
      success: false,
      error: "Microsoft OAuth not configured (missing MICROSOFT_CLIENT_ID)",
    });
  }

  const redirectUri =
    process.env.MICROSOFT_REDIRECT_URI ||
    `${(process.env.BASE_URL || "https://videoresponse.onepgr.com:3001").replace(/\/api\/?$/, "")}/api/auth/microsoft/callback`;

  // Include frontend URL in state for callback
  const stateData = {
    email,
    frontend:
      frontend || process.env.FRONTEND_URL || "https://liame.onepgr.com",
  };
  const state = Buffer.from(JSON.stringify(stateData)).toString("base64");

  // Graph API scopes only — user-consentable in the default state of most tenants.
  // IMAP.AccessAsUser.All / SMTP.Send were removed: they require admin consent
  // and are not used by the code (send/fetch both go through Graph API).
  const scopes = [
    "offline_access",
    "https://graph.microsoft.com/User.Read",
    "https://graph.microsoft.com/Mail.Read",
    "https://graph.microsoft.com/Mail.Send",
  ].join(" ");

  const authUrl =
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
    `client_id=${encodeURIComponent(clientId)}&` +
    `response_type=code&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_mode=query&` +
    `scope=${encodeURIComponent(scopes)}&` +
    `state=${encodeURIComponent(state)}&` +
    `login_hint=${encodeURIComponent(email)}&` +
    `prompt=login`;

  console.log(
    `Redirecting ${email} to Microsoft OAuth consent screen (frontend: ${stateData.frontend})`,
  );
  res.redirect(authUrl);
});

// Microsoft admin-consent endpoint
// Tenant admin visits this URL once → approves app for all users in their org
// Usage: /api/auth/microsoft/admin-consent?frontend=https://liame.onepgr.com
router.get("/api/auth/microsoft/admin-consent", (req, res) => {
  const { frontend } = req.query;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) {
    return res
      .status(500)
      .json({ success: false, error: "Microsoft OAuth not configured" });
  }

  const redirectUri =
    process.env.MICROSOFT_ADMIN_CONSENT_REDIRECT_URI ||
    `${(process.env.BASE_URL || "https://videoresponse.onepgr.com:3001").replace(/\/api\/?$/, "")}/api/auth/microsoft/admin-consent/callback`;

  const state = Buffer.from(
    JSON.stringify({
      frontend:
        frontend || process.env.FRONTEND_URL || "https://liame.onepgr.com",
    }),
  ).toString("base64");

  // /common/adminconsent lets the admin approve for their specific tenant
  const consentUrl =
    `https://login.microsoftonline.com/common/adminconsent?` +
    `client_id=${encodeURIComponent(clientId)}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `state=${encodeURIComponent(state)}`;

  console.log(`🔐 Redirecting to Microsoft admin consent screen`);
  res.redirect(consentUrl);
});

// Microsoft admin-consent callback
// Admin consent is tenant pre-approval only — no user token, no account creation.
// After admin approves, individual users run the normal OAuth flow which now passes.
router.get("/api/auth/microsoft/admin-consent/callback", (req, res) => {
  const { admin_consent, tenant, error, error_description } = req.query;

  if (error) {
    console.error("Microsoft admin consent error:", error, error_description);
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Admin Consent Failed</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                 display: flex; justify-content: center; align-items: center; height: 100vh;
                 margin: 0; background: #f5f5f5; }
          .card { background: white; padding: 40px; border-radius: 12px;
                  box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 500px; }
          h1 { color: #dc2626; }
          p { color: #666; line-height: 1.5; }
        </style>
        </head>
        <body>
          <div class="card">
            <h1>❌ Admin Consent Failed</h1>
            <p>${error_description || error}</p>
            <p style="font-size:13px;color:#999;">Please try again or contact support.</p>
          </div>
        </body>
      </html>
    `);
  }

  if (admin_consent === "True") {
    console.log(`✅ Admin consent granted for tenant: ${tenant}`);
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Admin Consent Successful</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                 display: flex; justify-content: center; align-items: center; height: 100vh;
                 margin: 0; background: #f5f5f5; }
          .card { background: white; padding: 40px; border-radius: 12px;
                  box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 500px; }
          .icon { font-size: 64px; margin-bottom: 16px; }
          h1 { color: #1a1a1a; margin-bottom: 12px; }
          p { color: #555; line-height: 1.5; }
          .tenant { background: #f0f9ff; padding: 10px 16px; border-radius: 8px;
                    font-family: monospace; color: #0369a1; margin: 16px 0; display: inline-block; }
          .note { font-size: 13px; color: #999; margin-top: 24px; }
        </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">✅</div>
            <h1>Admin Consent Successful</h1>
            <p><strong>OnePgr Mail OAuth</strong> has been approved for your organization.</p>
            <div class="tenant">${tenant || "Your Organization"}</div>
            <p>Users in your organization can now connect their email accounts without requiring additional admin approval.</p>
            <p class="note">You may close this window.</p>
          </div>
        </body>
      </html>
    `);
  }

  res.send(`
    <!DOCTYPE html>
    <html>
      <head><title>Consent Not Granted</title></head>
      <body style="font-family:sans-serif;text-align:center;padding:50px;">
        <h2>Consent was not granted.</h2>
        <p>Please try again or contact support.</p>
      </body>
    </html>
  `);
});

// Microsoft OAuth2 callback
router.get("/api/auth/microsoft/callback", async (req, res) => {
  try {
    const { code, state, error: oauthError, error_description } = req.query;
    const defaultFrontend =
      process.env.FRONTEND_URL || "https://liame.onepgr.com";

    if (oauthError) {
      console.error("Microsoft OAuth error:", oauthError, error_description);

      // Detect admin-consent-required: tenant policy blocked user-level consent.
      // Redirect with status=pending_admin so the frontend can show:
      // "Ask your IT admin to approve via this link, then try again."
      const isAdminConsentRequired =
        oauthError === "access_denied" &&
        (error_description || "").includes("AADSTS65001");

      if (isAdminConsentRequired) {
        let stateEmail = "";
        try {
          stateEmail =
            JSON.parse(Buffer.from(req.query.state || "", "base64").toString())
              .email || "";
        } catch (_) {}

        const adminConsentUrl = `${(process.env.BASE_URL || "https://videoresponse.onepgr.com:3001").replace(/\/api\/?$/, "")}/api/auth/microsoft/admin-consent`;
        return res.redirect(
          `${defaultFrontend}/account-setup/email-accounts?status=pending_admin` +
            `&email=${encodeURIComponent(stateEmail)}` +
            `&admin_consent_url=${encodeURIComponent(adminConsentUrl)}`,
        );
      }

      return res.redirect(
        `${defaultFrontend}/account-setup/email-accounts?error=${encodeURIComponent(error_description || oauthError)}`,
      );
    }

    if (!code || !state) {
      return res.redirect(
        `${defaultFrontend}/account-setup/email-accounts?error=${encodeURIComponent("Missing authorization code or state")}`,
      );
    }

    // Decode state to get email AND frontend
    let email, frontendUrl;
    try {
      const stateData = JSON.parse(Buffer.from(state, "base64").toString());
      email = stateData.email;
      frontendUrl = stateData.frontend || defaultFrontend;
    } catch (e) {
      return res.redirect(
        `${defaultFrontend}/account-setup/email-accounts?error=${encodeURIComponent("Invalid state parameter")}`,
      );
    }

    const redirectUri =
      process.env.MICROSOFT_REDIRECT_URI ||
      `${(process.env.BASE_URL || "https://videoresponse.onepgr.com:3001").replace(/\/api\/?$/, "")}/api/auth/microsoft/callback`;

    // Exchange code for tokens
    const tokenResponse = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.MICROSOFT_CLIENT_ID,
          client_secret: process.env.MICROSOFT_CLIENT_SECRET,
          code,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      },
    );

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      console.error(
        "Microsoft token exchange error:",
        tokens.error_description,
      );
      return res.redirect(
        `${frontendUrl}/account-setup/email-accounts?error=${encodeURIComponent(tokens.error_description || "Token exchange failed")}`,
      );
    }

    // Generate API token (same format as password flow)
    const apiToken = crypto.randomBytes(16).toString("hex");

    // Check if record exists
    const existing = await SMTPAuth.findOne({ email });

    if (existing) {
      // Update existing record to OAuth2
      await SMTPAuth.updateOne(
        { email },
        {
          authType: "oauth2",
          host: "smtp-mail.outlook.com",
          port: 587,
          token: apiToken,
          "oauth2.provider": "microsoft",
          "oauth2.accessToken": encrypt(tokens.access_token),
          "oauth2.refreshToken": encrypt(tokens.refresh_token),
          "oauth2.expiresAt": new Date(Date.now() + tokens.expires_in * 1000),
          "oauth2.scope": tokens.scope,
          pass: null,
        },
      );
      console.log(`✅ Updated ${email} to OAuth2 authentication`);
    } else {
      // Create new record
      await SMTPAuth.create({
        email,
        authType: "oauth2",
        host: "smtp-mail.outlook.com",
        port: 587,
        token: apiToken,
        oauth2: {
          provider: "microsoft",
          accessToken: encrypt(tokens.access_token),
          refreshToken: encrypt(tokens.refresh_token),
          expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          scope: tokens.scope,
        },
      });
      console.log(`✅ Created OAuth2 record for ${email}`);
    }

    // Redirect to the correct frontend with success
    res.redirect(
      `${frontendUrl}/account-setup/email-accounts?success=true&email=${encodeURIComponent(email)}&token=${apiToken}&provider=microsoft`,
    );
  } catch (error) {
    console.error("OAuth callback error:", error);
    const frontendUrl = process.env.FRONTEND_URL || "https://liame.onepgr.com";
    res.redirect(
      `${frontendUrl}/account-setup/email-accounts?error=${encodeURIComponent("OAuth setup failed: " + error.message)}`,
    );
  }
});

// Get SMTP auth info (check auth type)
router.get("/api/smtp-auth/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const { token } = req.query;

    const record = await SMTPAuth.findOne({ email, token });
    if (!record) {
      return res.status(403).json({ success: false, error: "Invalid token" });
    }

    res.json({
      success: true,
      email: record.email,
      authType: record.authType || "password",
      provider: record.oauth2?.provider || "standard",
      hasOAuth: record.authType === "oauth2",
      createdAt: record.createdAt,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = {
  router,
  getSMTPSettings,
  getSMTPSettingsForEmail,
};
