const express = require('express');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const dns = require('node:dns').promises;
const crypto = require('crypto');
const mongoose = require('mongoose');
require('dotenv').config();

const router = express.Router();

// Encryption setup
const algorithm = 'aes-256-cbc';
const key = crypto.scryptSync(process.env.ENCRYPTION_SECRET || 'default-secret-key-change-this', 'salt', 32);
const ivLength = 16;

function encrypt(text) {
  if (!text) return '';
  try {
    const iv = crypto.randomBytes(ivLength);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt password');
  }
}

function decrypt(encryptedText) {
  if (!encryptedText) return '';
  try {
    const [ivHex, encryptedHex] = encryptedText.split(':');
    if (!ivHex || !encryptedHex) throw new Error('Invalid encrypted format');
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt password');
  }
}

// MongoDB Models
const smtpAuthSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  host: String,
  port: Number,
  pass: String,
  token: String,
  createdAt: { type: Date, default: Date.now }
}, { collection: 'email_smtp_auth' });

const SMTPAuth = mongoose.model('SMTPAuth', smtpAuthSchema);

const emailTrackingSchema = new mongoose.Schema({
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
    text: String
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
    action_block_id: String
  },
  // Enhanced open tracking
  openEvents: [{
    openedAt: Date,
    ip: String,
    userAgent: String,
    sessionId: String // To track unique sessions
  }],
  clickEvents: [{
    url: String,
    clickedAt: Date,
    ip: String,
    userAgent: String
  }]
}, {
  collection: 'email_tracking_v2',
  timestamps: true
});

const EmailTracking = mongoose.model('EmailTracking', emailTrackingSchema);

// MongoDB Connection
mongoose.connect(process.env.ONEPGR_MONGO_URI, {
  dbName: 'onepgr_apps',
  useNewUrlParser: true,
  useUnifiedTopology: true
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
const { cpanelRequest } = require('../domainManagementAPI/cpanelApi.js');

async function getSMTPSettings(email, customHost, customPort) {
  const domain = email.split('@')[1].toLowerCase();

  // 1. Check for custom settings first
  if (customHost && customPort) return { host: customHost, port: customPort };

  // 2. Check for known providers (Gmail, Outlook, etc.)
  const providerSettings = {
    'gmail.com': { host: 'smtp.gmail.com', port: 587 },
    'outlook.com': { host: 'smtp-mail.outlook.com', port: 587 },
    'hotmail.com': { host: 'smtp-mail.outlook.com', port: 587 },
    'yahoo.com': { host: 'smtp.mail.yahoo.com', port: 587 },
    'icloud.com': { host: 'smtp.mail.me.com', port: 587 },
    'protonmail.com': { host: '127.0.0.1', port: 1025 },
    'zoho.com': { host: 'smtp.zoho.com', port: 587 },
    'yandex.com': { host: 'smtp.yandex.com', port: 587 }
  };

  if (providerSettings[domain]) return providerSettings[domain];

  // 3. For custom domains, try cPanel API first
  try {
    console.log(`Attempting cPanel API lookup for domain: ${domain}`);
    const cpanelResponse = await cpanelRequest('Email/get_client_settings', {
      account: email
    });

    if (cpanelResponse && cpanelResponse.data) {
      const smtpData = cpanelResponse.data;

      // Validate that we have the required SMTP settings
      if (smtpData.smtp_host && smtpData.smtp_port) {
        console.log(`cPanel API success for ${email}:`, {
          host: smtpData.smtp_host,
          port: smtpData.smtp_port
        });
        return {
          host: smtpData.smtp_host,
          port: parseInt(smtpData.smtp_port) || 465
        };
      } else {
        console.log(`cPanel API response missing SMTP settings for ${email}:`, smtpData);
      }
    } else {
      console.log(`cPanel API response invalid for ${email}:`, cpanelResponse);
    }
  } catch (cpanelError) {
    console.log(`cPanel API failed for ${email}:`, cpanelError.message);
    // Continue to fallback logic
  }

  // 4. Fallback: Check MX records for provider detection
  try {
    const mxRecords = await cachedMxLookup(domain);
    const sorted = mxRecords.sort((a, b) => a.priority - b.priority);

    // Detect Google Workspace
    const isGoogleWorkspace = sorted.some(mx =>
      mx.exchange.includes('google') ||
      mx.exchange.includes('aspmx.l.google.com') ||
      mx.exchange.includes('googlemail.com')
    );
    if (isGoogleWorkspace) return { host: 'smtp.gmail.com', port: 587 };

    // Detect Outlook/Microsoft
    const isOutlook = sorted.some(mx =>
      mx.exchange.includes('outlook') ||
      mx.exchange.includes('hotmail') ||
      mx.exchange.includes('microsoft')
    );
    if (isOutlook) return { host: 'smtp-mail.outlook.com', port: 587 };

    // Detect cPanel/WHM servers
    const isCPanel = sorted.some(mx =>
      mx.exchange.includes('cpanel') ||
      mx.exchange.includes('whm') ||
      mx.exchange === domain || // Self-hosted MX
      mx.exchange.endsWith(`.${domain}`) // Subdomain of the same domain
    );

    if (isCPanel) {
      return { host: `mail.${domain}`, port: 465 };
    }

    // For other self-hosted domains, default to cPanel style
    const isSelfHosted = sorted.some(mx =>
      mx.exchange === domain ||
      mx.exchange.endsWith(`.${domain}`)
    );

    if (isSelfHosted) {
      return { host: `mail.${domain}`, port: 465 };
    }

    // Fallback for unknown providers
    return { host: `smtp.${domain}`, port: 587 };
  } catch (error) {
    console.log(`Could not resolve MX records for ${domain}:`, error.message);
    // Default to cPanel style as fallback for unknown domains
    return { host: `mail.${domain}`, port: 465 };
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventData)
    });

    if (response.ok) {
      console.log(`✅ Webhook sent successfully to ${webhookUrl} - Status: ${response.status}`);
    } else {
      console.error(`❌ Webhook failed to ${webhookUrl} - Status: ${response.status}`);
    }
  } catch (error) {
    console.error(`❌ Webhook error to ${webhookUrl}: ${error.message}`);
  }
}

// HTML Subject Detection and Encoding Functions
function isHtmlContent(content) {
  if (!content || typeof content !== 'string') return false;

  // Check for common HTML patterns
  const htmlPatterns = [
    /<[a-z][\s\S]*>/i,  // HTML tags
    /&[a-zA-Z0-9#]+;/,  // HTML entities
    /<br\s*\/?>/i,      // Line breaks
    /<p\s*>/i,          // Paragraphs
    /<div\s*>/i,        // Divs
    /<span\s*>/i,       // Spans
    /<b\s*>/i,          // Bold
    /<i\s*>/i,          // Italic
    /<strong\s*>/i,     // Strong
    /<em\s*>/i,         // Emphasis
    /style\s*=\s*["'][^"']*["']/i,  // Style attributes
    /class\s*=\s*["'][^"']*["']/i   // Class attributes
  ];

  return htmlPatterns.some(pattern => pattern.test(content));
}

function encodeSubjectForEmail(subject) {
  if (!subject || typeof subject !== 'string') return 'No Subject';

  const trimmedSubject = subject.trim();
  if (!trimmedSubject) return 'No Subject';

  // If subject contains HTML, encode it properly for email headers
  if (isHtmlContent(trimmedSubject)) {
    // Use UTF-8 encoding for HTML content in subject
    return `=?UTF-8?B?${Buffer.from(trimmedSubject, 'utf8').toString('base64')}?=`;
  }

  // For plain text, check if it needs encoding
  const needsEncoding = /[^\x00-\x7F]/.test(trimmedSubject);
  if (needsEncoding) {
    return `=?UTF-8?B?${Buffer.from(trimmedSubject, 'utf8').toString('base64')}?=`;
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
      timestamp: new Date()
    });
    if (trackingData.webhookUrl) {
      await sendWebhookNotification(trackingData.webhookUrl, {
        event: eventType,
        ...trackingData
      });
    }
  } catch (error) {
    console.error('Event logging error:', error);
  }
}

// 1️⃣ Setup Sender and generate API token
router.post('/api/senderemail/smtpauth', async (req, res) => {
  try {
    const { host, port, email, pass } = req.body;
    if (!email || !pass) {
      return res.status(400).json({ success: false, error: 'Missing required fields: email, pass' });
    }

    const smtpSettings = await getSMTPSettings(email, host, port);
    const existingRecord = await SMTPAuth.findOne({ email });

    if (existingRecord) {
      return res.status(200).json({
        success: false,
        error: 'Email already configured',
        message: `Email ${email} is already configured with token: ${existingRecord.token}`,
        isExistingToken: true,
        existingToken: existingRecord.token,
        createdAt: existingRecord.createdAt
      });
    }

    const token = crypto.randomBytes(16).toString('hex');
    const encryptedPass = encrypt(pass);

    const result = await SMTPAuth.create({
      email,
      host: smtpSettings.host,
      port: smtpSettings.port,
      pass: encryptedPass,
      token
    });

    // Determine detection method for better user feedback
    const domain = email.split('@')[1].toLowerCase();
    const knownProviders = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'protonmail.com', 'zoho.com', 'yandex.com'];
    const detectionMethod = knownProviders.includes(domain) ? 'Known Provider' :
      smtpSettings.host.includes('mail.') ? 'cPanel API' :
        'DNS MX Lookup';

    return res.json({
      success: true,
      token,
      smtpSettings,
      detectionMethod,
      message: `New SMTP auth created for ${email} (${detectionMethod}). Use token: ${token} to send and retrieve emails`
    });
  } catch (error) {
    console.error('SMTP Auth Error:', error);
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: 'Email already exists'
      });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
});

// 2️⃣ Send Email
router.post('/api/emailsend', async (req, res) => {
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
      trackingPayload
    } = req.body;

    if (!token || !from || !to) {
      return res.status(400).json({ success: false, error: 'Missing required fields: token, from, to' });
    }

    // Validate that user provided email content
    if (!html && !text) {
      return res.status(400).json({
        success: false,
        error: 'Email content is required. Please provide either html or text content.'
      });
    }

    const smtp = await SMTPAuth.findOne({ email: from, token });
    if (!smtp) {
      return res.status(403).json({ success: false, error: 'Invalid token or sender email' });
    }

    const decryptedPass = decrypt(smtp.pass);
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: from, pass: decryptedPass },
      tls: { rejectUnauthorized: false }
    });

    await transporter.verify();

    const trackingId = crypto.randomBytes(16).toString('hex');
    const baseUrl = process.env.BASE_URL || 'https://videoresponse.onepgr.com:3001';
    const trackingPixelUrl = `${baseUrl}/api/track/open/${trackingId}`;

    // Use exactly what user provided - no template processing
    let emailHtml = html;
    let emailText = text;

    // Add tracking pixel only if HTML content exists
    if (emailHtml) {
      emailHtml += `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none;border:0;" alt=""/>\n`;
    }

    // Track links only if requested and HTML content exists
    if (emailHtml && trackLinks) {
      emailHtml = emailHtml.replace(/href=["'](.*?)["']/g, (match, url) => {
        if (url.startsWith('http') && !url.includes(baseUrl)) {
          const encodedUrl = encodeURIComponent(url);
          return `href="${baseUrl}/api/track/click/${trackingId}?url=${encodedUrl}"`;
        }
        return match;
      });
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
      messageId: `<${trackingId}@${from.split('@')[1]}>`,
      headers: {
        'X-Tracking-ID': trackingId,
        'References': `<${trackingId}@${from.split('@')[1]}>`
      }
    };

    if (cc) emailOptions.cc = cc;
    if (bcc) emailOptions.bcc = bcc;

    const info = await transporter.sendMail(emailOptions);

    // Set webhook URL for all events
    const webhookUrl = 'https://meet.onepgr.com/session/smatpTracking';

    const trackingRecord = new EmailTracking({
      messageId: trackingId,
      originalMessageId: info.messageId,
      fromEmail: from,
      toEmail: to,
      subject,
      webhookUrl: webhookUrl, // Always store webhook URL for all emails
      emailContent: {
        html: html,
        text: text
      },
      trackingPayload: trackingPayload || null
    });

    await trackingRecord.save();

    // Send immediate notification for all emails
    await sendWebhookNotification(webhookUrl, {
      event: 'sent',
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
        trackingEnabled: !!trackLinks
      },
      trackingPayload: trackingPayload || null,
      senderName: sender_name || null
    });

    return res.json({
      success: true,
      messageId: info.messageId,
      trackingId,
      recipients: { to, cc: cc || null, bcc: bcc || null },
      contentUsed: {
        html: !!html,
        text: !!text,
        trackingEnabled: !!trackLinks
      },
      trackingPayload: trackingPayload || null,
      senderName: sender_name || null
    });
  } catch (err) {
    console.error('Email Send Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3️⃣ Inbox Fetch with Read/Unread
router.post('/api/fetchinbox', async (req, res) => {
  try {
    const { token, email, limit = 10 } = req.body;
    if (!token || !email) {
      return res.status(400).json({ success: false, error: 'Missing token or email' });
    }

    const smtp = await SMTPAuth.findOne({ email, token });
    if (!smtp) {
      return res.status(403).json({ success: false, error: 'Invalid token or sender email' });
    }

    // Decrypt the password
    let decryptedPass;
    try {
      decryptedPass = decrypt(smtp.pass);
    } catch (decryptError) {
      console.error('Password decryption failed:', decryptError);
      return res.status(500).json({ success: false, error: 'Failed to decrypt stored credentials' });
    }

    const client = new ImapFlow({
      host: smtp.host,
      port: 993,
      secure: true,
      auth: { user: email, pass: decryptedPass },
      logger: false
    });

    await client.connect();
    const lock = await client.mailboxOpen('INBOX');
    const total = lock.exists;
    const maxLimit = Math.max(Math.min(limit, 50), 1);
    const start = Math.max(total - (maxLimit - 1), 1);

    const messages = [];
    for await (let msg of client.fetch(`${start}:${total}`, { envelope: true, uid: true, flags: true, source: true })) {
      const parsed = await simpleParser(msg.source);
      messages.push({
        subject: msg.envelope.subject,
        from: msg.envelope.from.map(f => `${f.name} <${f.address}>`).join(', '),
        date: msg.envelope.date,
        uid: msg.uid,
        read: Array.isArray(msg.flags) ? msg.flags.includes('Seen') : false,
        text: parsed.text || '',
        html: parsed.html || ''
      });
    }
    await client.logout();

    return res.json({ success: true, inbox: messages.reverse() });
  } catch (err) {
    console.error('Inbox Fetch Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4️⃣ Host discovery from email
router.get('/api/get-host', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email.includes('@')) return res.status(400).json({ success: false, message: 'Invalid email' });
    const domain = email.split('@')[1];

    // Get proper SMTP settings using the same logic as the setup endpoint
    const smtpSettings = await getSMTPSettings(email);

    // Get MX records for additional info
    const mxRecords = await cachedMxLookup(domain);
    const sorted = mxRecords.sort((a, b) => a.priority - b.priority);

    // Detect provider type based on MX records
    const isGoogleWorkspace = sorted.some(mx => mx.exchange.includes('google'));
    const isOutlook = sorted.some(mx =>
      mx.exchange.includes('outlook') ||
      mx.exchange.includes('hotmail') ||
      mx.exchange.includes('microsoft')
    );
    const isYahoo = sorted.some(mx => mx.exchange.includes('yahoo'));
    const isCPanel = sorted.some(mx =>
      mx.exchange.includes('cpanel') ||
      mx.exchange.includes('whm') ||
      mx.exchange === domain ||
      mx.exchange.endsWith(`.${domain}`)
    );
    const isSelfHosted = sorted.some(mx =>
      mx.exchange === domain ||
      mx.exchange.endsWith(`.${domain}`)
    );

    // Override suggestions for self-hosted domains
    const isSelfHostedDomain = !smtpSettings.host.includes('gmail') &&
      !smtpSettings.host.includes('outlook') &&
      !smtpSettings.host.includes('yahoo') &&
      !smtpSettings.host.includes('zoho') &&
      !smtpSettings.host.includes('yandex');

    const suggestedSmtp = isSelfHostedDomain ? `mail.${domain}` : smtpSettings.host;
    const suggestedImap = isSelfHostedDomain ? `mail.${domain}` : smtpSettings.host.replace('smtp.', 'imap.');

    return res.json({
      success: true,
      domain,
      suggested_smtp: suggestedSmtp,
      suggested_imap: suggestedImap,
      smtp_port: smtpSettings.port,
      imap_port: 993, // Standard IMAP port
      mx_records: sorted,
      provider_info: {
        is_gmail: domain === 'gmail.com' || isGoogleWorkspace,
        is_google_workspace: isGoogleWorkspace,
        is_outlook: domain.includes('outlook') || domain.includes('hotmail') || isOutlook,
        is_yahoo: domain.includes('yahoo') || isYahoo,
        is_cpanel: isCPanel,
        is_self_hosted: isSelfHosted,
        provider_type: isGoogleWorkspace ? 'google_workspace' :
          isOutlook ? 'outlook' :
            isYahoo ? 'yahoo' :
              isCPanel ? 'cpanel' :
                isSelfHosted ? 'self_hosted' : 'unknown'
      },
      detection_notes: {
        mx_analysis: `Analyzed ${sorted.length} MX records`,
        recommended_host: suggestedSmtp,
        recommended_port: smtpSettings.port,
        fallback_reason: isSelfHostedDomain ? 'Self-hosted domain detected' : 'Standard provider detected'
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Could not resolve host', error: err.message });
  }
});


//_________________________Tracking API's_________________________

// 3️⃣ Track Email Opens with Better Accuracy
router.get('/api/track/open/:trackingId', async (req, res) => {
  try {
    const trackingId = req.params.trackingId;
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const referer = req.headers['referer'] || '';

    // Create a session ID based on IP and User Agent to detect unique opens
    const sessionId = crypto.createHash('md5').update(`${ip}-${userAgent}`).digest('hex');

    // Get current time
    const now = new Date();

    // Find the tracking record
    const tracking = await EmailTracking.findOne({ messageId: trackingId });
    if (!tracking) {
      console.log(`Tracking not found for: ${trackingId}`);
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      return res.send(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
    }

    // Get tracking payload data (directly stored or extracted from content)
    let extractedTrackingData = {};

    // First, check if tracking payload was directly stored
    if (tracking.trackingPayload) {
      extractedTrackingData = { ...tracking.trackingPayload };
      console.log('📊 Direct Tracking Payload Found:', {
        trackingId,
        email: tracking.toEmail,
        trackingPayload: extractedTrackingData,
        timestamp: now
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
            action_block_id: /data-action-block-id=["']([^"']+)["']/i
          };

          // Extract each tracking field
          Object.keys(trackingPatterns).forEach(key => {
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
              extractedTrackingData = { ...extractedTrackingData, ...decodedData };
            } catch (e) {
              console.log('Failed to parse URL tracking data');
            }
          }
        }
      } catch (extractError) {
        console.log('Error extracting tracking data:', extractError.message);
      }
    }

    // Log extracted tracking data
    if (Object.keys(extractedTrackingData).length > 0) {
      console.log('📊 Extracted Tracking Data:', {
        trackingId,
        email: tracking.toEmail,
        extractedData: extractedTrackingData,
        timestamp: now
      });
    }

    // Check if this is a duplicate open (same session within 1 hour)
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const recentOpen = tracking.openEvents && tracking.openEvents.find(event =>
      event.sessionId === sessionId && event.openedAt > oneHourAgo
    );

    let shouldCount = false;
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
            lastOpenedIP: ip
          },
          $push: {
            openEvents: {
              openedAt: now,
              ip: ip,
              userAgent: userAgent,
              sessionId: sessionId
            }
          }
        },
        { new: true }
      );

      console.log(`📧 New email open detected: ${trackingId} from IP: ${ip}, Count: ${updatedTracking.openedCount}`);
    } else {
      console.log(`📧 Duplicate open ignored: ${trackingId} from IP: ${ip} (same session within 1 hour)`);
    }

    // Send webhook notification only for new opens
    if (shouldCount) {
      await sendWebhookNotification('https://meet.onepgr.com/session/smatpTracking', {
        event: 'opened',
        trackingId,
        email: tracking.toEmail,
        from: tracking.fromEmail,
        subject: tracking.subject,
        ip,
        userAgent,
        openedCount: updatedTracking.openedCount,
        sessionId: sessionId,
        isNewOpen: true,
        timestamp: now,
        extractedTrackingData,
        openEvents: updatedTracking.openEvents || [],
        uniqueOpens: updatedTracking.openEvents ? updatedTracking.openEvents.length : 0
      });
    }

    // Set cache headers to prevent multiple loads
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.set('Expires', new Date(now.getTime() + 3600 * 1000).toUTCString());
    res.send(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
  } catch (error) {
    console.error('Open tracking error:', error);
    res.status(200).send(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
  }
});

// 4️⃣ Track Link Clicks
router.get('/api/track/click/:trackingId', async (req, res) => {
  try {
    const trackingId = req.params.trackingId;
    const url = decodeURIComponent(req.query.url);
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const tracking = await EmailTracking.findOneAndUpdate(
      { messageId: trackingId },
      {
        $push: {
          clickEvents: {
            url,
            clickedAt: new Date(),
            ip,
            userAgent
          }
        }
      },
      { new: true }
    );

    // Get tracking payload data (directly stored or extracted from content)
    let extractedTrackingData = {};

    // First, check if tracking payload was directly stored
    if (tracking.trackingPayload) {
      extractedTrackingData = { ...tracking.trackingPayload };
      console.log('🔗 Click Tracking - Direct Payload Found:', {
        trackingId,
        email: tracking.toEmail,
        clickedUrl: url,
        trackingPayload: extractedTrackingData,
        timestamp: new Date()
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
            action_block_id: /data-action-block-id=["']([^"']+)["']/i
          };

          // Extract each tracking field
          Object.keys(trackingPatterns).forEach(key => {
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
              extractedTrackingData = { ...extractedTrackingData, ...decodedData };
            } catch (e) {
              console.log('Failed to parse URL tracking data');
            }
          }
        }
      } catch (extractError) {
        console.log('Error extracting tracking data from click:', extractError.message);
      }
    }

    // Log extracted tracking data
    if (Object.keys(extractedTrackingData).length > 0) {
      console.log('🔗 Click Tracking Data:', {
        trackingId,
        email: tracking.toEmail,
        clickedUrl: url,
        extractedData: extractedTrackingData,
        timestamp: new Date()
      });
    }

    if (tracking) {
      await sendWebhookNotification('https://meet.onepgr.com/session/smatpTracking', {
        event: 'clicked',
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
        totalClicks: tracking.clickEvents ? tracking.clickEvents.length : 0
      });
    }

    res.redirect(url);
  } catch (error) {
    console.error('Click tracking error:', error);
    res.redirect(decodeURIComponent(req.query.url));
  }
});

// 5️⃣ Reply Detection
async function checkForReplies() {
  try {
    const trackings = await EmailTracking.find({
      repliedAt: { $exists: false },
      fromEmail: { $exists: true }
    }).limit(50);

    for (const tracking of trackings) {
      const smtp = await SMTPAuth.findOne({ email: tracking.fromEmail });
      if (!smtp) continue;

      let client;
      try {
        const decryptedPass = decrypt(smtp.pass);
        client = new ImapFlow({
          host: smtp.host.replace('smtp.', 'imap.'),
          port: 993,
          secure: true,
          auth: { user: tracking.fromEmail, pass: decryptedPass },
          logger: false,
          timeout: 60000, // 60 second timeout (increased for safety)
          keepalive: true,
          maxRetries: 1 // Limit retry attempts
        });

        // Add connection event listeners
        // client.on('error', err => console.error(`IMAP error for ${tracking.fromEmail}:`, err.message));
        // client.on('close', () => console.log(`Connection closed for ${tracking.fromEmail}`));

        // Add connection timeout
        await Promise.race([
          client.connect(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Connection timeout')), 30000)
          )
        ]);

        await Promise.race([
          client.mailboxOpen('INBOX'),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Mailbox open timeout')), 15000)
          )
        ]);

        // Send NOOP to keep connection alive
        await client.run('NOOP');

        // Check connection state before proceeding
        if (!client.connection || client.connection.state !== 'authenticated') {
          throw new Error('Connection not properly authenticated');
        }

        // Search for replies using multiple methods
        let foundReplies = false;

        // Method 1: Search by In-Reply-To header
        try {
          // Check connection before search
          if (!client.connection || client.connection.state !== 'authenticated') {
            throw new Error('Connection lost during search');
          }

          const inReplyToMessages = await client.search({
            header: { 'In-Reply-To': tracking.originalMessageId }
          });

          if (inReplyToMessages.length > 0) {
            foundReplies = true;
            console.log(`Found ${inReplyToMessages.length} replies via In-Reply-To for ${tracking.messageId}`);
          }
        } catch (error) {
          console.log(`In-Reply-To search failed for ${tracking.messageId}:`, error.message);
          // If connection is lost, break out of the search loop
          if (error.message.includes('Connection') || error.message.includes('timeout')) {
            break;
          }
        }

        // Method 2: Search by References header
        if (!foundReplies) {
          try {
            // Check connection before search
            if (!client.connection || client.connection.state !== 'authenticated') {
              throw new Error('Connection lost during search');
            }

            const referencesMessages = await client.search({
              header: { 'References': tracking.originalMessageId }
            });

            if (referencesMessages.length > 0) {
              foundReplies = true;
              console.log(`Found ${referencesMessages.length} replies via References for ${tracking.messageId}`);
            }
          } catch (error) {
            console.log(`References search failed for ${tracking.messageId}:`, error.message);
            // If connection is lost, break out of the search loop
            if (error.message.includes('Connection') || error.message.includes('timeout')) {
              break;
            }
          }
        }

        // Method 3: Search by subject line containing "Re:" and from the recipient
        if (!foundReplies) {
          try {
            // Check connection before search
            if (!client.connection || client.connection.state !== 'authenticated') {
              throw new Error('Connection lost during search');
            }

            const subjectReplies = await client.search({
              from: tracking.toEmail,
              subject: 'Re:'
            });

            for await (let msg of client.fetch(subjectReplies, { source: true })) {
              const parsed = await simpleParser(msg.source);
              if (parsed.references && parsed.references.includes(tracking.originalMessageId)) {
                foundReplies = true;
                console.log(`Found reply via subject search for ${tracking.messageId}`);
                break;
              }
            }
          } catch (error) {
            console.log(`Subject search failed for ${tracking.messageId}:`, error.message);
            // If connection is lost, break out of the search loop
            if (error.message.includes('Connection') || error.message.includes('timeout')) {
              break;
            }
          }
        }

        if (foundReplies) {
          const replyTime = new Date();

          // Get detailed reply information
          let replyDetails = null;
          try {
            // Check connection before fetching reply details
            if (!client.connection || client.connection.state !== 'authenticated') {
              throw new Error('Connection lost during reply details fetch');
            }

            // Fetch the actual reply message to get details
            const replyMessages = await client.search({
              header: { 'In-Reply-To': tracking.originalMessageId }
            });

            if (replyMessages.length > 0) {
              for await (let msg of client.fetch(replyMessages.slice(0, 1), {
                envelope: true,
                source: true
              })) {
                const parsed = await simpleParser(msg.source);
                replyDetails = {
                  replyFrom: msg.envelope.from ? msg.envelope.from.map(f => `${f.name || ''} <${f.address}>`).join(', ') : 'Unknown',
                  replySubject: msg.envelope.subject || '(No Subject)',
                  replyDate: msg.envelope.date,
                  replyText: parsed.text || '',
                  replyHtml: parsed.html || '',
                  replyMessageId: parsed.messageId
                };
                break;
              }
            }
          } catch (error) {
            console.log(`Error fetching reply details for ${tracking.messageId}:`, error.message);
            // Continue with basic reply detection even if details fetch fails
          }

          await EmailTracking.findOneAndUpdate(
            { messageId: tracking.messageId },
            { $set: { repliedAt: replyTime } }
          );

          // Log reply detection with tracking payload
          console.log('📧 Reply detected:', {
            trackingId: tracking.messageId,
            originalEmail: tracking.toEmail,
            originalFrom: tracking.fromEmail,
            replyTime: replyTime,
            replyDetails: replyDetails,
            trackingPayload: tracking.trackingPayload || null
          });

          // Get tracking payload for reply notification
          let extractedTrackingData = {};
          if (tracking.trackingPayload) {
            extractedTrackingData = { ...tracking.trackingPayload };
          }

          await sendWebhookNotification('https://meet.onepgr.com/session/smatpTracking', {
            event: 'replied',
            trackingId: tracking.messageId,
            email: tracking.toEmail,
            from: tracking.fromEmail,
            subject: tracking.subject,
            timestamp: replyTime,
            extractedTrackingData,
            replyDetails: replyDetails,
            originalMessageId: tracking.originalMessageId,
            replyCount: 1
          });
        }
      } catch (connError) {
        // console.error(`Connection error for ${tracking.fromEmail}:`, connError.message);
        continue; // Skip to next tracking record
      } finally {
        try {
          if (client && typeof client.logout === 'function') {
            await client.logout().catch(e =>
              // console.error('Logout error:', e.message)); // Commented out to reduce log spam
              null);
          }
        } catch (logoutError) {
          // console.error('Final logout error:', logoutError.message); // Commented out to reduce log spam
        }
      }
    }
  } catch (error) {
    console.error('Reply checking error:', error);
  }
}

// 5️⃣.1️⃣ Manual Reply Check API
router.post('/api/check-replies', async (req, res) => {
  try {
    const { token, email, messageId } = req.body;
    if (!token || !email || !messageId) {
      return res.status(400).json({ success: false, error: 'Missing token, email, or messageId' });
    }

    const smtp = await SMTPAuth.findOne({ email, token });
    if (!smtp) {
      return res.status(403).json({ success: false, error: 'Invalid token or sender email' });
    }

    // Decrypt the password
    let decryptedPass;
    try {
      decryptedPass = decrypt(smtp.pass);
    } catch (decryptError) {
      console.error('Password decryption failed:', decryptError);
      return res.status(500).json({ success: false, error: 'Failed to decrypt stored credentials' });
    }

    const client = new ImapFlow({
      host: smtp.host.replace('smtp.', 'imap.'),
      port: 993,
      secure: true,
      auth: { user: email, pass: decryptedPass },
      logger: false
    });

    await client.connect();
    await client.mailboxOpen('INBOX');

    const replies = [];
    let foundReplies = false;

    // Method 1: Search by In-Reply-To header
    try {
      const inReplyToMessages = await client.search({
        header: { 'In-Reply-To': messageId }
      });

      for await (let msg of client.fetch(inReplyToMessages, {
        envelope: true,
        uid: true,
        flags: true,
        source: true
      })) {
        const parsed = await simpleParser(msg.source);
        const flags = Array.isArray(msg.flags) ? msg.flags : [];
        const isRead = flags.includes('Seen') || flags.includes('\\Seen');

        replies.push({
          subject: msg.envelope.subject || '(No Subject)',
          from: msg.envelope.from ? msg.envelope.from.map(f => `${f.name || ''} <${f.address}>`).join(', ') : 'Unknown',
          date: msg.envelope.date,
          uid: msg.uid,
          read: isRead,
          status: isRead ? 'read' : 'unread',
          text: parsed.text || '',
          html: parsed.html || '',
          messageId: parsed.messageId,
          inReplyTo: parsed.inReplyTo,
          references: parsed.references,
          replyMethod: 'In-Reply-To'
        });
        foundReplies = true;
      }
    } catch (error) {
      console.log('In-Reply-To search failed:', error.message);
    }

    // Method 2: Search by References header
    try {
      const referencesMessages = await client.search({
        header: { 'References': messageId }
      });

      for await (let msg of client.fetch(referencesMessages, {
        envelope: true,
        uid: true,
        flags: true,
        source: true
      })) {
        const parsed = await simpleParser(msg.source);
        const flags = Array.isArray(msg.flags) ? msg.flags : [];
        const isRead = flags.includes('Seen') || flags.includes('\\Seen');

        // Avoid duplicates
        const existingReply = replies.find(r => r.uid === msg.uid);
        if (!existingReply) {
          replies.push({
            subject: msg.envelope.subject || '(No Subject)',
            from: msg.envelope.from ? msg.envelope.from.map(f => `${f.name || ''} <${f.address}>`).join(', ') : 'Unknown',
            date: msg.envelope.date,
            uid: msg.uid,
            read: isRead,
            status: isRead ? 'read' : 'unread',
            text: parsed.text || '',
            html: parsed.html || '',
            messageId: parsed.messageId,
            inReplyTo: parsed.inReplyTo,
            references: parsed.references,
            replyMethod: 'References'
          });
          foundReplies = true;
        }
      }
    } catch (error) {
      console.log('References search failed:', error.message);
    }

    await client.logout();

    // Sort replies by date
    replies.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Get tracking payload if available
    let trackingPayload = null;
    try {
      const tracking = await EmailTracking.findOne({ originalMessageId: messageId });
      if (tracking && tracking.trackingPayload) {
        trackingPayload = tracking.trackingPayload;
      }
    } catch (error) {
      console.log('Error fetching tracking payload:', error.message);
    }

    return res.json({
      success: true,
      originalMessageId: messageId,
      foundReplies: foundReplies,
      replies: replies,
      totalReplies: replies.length,
      trackingPayload: trackingPayload
    });
  } catch (err) {
    console.error('Manual Reply Check Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6️⃣ Get Tracking Status with Reply Details
router.get('/api/track/:trackingId', async (req, res) => {
  try {
    const tracking = await EmailTracking.findOne({ messageId: req.params.trackingId });
    if (!tracking) {
      return res.status(404).json({ success: false, error: 'Tracking not found' });
    }

    // Format dates to readable format
    const formatDate = (date) => {
      if (!date) return null;
      return new Date(date).toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
      });
    };

    // Clean IP address (remove IPv6 prefix)
    const cleanIP = (ip) => {
      if (!ip) return null;
      return ip.replace('::ffff:', '');
    };

    // Get reply details if tracking has webhook enabled
    let replyDetails = null;
    if (tracking.webhookUrl) {
      try {
        const smtp = await SMTPAuth.findOne({ email: tracking.fromEmail });
        if (smtp) {
          const decryptedPass = decrypt(smtp.pass);
          const client = new ImapFlow({
            host: smtp.host.replace('smtp.', 'imap.'),
            port: 993,
            secure: true,
            auth: { user: tracking.fromEmail, pass: decryptedPass },
            logger: false
          });

          await client.connect();
          await client.mailboxOpen('INBOX');

          const replies = [];

          // Method 1: Search by In-Reply-To header
          try {
            const inReplyToMessages = await client.search({
              header: { 'In-Reply-To': tracking.originalMessageId }
            });

            for await (let msg of client.fetch(inReplyToMessages, {
              envelope: true,
              uid: true,
              flags: true,
              source: true
            })) {
              const parsed = await simpleParser(msg.source);
              const flags = Array.isArray(msg.flags) ? msg.flags : [];
              const isRead = flags.includes('Seen') || flags.includes('\\Seen');

              replies.push({
                subject: msg.envelope.subject || '(No Subject)',
                from: msg.envelope.from ? msg.envelope.from.map(f => `${f.name || ''} <${f.address}>`).join(', ') : 'Unknown',
                date: formatDate(msg.envelope.date),
                uid: msg.uid,
                read: isRead,
                status: isRead ? 'read' : 'unread',
                text: parsed.text || '',
                html: parsed.html || '',
                messageId: parsed.messageId,
                inReplyTo: parsed.inReplyTo,
                references: parsed.references,
                replyMethod: 'In-Reply-To'
              });
            }
          } catch (error) {
            console.log('In-Reply-To search failed:', error.message);
          }

          // Method 2: Search by References header
          try {
            const referencesMessages = await client.search({
              header: { 'References': tracking.originalMessageId }
            });

            for await (let msg of client.fetch(referencesMessages, {
              envelope: true,
              uid: true,
              flags: true,
              source: true
            })) {
              const parsed = await simpleParser(msg.source);
              const flags = Array.isArray(msg.flags) ? msg.flags : [];
              const isRead = flags.includes('Seen') || flags.includes('\\Seen');

              // Avoid duplicates
              const existingReply = replies.find(r => r.uid === msg.uid);
              if (!existingReply) {
                replies.push({
                  subject: msg.envelope.subject || '(No Subject)',
                  from: msg.envelope.from ? msg.envelope.from.map(f => `${f.name || ''} <${f.address}>`).join(', ') : 'Unknown',
                  date: formatDate(msg.envelope.date),
                  uid: msg.uid,
                  read: isRead,
                  status: isRead ? 'read' : 'unread',
                  text: parsed.text || '',
                  html: parsed.html || '',
                  messageId: parsed.messageId,
                  inReplyTo: parsed.inReplyTo,
                  references: parsed.references,
                  replyMethod: 'References'
                });
              }
            }
          } catch (error) {
            console.log('References search failed:', error.message);
          }

          await client.logout();

          // Sort replies by date
          replies.sort((a, b) => new Date(a.date) - new Date(b.date));

          replyDetails = {
            foundReplies: replies.length > 0,
            replies: replies,
            totalReplies: replies.length
          };
        }
      } catch (error) {
        console.error('Reply details fetch error:', error);
        replyDetails = {
          foundReplies: false,
          replies: [],
          totalReplies: 0,
          error: 'Failed to fetch reply details'
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
        openEvents: tracking.openEvents ? tracking.openEvents.map(event => ({
          openedAt: formatDate(event.openedAt),
          ip: cleanIP(event.ip),
          userAgent: event.userAgent,
          sessionId: event.sessionId
        })) : [],
        uniqueOpens: tracking.openEvents ? tracking.openEvents.length : 0,

        // Click Events
        clicks: tracking.clickEvents ? tracking.clickEvents.map(click => ({
          ...click,
          clickedAt: formatDate(click.clickedAt),
          ip: cleanIP(click.ip)
        })) : [],
        totalClicks: tracking.clickEvents ? tracking.clickEvents.length : 0,

        // Webhook (only if trackLinks was enabled)
        webhookUrl: tracking.webhookUrl || null,

        // Reply Details
        replyDetails: replyDetails,

        // Timestamps
        createdAt: formatDate(tracking.createdAt),
        updatedAt: formatDate(tracking.updatedAt)
      }
    });
  } catch (error) {
    console.error('Tracking status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 7️⃣ Webhook Endpoint for POST Notifications (Legacy)
router.post('/emailtrachwebhook', async (req, res) => {
  try {
    const { event, trackingId, email, from, subject, timestamp, ip, userAgent, openedCount, url, extractedTrackingData, replyDetails } = req.body;

    if (!event || !trackingId) {
      return res.status(400).json({ success: false, error: 'Missing required fields: event, trackingId' });
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
      replyDetails: replyDetails || null
    });

    // Log tracking payload separately if present
    if (extractedTrackingData && Object.keys(extractedTrackingData).length > 0) {
      console.log('📊 Webhook Tracking Payload:', {
        trackingId,
        event,
        trackingPayload: extractedTrackingData
      });
    }

    // Log reply details separately if present
    if (replyDetails && event === 'replied') {
      console.log('📧 Webhook Reply Details:', {
        trackingId,
        event,
        replyDetails: replyDetails
      });
    }

    // Optionally, update your database or perform other actions based on the event
    const tracking = await EmailTracking.findOne({ messageId: trackingId });
    if (!tracking) {
      return res.status(404).json({ success: false, error: 'Tracking record not found' });
    }

    // Update tracking record based on event type
    switch (event) {
      case 'opened':
        await EmailTracking.findOneAndUpdate(
          { messageId: trackingId },
          {
            $inc: { openedCount: 1 },
            $set: {
              openedAt: new Date(timestamp),
              lastOpenedIP: ip
            }
          }
        );
        break;
      case 'clicked':
        await EmailTracking.findOneAndUpdate(
          { messageId: trackingId },
          {
            $push: {
              clickEvents: {
                url,
                clickedAt: new Date(timestamp),
                ip,
                userAgent
              }
            }
          }
        );
        break;
      case 'replied':
        await EmailTracking.findOneAndUpdate(
          { messageId: trackingId },
          { $set: { repliedAt: new Date(timestamp) } }
        );
        break;
      case 'sent':
        // No additional update needed for sent event
        break;
      default:
        return res.status(400).json({ success: false, error: 'Invalid event type' });
    }

    // Your UI update logic goes here
    // For example, you could emit a socket event or update a database for frontend polling
    console.log(`Processed webhook event: ${event} for trackingId: ${trackingId}`);

    res.status(200).json({ success: true, message: 'Webhook processed successfully' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 8️⃣ New Webhook Endpoint for SMTP Tracking
router.post('/session/smatpTracking', async (req, res) => {
  try {
    const { event, trackingId, email, from, subject, timestamp, ip, userAgent, openedCount, url, extractedTrackingData, replyDetails, messageId, recipients, contentUsed, trackingPayload, senderName, openEvents, uniqueOpens, clickEvents, totalClicks, originalMessageId, replyCount } = req.body;

    if (!event || !trackingId) {
      return res.status(400).json({ success: false, error: 'Missing required fields: event, trackingId' });
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
      replyCount
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
      receivedAt: new Date().toISOString()
    };

    console.log('📊 Detailed Event Data:', JSON.stringify(detailedEventData, null, 2));

    res.status(200).json({
      success: true,
      message: 'SMTP tracking webhook processed successfully',
      eventData: detailedEventData
    });
  } catch (error) {
    console.error('SMTP tracking webhook error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5️⃣ Detailed Email Provider Detection API
router.get('/api/email-provider', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email.includes('@')) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    const domain = email.split('@')[1];
    const smtpSettings = await getSMTPSettings(email);

    // Get detailed MX analysis
    const mxRecords = await cachedMxLookup(domain);
    const sorted = mxRecords.sort((a, b) => a.priority - b.priority);

    // Comprehensive provider detection
    const providerAnalysis = {
      domain: domain,
      mx_records: sorted.map(mx => ({
        priority: mx.priority,
        exchange: mx.exchange,
        is_self_hosted: mx.exchange === domain || mx.exchange.endsWith(`.${domain}`),
        is_google: mx.exchange.includes('google'),
        is_microsoft: mx.exchange.includes('outlook') || mx.exchange.includes('hotmail') || mx.exchange.includes('microsoft'),
        is_yahoo: mx.exchange.includes('yahoo'),
        is_cpanel: mx.exchange.includes('cpanel') || mx.exchange.includes('whm')
      })),

      provider_detection: {
        is_google_workspace: sorted.some(mx => mx.exchange.includes('google')),
        is_outlook: sorted.some(mx =>
          mx.exchange.includes('outlook') ||
          mx.exchange.includes('hotmail') ||
          mx.exchange.includes('microsoft')
        ),
        is_yahoo: sorted.some(mx => mx.exchange.includes('yahoo')),
        is_cpanel: sorted.some(mx =>
          mx.exchange.includes('cpanel') ||
          mx.exchange.includes('whm') ||
          mx.exchange === domain ||
          mx.exchange.endsWith(`.${domain}`)
        ),
        is_self_hosted: sorted.some(mx =>
          mx.exchange === domain ||
          mx.exchange.endsWith(`.${domain}`)
        ),
        is_known_provider: ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'zoho.com'].includes(domain)
      },

      recommended_settings: {
        smtp_host: smtpSettings.host,
        smtp_port: smtpSettings.port,
        imap_host: smtpSettings.host.replace('smtp.', 'imap.'),
        imap_port: 993,
        secure: smtpSettings.port === 465,
        tls: smtpSettings.port === 587
      },

      alternative_settings: {
        cpanel_style: {
          smtp_host: `mail.${domain}`,
          smtp_port: 465,
          imap_host: `mail.${domain}`,
          imap_port: 993
        },
        standard_style: {
          smtp_host: `smtp.${domain}`,
          smtp_port: 587,
          imap_host: `imap.${domain}`,
          imap_port: 993
        }
      },

      confidence_score: calculateConfidenceScore(sorted, domain),
      recommendations: generateProviderRecommendations(sorted, domain, smtpSettings)
    };

    return res.json({
      success: true,
      email: email,
      analysis: providerAnalysis
    });

  } catch (error) {
    console.error('Provider detection error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to analyze email provider',
      details: error.message
    });
  }
});

// Helper function to calculate confidence score
function calculateConfidenceScore(mxRecords, domain) {
  let score = 0;
  const totalRecords = mxRecords.length;

  if (totalRecords === 0) return 0;

  // Check for known providers
  const hasGoogle = mxRecords.some(mx => mx.exchange.includes('google'));
  const hasMicrosoft = mxRecords.some(mx =>
    mx.exchange.includes('outlook') ||
    mx.exchange.includes('hotmail') ||
    mx.exchange.includes('microsoft')
  );
  const hasYahoo = mxRecords.some(mx => mx.exchange.includes('yahoo'));
  const isSelfHosted = mxRecords.some(mx =>
    mx.exchange === domain ||
    mx.exchange.endsWith(`.${domain}`)
  );

  if (hasGoogle) score += 40;
  if (hasMicrosoft) score += 40;
  if (hasYahoo) score += 40;
  if (isSelfHosted) score += 30;

  // Bonus for multiple matching records
  const matchingRecords = mxRecords.filter(mx =>
    mx.exchange.includes('google') ||
    mx.exchange.includes('outlook') ||
    mx.exchange.includes('hotmail') ||
    mx.exchange.includes('microsoft') ||
    mx.exchange.includes('yahoo') ||
    mx.exchange === domain ||
    mx.exchange.endsWith(`.${domain}`)
  ).length;

  score += (matchingRecords / totalRecords) * 30;

  return Math.min(score, 100);
}

// Helper function to generate provider recommendations
function generateProviderRecommendations(mxRecords, domain, smtpSettings) {
  const recommendations = [];

  const isGoogle = mxRecords.some(mx => mx.exchange.includes('google'));
  const isMicrosoft = mxRecords.some(mx =>
    mx.exchange.includes('outlook') ||
    mx.exchange.includes('hotmail') ||
    mx.exchange.includes('microsoft')
  );
  const isSelfHosted = mxRecords.some(mx =>
    mx.exchange === domain ||
    mx.exchange.endsWith(`.${domain}`)
  );

  if (isGoogle) {
    recommendations.push({
      type: 'primary',
      provider: 'Google Workspace',
      settings: {
        smtp_host: 'smtp.gmail.com',
        smtp_port: 587,
        imap_host: 'imap.gmail.com',
        imap_port: 993,
        auth_method: 'OAuth2 or App Password',
        security: 'TLS'
      }
    });
  }

  if (isMicrosoft) {
    recommendations.push({
      type: 'primary',
      provider: 'Microsoft 365/Outlook',
      settings: {
        smtp_host: 'smtp-mail.outlook.com',
        smtp_port: 587,
        imap_host: 'outlook.office365.com',
        imap_port: 993,
        auth_method: 'OAuth2 or App Password',
        security: 'TLS'
      }
    });
  }

  if (isSelfHosted) {
    recommendations.push({
      type: 'primary',
      provider: 'Self-hosted (cPanel/WHM)',
      settings: {
        smtp_host: `mail.${domain}`,
        smtp_port: 465,
        imap_host: `mail.${domain}`,
        imap_port: 993,
        auth_method: 'Username/Password',
        security: 'SSL'
      }
    });
  }

  // Fallback recommendations
  if (!isGoogle && !isMicrosoft && !isSelfHosted) {
    recommendations.push({
      type: 'fallback',
      provider: 'Generic SMTP',
      settings: {
        smtp_host: `smtp.${domain}`,
        smtp_port: 587,
        imap_host: `imap.${domain}`,
        imap_port: 993,
        auth_method: 'Username/Password',
        security: 'TLS'
      }
    });

    recommendations.push({
      type: 'fallback',
      provider: 'cPanel Style',
      settings: {
        smtp_host: `mail.${domain}`,
        smtp_port: 465,
        imap_host: `mail.${domain}`,
        imap_port: 993,
        auth_method: 'Username/Password',
        security: 'SSL'
      }
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
    throw new Error('Email is required');
  }

  console.log(`🔍 Getting SMTP settings for: ${email}`);

  // Try cPanel API first
  try {
    const cpanelResponse = await cpanelRequest('Email/get_client_settings', {
      account: email
    });

    if (cpanelResponse && cpanelResponse.data && cpanelResponse.data.smtp_host && cpanelResponse.data.smtp_port) {
      const smtpData = cpanelResponse.data;

      console.log(`✅ cPanel API success for ${email}:`, {
        host: smtpData.smtp_host,
        port: smtpData.smtp_port
      });

      return {
        success: true,
        email: email,
        smtp: {
          smtp_host: smtpData.smtp_host,
          smtp_port: parseInt(smtpData.smtp_port) || 465,
          smtp_username: smtpData.smtp_username
        },
        imap: {
          inbox_host: smtpData.inbox_host,
          inbox_port: smtpData.inbox_port,
          inbox_username: smtpData.inbox_username,
          inbox_service: smtpData.inbox_service,
          mail_domain: smtpData.mail_domain
        },
        domain: smtpData.domain,
        account: smtpData.account,
        display: smtpData.display,
        source: 'cPanel API'
      };
    } else {
      console.log(`❌ cPanel API response missing SMTP settings for ${email}:`, cpanelResponse);
    }
  } catch (cpanelError) {
    console.log(`❌ cPanel API failed for ${email}:`, cpanelError.message);
  }

  // Fallback to DNS lookup
  try {
    const domain = email.split('@')[1].toLowerCase();
    const mxRecords = await cachedMxLookup(domain);

    console.log(`🔍 DNS MX lookup for domain: ${domain}`);

    // Use existing logic to determine SMTP settings
    const smtpSettings = await getSMTPSettings(email);

    return {
      success: true,
      email: email,
      host: smtpSettings.host,
      port: smtpSettings.port,
      source: 'DNS MX Lookup'
    };

  } catch (dnsError) {
    console.log(`❌ DNS lookup failed for ${email}:`, dnsError.message);

    throw new Error('Could not determine SMTP settings');
  }
}

// Start periodic reply checking
setInterval(checkForReplies, 2 * 60 * 1000);


//___________________get smpt host & port cpanl API_____

// New API endpoint to get SMTP settings from cPanel API
router.post('/api/get-smtphost', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    const smtpSettings = await getSMTPSettingsForEmail(email);

    return res.json(smtpSettings);

  } catch (error) {
    console.error('Get SMTP Settings Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

//___________________delete SMTP config API_____

router.delete('/api/delete-smtpconfig', async (req, res) => {
  try {
    const { email, token } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    // If token is provided, verify it matches the email
    if (token) {
      const smtpRecord = await SMTPAuth.findOne({ email, token });
      if (!smtpRecord) {
        return res.status(403).json({
          success: false,
          error: 'Invalid token or email not found'
        });
      }
    }

    // Delete the SMTP configuration
    const deletedRecord = await SMTPAuth.findOneAndDelete({ email });

    if (!deletedRecord) {
      return res.status(404).json({
        success: false,
        error: 'SMTP configuration not found for this email'
      });
    }

    console.log(`✅ SMTP config deleted for: ${email}`);

    return res.json({
      success: true,
      message: `SMTP configuration deleted successfully for ${email}`,
      deletedEmail: email,
      deletedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Delete SMTP Config Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = {
  router,
  getSMTPSettings,
  getSMTPSettingsForEmail
};
