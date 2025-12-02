const express = require('express');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const dns = require('node:dns').promises;
const crypto = require('crypto');
const mongoose = require('mongoose');
require('dotenv').config();

const ical = require('ical');
const IcalExpander = require('ical-expander');
const fetch = require('node-fetch');

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
      trackingPayload,
      attachments
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
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      emailOptions.attachments = attachments;
    }

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
        trackingEnabled: !!trackLinks,
        attachmentsCount: attachments ? attachments.length : 0
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
        trackingEnabled: !!trackLinks,
        attachmentsCount: attachments ? attachments.length : 0
      },
      trackingPayload: trackingPayload || null,
      senderName: sender_name || null
    });
  } catch (err) {
    console.error('Email Send Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2️⃣.5️⃣ Forward Email
// 2️⃣.5️⃣ Forward Email - SIMPLE SEND ONLY VERSION
router.post('/api/emailforward', async (req, res) => {
  try {
    const {
      token,
      from,
      to,
      cc,
      bcc,
      originalMessageId,
      additionalHtml = '',
      additionalText = '',
      trackLinks = false,
      sender_name,
      trackingPayload,
      attachments = [],
      originalSubject = '', // Optional: Pass original subject if known
      originalFrom = '',    // Optional: Pass original from if known
      originalDate = ''     // Optional: Pass original date if known
    } = req.body;

    console.log(`📧 Forward Email - Simple Send: ${from} -> ${to}`);

    // Validate required fields
    if (!token || !from || !to || !originalMessageId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: token, from, to, originalMessageId'
      });
    }

    // Get SMTP credentials
    const smtp = await SMTPAuth.findOne({ email: from, token });
    if (!smtp) {
      return res.status(403).json({
        success: false,
        error: 'Invalid token or sender email'
      });
    }

    const decryptedPass = decrypt(smtp.pass);

    // Create subject
    const subject = originalSubject
      ? `Fwd: ${originalSubject}`
      : `Fwd: Message ${originalMessageId.substring(0, 20)}...`;

    // Generate tracking ID
    const trackingId = crypto.randomBytes(16).toString('hex');
    const baseUrl = process.env.BASE_URL || 'https://videoresponse.onepgr.com:3001';

    // Create email content
    let emailHtml = additionalHtml || '';
    let emailText = additionalText || '';

    // Add forward header
    const forwardHeaderHtml = `
      <br><br>
      <div style="border-left: 3px solid #ccc; padding-left: 15px; margin-left: 10px; color: #666;">
        <p><strong>---------- Forwarded Message ---------</strong></p>
        ${originalFrom ? `<p><strong>From:</strong> ${originalFrom}</p>` : ''}
        ${originalDate ? `<p><strong>Date:</strong> ${originalDate}</p>` : ''}
        ${originalSubject ? `<p><strong>Subject:</strong> ${originalSubject}</p>` : ''}
        <p><strong>Original Message ID:</strong> ${originalMessageId}</p>
      </div>
      <br>
      <p><em>[This is a forwarded email notification]</em></p>
    `;

    const forwardHeaderText = `
    
---------- Forwarded Message ---------
${originalFrom ? `From: ${originalFrom}` : ''}
${originalDate ? `Date: ${originalDate}` : ''}
${originalSubject ? `Subject: ${originalSubject}` : ''}
Original Message ID: ${originalMessageId}

[This is a forwarded email notification]
    `;

    emailHtml += forwardHeaderHtml;
    emailText += forwardHeaderText;

    // Add tracking if enabled
    if (emailHtml && trackLinks) {
      const trackingPixelUrl = `${baseUrl}/api/track/open/${trackingId}`;
      emailHtml += `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none;border:0;" alt=""/>\n`;

      // Replace links with tracking links
      emailHtml = emailHtml.replace(/href=["'](.*?)["']/g, (match, url) => {
        if (url.startsWith('http') && !url.includes(baseUrl) && !url.includes('mailto:')) {
          const encodedUrl = encodeURIComponent(url);
          return `href="${baseUrl}/api/track/click/${trackingId}?url=${encodedUrl}"`;
        }
        return match;
      });
    }

    // Create transporter
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: from, pass: decryptedPass },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10000
    });

    // Verify connection
    try {
      await transporter.verify();
      console.log('✅ SMTP connection verified');
    } catch (verifyError) {
      console.error('❌ SMTP verification failed:', verifyError.message);
      return res.status(500).json({
        success: false,
        error: `SMTP connection failed: ${verifyError.message}`
      });
    }

    // Prepare email options
    const fromField = sender_name ? `${sender_name} <${from}>` : from;
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
        'In-Reply-To': originalMessageId,
        'References': originalMessageId
      }
    };

    // Add optional fields
    if (cc) emailOptions.cc = cc;
    if (bcc) emailOptions.bcc = bcc;
    if (attachments && attachments.length > 0) {
      emailOptions.attachments = attachments;
    }

    // Send email
    console.log(`📤 Sending forward email...`);
    const info = await transporter.sendMail(emailOptions);
    console.log(`✅ Email sent successfully: ${info.messageId}`);

    // Save tracking record
    const trackingRecord = new EmailTracking({
      messageId: trackingId,
      originalMessageId: info.messageId,
      fromEmail: from,
      toEmail: to,
      subject: subject,
      webhookUrl: 'https://meet.onepgr.com/session/smatpTracking',
      emailContent: {
        html: emailHtml,
        text: emailText
      },
      trackingPayload: trackingPayload || null
    });

    await trackingRecord.save();

    // Send success response immediately
    return res.json({
      success: true,
      message: 'Email forwarded successfully',
      messageId: info.messageId,
      trackingId: trackingId,
      subject: subject,
      timestamp: new Date().toISOString(),
      attachmentsCount: attachments.length || 0
    });

  } catch (err) {
    console.error('❌ Forward Email Error:', err.message);

    // Determine error type for better response
    let statusCode = 500;
    let errorMessage = err.message;

    if (err.code === 'EAUTH') {
      statusCode = 401;
      errorMessage = 'Authentication failed - check your email credentials';
    } else if (err.code === 'ECONNECTION') {
      statusCode = 503;
      errorMessage = 'Cannot connect to email server';
    } else if (err.code === 'EENVELOPE') {
      statusCode = 400;
      errorMessage = 'Invalid email address';
    }

    return res.status(statusCode).json({
      success: false,
      error: errorMessage,
      code: err.code
    });
  }
});

// 3️⃣ Inbox Fetch with Read/Unread
router.post('/api/fetchinbox', async (req, res) => {
  try {
    const { token, email, page = 1, limit = 20 } = req.body;
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
    const totalMessages = lock.exists;

    // Calculate pagination
    const maxLimit = Math.min(limit, 50); // Max 50 per page
    const currentPage = Math.max(parseInt(page), 1);
    const totalPages = Math.ceil(totalMessages / maxLimit);

    // Calculate message range (IMAP uses 1-based indexing, newest first)
    const startSeq = Math.max(totalMessages - (currentPage * maxLimit) + 1, 1);
    const endSeq = Math.max(totalMessages - ((currentPage - 1) * maxLimit), 1);

    console.log(`Fetching messages ${startSeq}:${endSeq} (Page ${currentPage}, Limit ${maxLimit})`);

    const messages = [];

    if (startSeq <= endSeq) {
      for await (let msg of client.fetch(`${startSeq}:${endSeq}`, {
        envelope: true,
        uid: true,
        flags: true,
        source: true,
        bodyStructure: true
      })) {
        const parsed = await simpleParser(msg.source);

        // Clean HTML content
        let cleanHtml = parsed.html || '';
        if (cleanHtml) {
          cleanHtml = cleanHtml.replace(/https:\/\/tracking\.inflection\.io\/[^"']+/g, (url) => {
            try {
              const urlObj = new URL(url);
              const redirect = urlObj.searchParams.get('redirect');
              return redirect || url;
            } catch {
              return url;
            }
          });

          cleanHtml = cleanHtml.replace(/<span[^>]*id="inflection-email-preheader"[^>]*>.*?<\/span>/gis, '');
        }

        // Extract clean text
        let cleanText = parsed.text || '';
        if (cleanText) {
          cleanText = cleanText.replace(/https:\/\/tracking\.inflection\.io\/[^\s]+/g, '');
        }

        messages.push({
          subject: msg.envelope.subject,
          from: msg.envelope.from.map(f => `${f.name || ''} <${f.address}>`).join(', '),
          date: msg.envelope.date,
          uid: msg.uid,
          seq: msg.seq, // Store sequence number for reference
          read: Array.isArray(msg.flags) ? msg.flags.includes('\\Seen') : false,
          text: cleanText,
          html: cleanHtml,
          to: msg.envelope.to?.map(t => `${t.name || ''} <${t.address}>`).join(', '),
          cc: msg.envelope.cc?.map(c => `${c.name || ''} <${c.address}>`).join(', '),
          messageId: msg.envelope.messageId
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
        hasPrevPage: currentPage > 1
      }
    });
  } catch (err) {
    console.error('Inbox Fetch Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});


// 9️⃣ Fetch Specific Email by Message ID
// 9️⃣ Fetch Specific Email by Message ID - Fixed version
router.post('/api/fetchsingleemail', async (req, res) => {
  let client;
  try {
    const { token, email, messageId, mailbox = 'INBOX' } = req.body;

    console.log(`📥 [FetchSingle] START request for: ${email}`);
    console.log(`👉 [FetchSingle] Looking for Message-ID: ${messageId} in Box: ${mailbox}`);

    if (!token || !email || !messageId) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
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

    console.log(`🔌 [FetchSingle] Using SMTP Host for IMAP: ${smtp.host}`);

    client = new ImapFlow({
      host: smtp.host,
      port: 993,
      secure: true,
      auth: {
        user: email,
        pass: decryptedPass
      },
      logger: false,
      timeout: 45000 // Increased timeout
    });

    console.log(`🔌 [FetchSingle] Attempting IMAP connection...`);

    await client.connect();
    console.log(`✅ [FetchSingle] IMAP connection successful`);

    const lock = await client.mailboxOpen(mailbox);
    console.log(`📂 [FetchSingle] Mailbox opened. Total messages: ${lock.exists}`);
    console.log(`🔎 [FetchSingle] Searching for Message-ID: ${messageId}`);

    // Search for the message
    const messageUids = await client.search({
      header: { 'Message-ID': messageId }
    });

    console.log(`🔢 [FetchSingle] Found ${messageUids.length} matching message(s)`);

    if (!messageUids || messageUids.length === 0) {
      // Quick logout for not found case
      try {
        await client.logout();
      } catch (e) {
        await client.close();
      }
      return res.status(404).json({
        success: false,
        error: 'Email not found with the provided Message-ID'
      });
    }

    let foundEmail = null;
    let processedCount = 0;

    console.log(`📨 [FetchSingle] Starting to fetch message with UID: ${messageUids[0]}`);

    // Fetch the message
    for await (let msg of client.fetch(messageUids, {
      byUid: true,
      envelope: true,
      uid: true,
      flags: true,
      source: true
    })) {
      console.log(`🔄 [FetchSingle] Processing message ${++processedCount}`);

      const parsed = await simpleParser(msg.source);
      console.log(`📝 [FetchSingle] Email parsed successfully, subject: "${msg.envelope.subject}"`);

      // Clean HTML content
      let cleanHtml = parsed.html || '';
      if (cleanHtml) {
        console.log(`🧹 [FetchSingle] Cleaning HTML content...`);
        cleanHtml = cleanHtml.replace(/https:\/\/tracking\.inflection\.io\/[^"']+/g, (url) => {
          try {
            const urlObj = new URL(url);
            const redirect = urlObj.searchParams.get('redirect');
            return redirect || url;
          } catch {
            return url;
          }
        });

        cleanHtml = cleanHtml.replace(/<span[^>]*id="inflection-email-preheader"[^>]*>.*?<\/span>/gis, '');
      }

      // Extract clean text
      let cleanText = parsed.text || '';
      if (cleanText) {
        cleanText = cleanText.replace(/https:\/\/tracking\.inflection\.io\/[^\s]+/g, '');
      }

      foundEmail = {
        subject: msg.envelope.subject,
        from: msg.envelope.from.map(f => ({
          name: f.name || '',
          address: f.address
        })),
        date: msg.envelope.date,
        uid: msg.uid,
        read: Array.isArray(msg.flags) ? msg.flags.includes('\\Seen') : false,
        text: cleanText,
        html: cleanHtml,
        to: msg.envelope.to?.map(t => ({
          name: t.name || '',
          address: t.address
        })) || [],
        cc: msg.envelope.cc?.map(c => ({
          name: c.name || '',
          address: c.address
        })) || [],
        messageId: msg.envelope.messageId,
        attachments: parsed.attachments ? parsed.attachments.map(att => ({
          filename: att.filename,
          contentType: att.contentType,
          size: att.size
        })) : []
      };

      console.log(`✅ [FetchSingle] Message processed successfully`);
      break;
    }

    // SEND RESPONSE FIRST, then cleanup connection
    console.log(`🎉 [FetchSingle] SUCCESS - Sending response first for: "${foundEmail.subject}"`);

    // Send response immediately
    res.json({
      success: true,
      email: foundEmail
    });

    console.log(`✅ [FetchSingle] Response sent to client, now cleaning up connection...`);

    // Then cleanup connection in background
    try {
      await client.logout();
      console.log(`🔒 [FetchSingle] IMAP connection closed gracefully`);
    } catch (logoutError) {
      console.log(`⚠️ [FetchSingle] Logout failed, forcing close:`, logoutError.message);
      try {
        await client.close();
        console.log(`🔒 [FetchSingle] IMAP connection force-closed`);
      } catch (closeError) {
        console.log(`⚠️ [FetchSingle] Close also failed:`, closeError.message);
      }
    }

  } catch (err) {
    console.error('❌ [FetchSingle] Final Error:', err);

    // Send error response first
    if (!res.headersSent) {
      if (err.code === 'ETIMEDOUT' || err.code === 'ETIMEOUT') {
        return res.status(408).json({
          success: false,
          error: 'Connection timeout'
        });
      }

      return res.status(500).json({
        success: false,
        error: err.message
      });
    } else {
      console.log('⚠️ [FetchSingle] Response already sent, but error occurred during cleanup');
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
      return res.status(200).json({ success: false, error: 'Tracking not found' });
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




router.post('/api/fetchcalendar', async (req, res) => {
  try {
    const { token, email, provider, rangeStart, rangeEnd } = req.body;
    if (!token || !email) {
      return res.status(400).json({ success: false, error: 'Missing token or email' });
    }

    const smtp = await SMTPAuth.findOne({ email, token });
    if (!smtp) {
      return res.status(403).json({ success: false, error: 'Invalid token or sender email' });
    }

    const decryptedPass = decrypt(smtp.pass);
    const domain = email.split('@')[1].toLowerCase();
    const now = new Date();
    const start = rangeStart ? new Date(rangeStart) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = rangeEnd ? new Date(rangeEnd) : new Date(now.getFullYear(), now.getMonth() + 1, 0);

    let events = [];

    // 1️⃣ Google Workspace / Gmail ICS Feed
    if (domain.includes('gmail') || domain.includes('google')) {
      try {
        const googleFeedUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(email)}/public/basic.ics`;
        const response = await fetch(googleFeedUrl);
        const icsData = await response.text();
        const icalExpander = new IcalExpander({ ics: icsData, maxIterations: 1000 });
        const expanded = icalExpander.between(start, end);

        events = [
          ...expanded.events.map(e => ({
            eventId: e.uid,
            summary: e.summary,
            description: e.description,
            location: e.location,
            start: e.startDate.toJSDate(),
            end: e.endDate.toJSDate(),
            attendees: e.attendee ? (Array.isArray(e.attendee) ? e.attendee : [e.attendee]) : []
          })),
          ...expanded.occurrences.map(o => ({
            eventId: o.item.uid,
            summary: o.item.summary,
            description: o.item.description,
            location: o.item.location,
            start: o.startDate.toJSDate(),
            end: o.endDate.toJSDate(),
            attendees: o.item.attendee ? (Array.isArray(o.item.attendee) ? o.item.attendee : [o.item.attendee]) : []
          }))
        ];
      } catch (err) {
        console.log('Google calendar fetch failed:', err.message);
      }
    }

    // 2️⃣ Outlook / Microsoft 365 ICS (via autodiscover)
    else if (domain.includes('outlook') || domain.includes('hotmail') || domain.includes('microsoft')) {
      try {
        const outlookFeedUrl = `https://outlook.office365.com/owa/calendar/${encodeURIComponent(email)}/calendar.ics`;
        const response = await fetch(outlookFeedUrl, {
          headers: { 'Authorization': 'Basic ' + Buffer.from(`${email}:${decryptedPass}`).toString('base64') }
        });
        const icsData = await response.text();
        const icalExpander = new IcalExpander({ ics: icsData, maxIterations: 1000 });
        const expanded = icalExpander.between(start, end);

        events = events.concat(
          expanded.events.map(e => ({
            eventId: e.uid,
            summary: e.summary,
            description: e.description,
            start: e.startDate.toJSDate(),
            end: e.endDate.toJSDate(),
            attendees: e.attendee ? (Array.isArray(e.attendee) ? e.attendee : [e.attendee]) : []
          }))
        );
      } catch (err) {
        console.log('Outlook calendar fetch failed:', err.message);
      }
    }

    // 3️⃣ Self-hosted / cPanel Calendar via IMAP ICS attachment
    else {
      try {
        const client = new ImapFlow({
          host: smtp.host.replace('smtp.', 'imap.'),
          port: 993,
          secure: true,
          auth: { user: email, pass: decryptedPass },
          logger: false
        });
        await client.connect();
        await client.mailboxOpen('Calendar').catch(() => client.mailboxOpen('INBOX')); // fallback

        for await (let msg of client.fetch('1:*', { source: true })) {
          const parsed = await simpleParser(msg.source);
          if (parsed.attachments && parsed.attachments.length > 0) {
            for (const att of parsed.attachments) {
              if (att.contentType.includes('calendar') || att.filename.endsWith('.ics')) {
                const icalExpander = new IcalExpander({ ics: att.content.toString(), maxIterations: 100 });
                const expanded = icalExpander.between(start, end);
                events.push(...expanded.events.map(e => ({
                  eventId: e.uid,
                  summary: e.summary,
                  description: e.description,
                  start: e.startDate.toJSDate(),
                  end: e.endDate.toJSDate(),
                  attendees: e.attendee ? (Array.isArray(e.attendee) ? e.attendee : [e.attendee]) : []
                })));
              }
            }
          }
        }
        await client.logout();
      } catch (err) {
        console.log('Self-hosted calendar fetch failed:', err.message);
      }
    }

    return res.json({
      success: true,
      provider: domain,
      range: { start, end },
      totalEvents: events.length,
      events: events.sort((a, b) => new Date(a.start) - new Date(b.start))
    });
  } catch (error) {
    console.error('Calendar Fetch Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});


router.post('/api/fetchsent', async (req, res) => {
  let client;
  try {
    const { token, email, page = 1, limit = 20 } = req.body;
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

    client = new ImapFlow({
      host: smtp.host.replace('smtp.', 'imap.'), // Use IMAP host, not SMTP
      port: 993,
      secure: true,
      auth: { user: email, pass: decryptedPass },
      logger: false,
      timeout: 30000 // Add timeout to prevent hanging
    });

    await client.connect();

    // Try common Sent mailbox names across providers
    const candidateMailboxes = [
      '[Gmail]/Sent Mail', // Gmail
      'Sent Mail',
      'Sent Items',        // Outlook / Microsoft 365
      'Sent',              // cPanel/self-hosted
      'Sent Messages',
      'INBOX.Sent'
    ];

    let selectedBox = null;
    for (const box of candidateMailboxes) {
      try {
        const lock = await client.mailboxOpen(box);
        if (lock && typeof lock.exists === 'number') {
          selectedBox = { name: box, lock };
          console.log(`Found sent mailbox: ${box} with ${lock.exists} messages`);
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
              console.log(`Found sent mailbox via listing: ${mailbox.name} with ${lock.exists} messages`);
              break;
            } catch (error) {
              console.log(`Mailbox ${mailbox.name} failed: ${error.message}`);
            }
          }
        }
      } catch (error) {
        console.log('Mailbox listing failed:', error.message);
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
          hasPrevPage: false
        },
        message: 'No sent mailbox found or sent mailbox is empty'
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
          hasPrevPage: false
        }
      });
    }

    const totalPages = Math.ceil(totalMessages / maxLimit);

    // Fix: Calculate sequence numbers correctly (IMAP is 1-based)
    const startSeq = Math.max(totalMessages - (currentPage * maxLimit) + 1, 1);
    const endSeq = Math.max(totalMessages - ((currentPage - 1) * maxLimit), 1);

    console.log(`Fetching sent messages ${startSeq}:${endSeq} (Page ${currentPage}, Total: ${totalMessages})`);

    const messages = [];

    if (startSeq <= endSeq && startSeq >= 1 && endSeq >= 1) {
      try {
        for await (let msg of client.fetch(`${startSeq}:${endSeq}`, {
          envelope: true,
          uid: true,
          flags: true,
          source: true,
          bodyStructure: true
        })) {
          try {
            const parsed = await simpleParser(msg.source);

            // Clean HTML content
            let cleanHtml = parsed.html || '';
            if (cleanHtml) {
              cleanHtml = cleanHtml.replace(/https:\/\/tracking\.inflection\.io\/[^"]+/g, (url) => {
                try {
                  const urlObj = new URL(url);
                  const redirect = urlObj.searchParams.get('redirect');
                  return redirect || url;
                } catch {
                  return url;
                }
              });

              cleanHtml = cleanHtml.replace(/<span[^>]*id="inflection-email-preheader"[^>]*>.*?<\/span>/gis, '');
            }

            // Extract clean text
            let cleanText = parsed.text || '';
            if (cleanText) {
              cleanText = cleanText.replace(/https:\/\/tracking\.inflection\.io\/[^\s]+/g, '');
            }

            // FIXED: Proper read status detection for different flag types
            let isRead = false;
            let flagsArray = [];

            // Handle different types of flags object
            if (msg.flags) {
              if (Array.isArray(msg.flags)) {
                flagsArray = msg.flags;
                isRead = flagsArray.includes('\\Seen') || flagsArray.includes('Seen');
              } else if (msg.flags instanceof Set) {
                flagsArray = Array.from(msg.flags);
                isRead = flagsArray.includes('\\Seen') || flagsArray.includes('Seen');
              } else if (typeof msg.flags === 'object') {
                // Convert object to array of keys
                flagsArray = Object.keys(msg.flags);
                isRead = flagsArray.includes('\\Seen') || flagsArray.includes('Seen');
              }
            }

            console.log(`Message ${msg.uid} - Flags:`, flagsArray, 'Read:', isRead);

            messages.push({
              subject: msg.envelope.subject || '(No Subject)',
              from: msg.envelope.from?.map(f => `${f.name || ''} <${f.address}>`).join(', ') || email,
              date: msg.envelope.date || new Date(),
              uid: msg.uid,
              seq: msg.seq,
              read: isRead,
              flags: flagsArray, // Store as array for consistency
              text: cleanText,
              html: cleanHtml,
              to: msg.envelope.to?.map(t => `${t.name || ''} <${t.address}>`).join(', ') || '',
              cc: msg.envelope.cc?.map(c => `${c.name || ''} <${c.address}>`).join(', ') || '',
              bcc: msg.envelope.bcc?.map(b => `${b.name || ''} <${b.address}>`).join(', ') || '',
              messageId: msg.envelope.messageId,
              inReplyTo: msg.envelope.inReplyTo,
              references: msg.envelope.references
            });
          } catch (parseError) {
            console.error('Error parsing message:', parseError);
            // Continue with next message even if one fails
          }
        }
      } catch (fetchError) {
        console.error('Fetch error:', fetchError);
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
        hasPrevPage: currentPage > 1
      }
    });
  } catch (err) {
    console.error('Sent Fetch Error:', err);

    // Ensure client is properly closed even on error
    if (client) {
      try {
        await client.logout();
      } catch (logoutError) {
        console.error('Error during logout:', logoutError);
      }
    }

    return res.status(500).json({
      success: false,
      error: err.message,
      details: 'Failed to fetch sent emails. Please check your credentials and try again.'
    });
  }
});

//
module.exports = {
  router,
  getSMTPSettings,
  getSMTPSettingsForEmail
};
