// const express = require('express');
// const axios = require('axios');
// const router = express.Router();

// const NOTIFY_API_BASE_URL = 'https://api.notify.eu';
// const CLIENT_ID = process.env.NOTIFY_CLIENT_ID;
// const SECRET_KEY = process.env.NOTIFY_SECRET_KEY;

// /**
//  * @route POST /api/notify/send
//  * @desc Send notification via Notify.eu API
//  * @access Public
//  */
// router.post('/send', async (req, res) => {
//   try {
//     // Validate credentials
//     if (!CLIENT_ID || !SECRET_KEY) {
//       throw new Error('Notify.eu credentials not configured');
//     }

//     // Extract required fields from request
//     const {
//       notificationType,
//       language = 'en',
//       params = {},
//       scheduledAt,
//       transport,
//       attachments,
//       identifier
//     } = req.body;
//     console.log('sendEmail API REQUEST:', {
//       notificationType,
//       language,
//       params,
//       scheduledAt,
//       transport,
//       attachments,
//       identifier
//     });
//     // Validate minimum required fields
//     if (!notificationType || !transport) {
//       throw new Error('Missing required fields: notificationType and transport');
//     }

//     // Prepare payload according to Notify.eu specs
//     const payload = {
//       message: {
//         ...(identifier && { identifier }),
//         notificationType,
//         language,
//         ...(Object.keys(params).length > 0 && { params }),
//         ...(scheduledAt && { scheduledAt }),
//         transport: transport.map(t => ({
//           type: t.type,
//           ...(t.criteria && { criteria: t.criteria }),
//           ...(t.from && { from: t.from }),
//           recipients: {
//             to: t.recipients.to,
//             ...(t.recipients.cc && { cc: t.recipients.cc }),
//             ...(t.recipients.bcc && { bcc: t.recipients.bcc }),
//             ...(t.recipients['Reply-To'] && { 'Reply-To': t.recipients['Reply-To'] })
//           }
//         })),
//         ...(attachments && { attachments })
//       }
//     };

//          // Make API request
//      const response = await axios.post(`${NOTIFY_API_BASE_URL}/notification/send`, payload, {
//        headers: {
//          'X-ClientId': CLIENT_ID,
//          'X-SecretKey': SECRET_KEY,
//          'Content-Type': 'application/json'
//        },
//        timeout: 10000
//      });

//      // Log successful response
//      console.log('SUCCESS RESPONSE:', {
//        status: response.status,
//        data: JSON.stringify(response.data, null, 2),
//        request: {
//          url: response.config?.url,
//          payload: JSON.stringify(payload, null, 2)
//        }
//      });

//      return res.json({
//        success: true,
//        data: response.data
//      });

//   } catch (error) {
//     console.error('FULL ERROR:', {
//       status: error.response?.status,
//       data: JSON.stringify(error.response?.data, null, 2),
//       errors: error.response?.data?.errors ? JSON.stringify(error.response?.data.errors, null, 2) : 'No errors array',
//       request: {
//         url: error.config?.url,
//         data: error.config?.data
//       }
//     });

//     const statusCode = error.response?.status || 500;
//     const errorData = error.response?.data || { message: error.message };

//     return res.status(statusCode).json({
//       success: false,
//       error: errorData
//     });
//   }
// });

// module.exports = router;


// const express = require('express');
// const { MailSlurp } = require('mailslurp-client');
// require('dotenv').config();

// const router = express.Router();
// const mailslurp = new MailSlurp({ apiKey: process.env.MAILSLURP_API_KEY });

// /**
//  * @route POST /api/email/send
//  * @desc Send email using MailSlurp
//  */
// router.post('/send', async (req, res) => {
//   try {
//     const { to, subject, body } = req.body;

//     // Create a new inbox (or use a fixed inboxId if needed)
//     const inbox = await mailslurp.createInbox();

//     // Send the email
//     const sendResult = await mailslurp.sendEmail(inbox.id, {
//       to: [to],
//       subject,
//       body,
//       isHTML: true,
//     });

//     return res.json({
//       success: true,
//       inboxId: inbox.id,
//       to,
//       messageId: sendResult.id,
//     });
//   } catch (err) {
//     console.error(err);
//     return res.status(500).json({ success: false, error: err.message });
//   }
// });

// /**
//  * @route GET /api/email/inbox/:inboxId
//  * @desc Fetch latest emails from inbox
//  */
// router.get('/inbox/:inboxId', async (req, res) => {
//   try {
//     const { inboxId } = req.params;

//     // Get latest emails
//     const emails = await mailslurp.getEmails(inboxId, {
//       size: 5, // fetch last 5 emails
//       sort: 'DESC',
//     });

//     const result = await Promise.all(
//       emails.map(async email => {
//         const full = await mailslurp.getEmail(email.id);
//         return {
//           id: full.id,
//           subject: full.subject,
//           from: full.from,
//           to: full.to,
//           body: full.body,
//           html: full.body.includes('<html') ? full.body : null,
//         };
//       })
//     );

//     return res.json({ success: true, messages: result });
//   } catch (err) {
//     console.error(err);
//     return res.status(500).json({ success: false, error: err.message });
//   }
// });

// module.exports = router;



// const express = require('express');
// const nodemailer = require('nodemailer');
// const { ImapFlow } = require('imapflow');
// const router = express.Router();
// require('dotenv').config();
// const simpleParser = require('mailparser').simpleParser;
// const dns = require('node:dns').promises;
// let smtpConfig = null;

// // _____________1️⃣ Setup sender (store SMTP config in memory for this demo)____________________

// router.post('/sender/setup', (req, res) => {
//   const { host, port, user, pass } = req.body;
//   console.log('SMTP credentials:', { host, port, user, pass });
//   if (!host || !port || !user || !pass) {
//     return res.status(400).json({ success: false, error: 'Missing SMTP credentials' });
//   }

//   smtpConfig = {
//     host,
//     port,
//     secure: true,
//     auth: {
//       user,
//       pass
//     }
//   };

//   return res.json({ success: true, message: 'SMTP sender configured' });
// });

// // _____________2️⃣ Send email using saved sender config____________________

// router.post('/send', async (req, res) => {
//   try {
//     if (!smtpConfig) {
//       return res.status(400).json({ success: false, error: 'Sender not configured' });
//     }

//     const { to, subject, html, text } = req.body;

//     const transporter = nodemailer.createTransport(smtpConfig);

//     const info = await transporter.sendMail({
//       from: smtpConfig.auth.user,
//       to,
//       subject,
//       text,
//       html
//     });

//     return res.json({ success: true, messageId: info.messageId });
//   } catch (err) {
//     console.error(err);
//     return res.status(500).json({ success: false, error: err.message });
//   }
// });


// // _____________3️⃣ Retrieve inbox (IMAP read)____________________
// router.post('/inbox', async (req, res) => {
//   const { host, user, pass, limit = 10 } = req.body;

//   if (!host || !user || !pass) {
//     return res.status(400).json({ success: false, error: 'Missing required IMAP credentials (host, user, pass)' });
//   }

//   try {
//     const client = new ImapFlow({
//       host,
//       port: 993,
//       secure: true,
//       auth: { user, pass },
//       logger: false // Disable ImapFlow debug logs
//     });

//     await client.connect();
//     const lock = await client.mailboxOpen('INBOX');

//     const total = lock.exists; // total number of messages
//     const maxLimit = Math.max(Math.min(limit, 50), 1); // clamp between 1-50
//     const start = Math.max(total - (maxLimit - 1), 1); // last N messages

//     console.log(`Fetching messages ${start} to ${total} (last ${maxLimit} messages)`);

//     const messages = [];

//     for await (let msg of client.fetch(`${start}:${total}`, { envelope: true, uid: true, flags: true, source: true })) {
//       const parsed = await simpleParser(msg.source);

//       messages.push({
//         subject: msg.envelope.subject,
//         from: msg.envelope.from.map(f => `${f.name} <${f.address}>`).join(', '),
//         date: msg.envelope.date,
//         flags: msg.flags,
//         uid: msg.uid,
//         text: parsed.text || '',
//         html: parsed.html || ''
//       });
//     }

//     await client.logout();

//     return res.json({
//       success: true,
//       inbox: messages.reverse(), // reverse to show newest first
//       total: total,
//       fetched: messages.length
//     });

//   } catch (err) {
//     console.error('IMAP error:', err);
//     return res.status(500).json({ success: false, error: err.message });
//   }
// });

// // _____________4️⃣ get host from email____________________


// router.get('/get-host', async (req, res) => {
//   try {
//     const { email } = req.query;

//     if (!email || !email.includes('@')) {
//       return res.status(400).json({ success: false, message: 'Invalid email address' });
//     }

//     const domain = email.split('@')[1];

//     // Perform MX lookup
//     const mxRecords = await dns.resolveMx(domain);
//     const sorted = mxRecords.sort((a, b) => a.priority - b.priority);
//     const mainExchange = sorted[0]?.exchange || `mail.${domain}`;

//     return res.json({
//       success: true,
//       domain,
//       suggested_smtp: `mail.${domain}`,
//       suggested_imap: `mail.${domain}`,
//       mx_records: sorted
//     });
//   } catch (err) {
//     console.error('MX Lookup error:', err);
//     return res.status(500).json({ success: false, message: 'Could not resolve host', error: err.message });
//   }
// });


// module.exports = router;


// Secure Email API with SMTP Send and IMAP Retrieve - MongoDB Backed

const express = require('express');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const dns = require('node:dns').promises;
const crypto = require('crypto');
const mongoose = require('mongoose');
require('dotenv').config();

const router = express.Router();

// AES Encryption/Decryption functions
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const IV_LENGTH = 16;

function encrypt(text) {
  if (!ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  if (ENCRYPTION_KEY.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 characters long');
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  if (!ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  if (ENCRYPTION_KEY.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 characters long');
  }

  const [iv, encryptedText] = text.split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(ENCRYPTION_KEY),
    Buffer.from(iv, 'hex')
  );
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// MongoDB Model
const smtpAuthSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  host: String,
  port: Number,
  pass: String, // This will store encrypted password
  token: String,
  createdAt: { type: Date, default: Date.now }
}, { collection: 'email_smtp_auth' });

const SMTPAuth = mongoose.model('SMTPAuth', smtpAuthSchema);

// Connect MongoDB
mongoose.connect(process.env.ONEPGR_MONGO_URI, {
  dbName: 'onepgr_apps',
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// 1️⃣ Setup Sender and generate API token
router.post('/api/senderemail/smtpauth', async (req, res) => {
  try {
    const { host, port, email, pass } = req.body;
    if (!host || !port || !email || !pass) {
      return res.status(400).json({ success: false, error: 'Missing required fields: host, port, email, pass' });
    }

    // Validate ENCRYPTION_KEY
    if (!ENCRYPTION_KEY) {
      return res.status(500).json({ success: false, error: 'ENCRYPTION_KEY environment variable is not configured' });
    }
    if (ENCRYPTION_KEY.length !== 32) {
      return res.status(500).json({ success: false, error: 'ENCRYPTION_KEY must be exactly 32 characters long' });
    }

    // Check if email already exists
    const existingRecord = await SMTPAuth.findOne({ email });
    
    if (existingRecord) {
      // If email already exists, return error with existing token
      console.log(`Email ${email} already exists with token: ${existingRecord.token}`);
      return res.status(409).json({
        success: false,
        error: 'Email already configured',
        message: `Email ${email} is already created with token: ${existingRecord.token}`,
        existingToken: existingRecord.token,
        createdAt: existingRecord.createdAt
      });
    }

    // Generate new token for new record
    const token = crypto.randomBytes(6).toString('hex');
    console.log(`Creating new SMTP auth for email: ${email}`);

    // Encrypt the password before saving
    const encryptedPass = encrypt(pass);

    // Create new record
    const result = await SMTPAuth.create({
      email,
      host,
      port,
      pass: encryptedPass,
      token
    });

    console.log(`SMTP auth created successfully for email: ${email}`);

    return res.json({
      success: true,
      token,
      message: `New SMTP auth created for ${email}. Use token: ${token} to send and retrieve emails`
    });
  } catch (error) {
    console.error('SMTP Auth Error:', error);
    
    // Handle duplicate key error specifically
    if (error.code === 11000) {
      return res.status(409).json({ 
        success: false, 
        error: 'Email already exists',
        message: 'This email is already configured. Please use a different email or contact support.'
      });
    }
    
    return res.status(500).json({ success: false, error: error.message });
  }
});

// 2️⃣ Send Email
router.post('/api/emailsend', async (req, res) => {
  try {
    const { token, from, to, subject, html, text, template, templateData } = req.body;
    if (!token || !from) {
      return res.status(400).json({ success: false, error: 'Missing API token or from email' });
    }

    const smtp = await SMTPAuth.findOne({ email: from, token });
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

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: true,
      auth: { user: from, pass: decryptedPass }
    });

    // Generate professional email content
    let emailHtml = html;
    let emailText = text;

    if (template) {
      const templateContent = generateEmailTemplate(template, templateData || {});
      emailHtml = templateContent.html;
      emailText = templateContent.text;
    } else if (!html && !text) {
      // Default professional template if no content provided
      const defaultTemplate = generateEmailTemplate('default', { subject, content: 'This is a professional email.' });
      emailHtml = defaultTemplate.html;
      emailText = defaultTemplate.text;
    }

    const info = await transporter.sendMail({
      from: from,
      to,
      subject,
      html: emailHtml,
      text: emailText
    });

    return res.json({ success: true, messageId: info.messageId });
  } catch (err) {
    console.error('Email Send Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Professional Email Template Generator
function generateEmailTemplate(templateName, data) {
  const templates = {
    default: {
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${data.subject || 'Professional Email'}</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
            .content { padding: 40px 30px; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 14px; }
            .button { display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .signature { border-top: 1px solid #eee; margin-top: 30px; padding-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${data.subject || 'Professional Communication'}</h1>
            </div>
            <div class="content">
              <p>${data.content || 'Thank you for your attention to this matter.'}</p>
              ${data.callToAction ? `<a href="${data.callToAction.url}" class="button">${data.callToAction.text}</a>` : ''}
              <div class="signature">
                <p><strong>Best regards,</strong><br>
                ${data.senderName || 'Your Team'}</p>
              </div>
            </div>
            <div class="footer">
              <p>This email was sent from a professional email service.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `${data.subject || 'Professional Email'}\n\n${data.content || 'Thank you for your attention to this matter.'}\n\nBest regards,\n${data.senderName || 'Your Team'}`
    },


    plaintext: {
      html: `
        <p>Hello!</p>
        <p>${data.content || 'This is a simple message.'}</p>
        <br/>
        <p>Best regards,<br/>${data.senderName || 'Team EngageGPT'}</p>
      `,
      text: `Hello!\n\n${data.content || 'This is a simple message.'}\n\nBest regards,\n${data.senderName || 'Team EngageGPT'}`
    },


    welcome: {
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome!</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
            .header { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; text-align: center; }
            .content { padding: 40px 30px; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 14px; }
            .button { display: inline-block; padding: 12px 24px; background: #28a745; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Welcome, ${data.name || 'there'}! 🎉</h1>
            </div>
            <div class="content">
              <p>We're excited to have you on board!</p>
              <p>${data.message || 'Thank you for joining us. We look forward to providing you with excellent service.'}</p>
              ${data.actionUrl ? `<a href="${data.actionUrl}" class="button">Get Started</a>` : ''}
            </div>
            <div class="footer">
              <p>Welcome to our community!</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `Welcome, ${data.name || 'there'}!\n\nWe're excited to have you on board!\n\n${data.message || 'Thank you for joining us. We look forward to providing you with excellent service.'}`
    },

    notification: {
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Notification</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
            .header { background: linear-gradient(135deg, #17a2b8 0%, #6f42c1 100%); color: white; padding: 30px; text-align: center; }
            .content { padding: 40px 30px; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 14px; }
            .alert { background: #e3f2fd; border-left: 4px solid #2196f3; padding: 15px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📢 ${data.title || 'Notification'}</h1>
            </div>
            <div class="content">
              <div class="alert">
                <p><strong>${data.alert || 'Important Update'}</strong></p>
              </div>
              <p>${data.message || 'This is an important notification for you.'}</p>
              ${data.details ? `<p><strong>Details:</strong> ${data.details}</p>` : ''}
            </div>
            <div class="footer">
              <p>Thank you for your attention.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `${data.title || 'Notification'}\n\n${data.alert || 'Important Update'}\n\n${data.message || 'This is an important notification for you.'}\n\n${data.details ? `Details: ${data.details}` : ''}`
    }
  };

  return templates[templateName] || templates.default;
}

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

    const mxRecords = await dns.resolveMx(domain);
    const sorted = mxRecords.sort((a, b) => a.priority - b.priority);
    const main = sorted[0]?.exchange || `mail.${domain}`;

    return res.json({
      success: true,
      domain,
      suggested_smtp: `mail.${domain}`,
      suggested_imap: `mail.${domain}`,
      mx_records: sorted
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Could not resolve host', error: err.message });
  }
});

module.exports = router;
