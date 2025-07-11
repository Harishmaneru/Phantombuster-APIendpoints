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

// MongoDB Model
const smtpAuthSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  host: String,
  port: Number,
  pass: String,
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
  const { host, port, email, pass } = req.body;
  if (!host || !port || !email || !pass) return res.status(400).json({ success: false, error: 'Missing fields' });

  const token = crypto.randomBytes(6).toString('hex');

  await SMTPAuth.findOneAndUpdate(
    { email },
    { host, port, pass, token },
    { upsert: true, new: true }
  );

  return res.json({ success: true, token });
});

// 2️⃣ Send Email
router.post('/api/emailsend', async (req, res) => {
  const { token, email, to, subject, html, text } = req.body;
  if (!token || !email) return res.status(400).json({ success: false, error: 'Missing API token or email' });

  const smtp = await SMTPAuth.findOne({ email, token });
  if (!smtp) return res.status(403).json({ success: false, error: 'Invalid token or sender' });

  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: true,
      auth: { user: email, pass: smtp.pass }
    });

    const info = await transporter.sendMail({ from: email, to, subject, html, text });
    return res.json({ success: true, messageId: info.messageId });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3️⃣ Inbox Fetch with Read/Unread
router.post('/api/fetchinbox', async (req, res) => {
  const { token, email, limit = 10 } = req.body;
  if (!token || !email) return res.status(400).json({ success: false, error: 'Missing token or email' });

  const smtp = await SMTPAuth.findOne({ email, token });
  if (!smtp) return res.status(403).json({ success: false, error: 'Invalid token or sender' });

  try {
    const client = new ImapFlow({
      host: smtp.host,
      port: 993,
      secure: true,
      auth: { user: email, pass: smtp.pass },
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
        read: msg.flags.includes('Seen'),
        text: parsed.text || '',
        html: parsed.html || ''
      });
    }
    await client.logout();

    return res.json({ success: true, inbox: messages.reverse() });
  } catch (err) {
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
