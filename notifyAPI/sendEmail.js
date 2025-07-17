// // Secure Email API with SMTP Send and IMAP Retrieve - MongoDB Backed

// const express = require('express');
// const nodemailer = require('nodemailer');
// const { ImapFlow } = require('imapflow');
// const { simpleParser } = require('mailparser');
// const dns = require('node:dns').promises;
// const crypto = require('crypto');
// const mongoose = require('mongoose');
// const fetch = require('node-fetch');
// require('dotenv').config();

// const router = express.Router();

// // Improved AES Encryption/Decryption functions
// const algorithm = 'aes-256-cbc';
// const key = crypto.scryptSync(process.env.ENCRYPTION_SECRET || 'default-secret-key-change-this', 'salt', 32);
// const ivLength = 16;

// function encrypt(text) {
//   if (!text) return '';

//   try {
//     const iv = crypto.randomBytes(ivLength);
//     const cipher = crypto.createCipheriv(algorithm, key, iv);
//     const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
//     return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
//   } catch (error) {
//     console.error('Encryption error:', error);
//     throw new Error('Failed to encrypt password');
//   }
// }

// function decrypt(encryptedText) {
//   if (!encryptedText) return '';

//   try {
//     const [ivHex, encryptedHex] = encryptedText.split(':');
//     if (!ivHex || !encryptedHex) {
//       throw new Error('Invalid encrypted format');
//     }

//     const iv = Buffer.from(ivHex, 'hex');
//     const encrypted = Buffer.from(encryptedHex, 'hex');
//     const decipher = crypto.createDecipheriv(algorithm, key, iv);
//     const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
//     return decrypted.toString('utf8');
//   } catch (error) {
//     console.error('Decryption error:', error);
//     throw new Error('Failed to decrypt password');
//   }
// }

// // MongoDB Model
// const smtpAuthSchema = new mongoose.Schema({
//   email: { type: String, required: true, unique: true },
//   host: String,
//   port: Number,
//   pass: String, // This will store encrypted password
//   token: String,
//   createdAt: { type: Date, default: Date.now }
// }, { collection: 'email_smtp_auth' });

// const SMTPAuth = mongoose.model('SMTPAuth', smtpAuthSchema);

// // Email Tracking Schema
// const emailTrackingSchema = new mongoose.Schema({
//   messageId: { type: String, required: true, unique: true },
//   fromEmail: { type: String, required: true },
//   toEmail: { type: String, required: true },
//   subject: String,
//   sentAt: { type: Date, default: Date.now },
//   openedAt: Date,
//   openedCount: { type: Number, default: 0 },
//   lastOpenedIP: String,
//   repliedAt: Date,
//   webhookUrl: String,
//   clickEvents: [{
//     url: String,
//     clickedAt: Date,
//     ip: String,
//     userAgent: String
//   }]
// }, { 
//   collection: 'email_tracking_v2',
//   timestamps: true 
// });

// const EmailTracking = mongoose.model('EmailTracking', emailTrackingSchema);



// // Connect MongoDB
// mongoose.connect(process.env.ONEPGR_MONGO_URI, {
//   dbName: 'onepgr_apps',
//   useNewUrlParser: true,
//   useUnifiedTopology: true
// });

// // Helper function to get proper SMTP settings for common providers
// async function getSMTPSettings(email, customHost, customPort) {
//   const domain = email.split('@')[1].toLowerCase();

//   // If custom settings provided, use them
//   if (customHost && customPort) {
//     return { host: customHost, port: customPort };
//   }

//   // Default settings for common providers
//   const providerSettings = {
//     'gmail.com': { host: 'smtp.gmail.com', port: 587 },
//     'outlook.com': { host: 'smtp-mail.outlook.com', port: 587 },
//     'hotmail.com': { host: 'smtp-mail.outlook.com', port: 587 },
//     'yahoo.com': { host: 'smtp.mail.yahoo.com', port: 587 },
//     'icloud.com': { host: 'smtp.mail.me.com', port: 587 },
//     'protonmail.com': { host: '127.0.0.1', port: 1025 }, // ProtonMail uses bridge
//     'zoho.com': { host: 'smtp.zoho.com', port: 587 },
//     'yandex.com': { host: 'smtp.yandex.com', port: 587 }
//   };

//   // Check if it's a known provider first
//   if (providerSettings[domain]) {
//     return providerSettings[domain];
//   }

//   // For unknown domains, check MX records to detect Google Workspace
//   try {
//     const mxRecords = await dns.resolveMx(domain);
//     const sorted = mxRecords.sort((a, b) => a.priority - b.priority);

//     // Check if it's Google Workspace (uses Google's MX servers)
//     const isGoogleWorkspace = sorted.some(mx => 
//       mx.exchange.includes('google') || 
//       mx.exchange.includes('aspmx.l.google.com') ||
//       mx.exchange.includes('googlemail.com')
//     );

//     if (isGoogleWorkspace) {
//       return { host: 'smtp.gmail.com', port: 587 };
//     }

//     // Check if it's Microsoft 365/Outlook
//     const isOutlook = sorted.some(mx => 
//       mx.exchange.includes('outlook') || 
//       mx.exchange.includes('hotmail') ||
//       mx.exchange.includes('microsoft')
//     );

//     if (isOutlook) {
//       return { host: 'smtp-mail.outlook.com', port: 587 };
//     }

//   } catch (error) {
//     console.log(`Could not resolve MX records for ${domain}:`, error.message);
//   }

//   // Default fallback
//   return { host: `smtp.${domain}`, port: 587 };
// }

// // Professional Email Template Generator
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
//                 <p><strong>Best regards,</strong><br>
//                 ${data.senderName || 'Your Team'}</p>
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
//     },


//     plaintext: {
//       html: `
//         <p>Hello!</p>
//         <p>${data.content || 'This is a simple message.'}</p>
//         <br/>
//         <p>Best regards,<br/>${data.senderName || 'Team EngageGPT'}</p>
//       `,
//       text: `Hello!\n\n${data.content || 'This is a simple message.'}\n\nBest regards,\n${data.senderName || 'Team EngageGPT'}`
//     },


//     welcome: {
//       html: `
//         <!DOCTYPE html>
//         <html>
//         <head>
//           <meta charset="utf-8">
//           <meta name="viewport" content="width=device-width, initial-scale=1.0">
//           <title>Welcome!</title>
//           <style>
//             body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
//             .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
//             .header { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; text-align: center; }
//             .content { padding: 40px 30px; }
//             .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 14px; }
//             .button { display: inline-block; padding: 12px 24px; background: #28a745; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
//           </style>
//         </head>
//         <body>
//           <div class="container">
//             <div class="header">
//               <h1>Welcome, ${data.name || 'there'}! 🎉</h1>
//             </div>
//             <div class="content">
//               <p>We're excited to have you on board!</p>
//               <p>${data.message || 'Thank you for joining us. We look forward to providing you with excellent service.'}</p>
//               ${data.actionUrl ? `<a href="${data.actionUrl}" class="button">Get Started</a>` : ''}
//             </div>
//             <div class="footer">
//               <p>Welcome to our community!</p>
//             </div>
//           </div>
//         </body>
//         </html>
//       `,
//       text: `Welcome, ${data.name || 'there'}!\n\nWe're excited to have you on board!\n\n${data.message || 'Thank you for joining us. We look forward to providing you with excellent service.'}`
//     },

//     notification: {
//       html: `
//         <!DOCTYPE html>
//         <html>
//         <head>
//           <meta charset="utf-8">
//           <meta name="viewport" content="width=device-width, initial-scale=1.0">
//           <title>Notification</title>
//           <style>
//             body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
//             .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
//             .header { background: linear-gradient(135deg, #17a2b8 0%, #6f42c1 100%); color: white; padding: 30px; text-align: center; }
//             .content { padding: 40px 30px; }
//             .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 14px; }
//             .alert { background: #e3f2fd; border-left: 4px solid #2196f3; padding: 15px; margin: 20px 0; }
//           </style>
//         </head>
//         <body>
//           <div class="container">
//             <div class="header">
//               <h1>📢 ${data.title || 'Notification'}</h1>
//             </div>
//             <div class="content">
//               <div class="alert">
//                 <p><strong>${data.alert || 'Important Update'}</strong></p>
//               </div>
//               <p>${data.message || 'This is an important notification for you.'}</p>
//               ${data.details ? `<p><strong>Details:</strong> ${data.details}</p>` : ''}
//             </div>
//             <div class="footer">
//               <p>Thank you for your attention.</p>
//             </div>
//           </div>
//         </body>
//         </html>
//       `,
//       text: `${data.title || 'Notification'}\n\n${data.alert || 'Important Update'}\n\n${data.message || 'This is an important notification for you.'}\n\n${data.details ? `Details: ${data.details}` : ''}`
//     }
//   };

//   return templates[templateName] || templates.default;
// }

// // Utility function to log events (for frontend polling)
// async function logEmailEvent(eventType, trackingData) {
//   try {
//     console.log(`📧 Email Event: ${eventType}`, {
//       trackingId: trackingData.trackingId,
//       email: trackingData.email,
//       from: trackingData.from,
//       subject: trackingData.subject,
//       timestamp: new Date()
//     });
//   } catch (error) {
//     console.error('Event logging error:', error);
//   }
// }

// // 1️⃣ Setup Sender and generate API token
// router.post('/api/senderemail/smtpauth', async (req, res) => {
//   try {
//     const { host, port, email, pass } = req.body;
//     if (!email || !pass) {
//       return res.status(400).json({ success: false, error: 'Missing required fields: email, pass' });
//     }

//     // Get proper SMTP settings
//     const smtpSettings = await getSMTPSettings(email, host, port);
//     console.log(`Using SMTP settings for ${email}:`, smtpSettings);

//     // Check if email already exists
//     const existingRecord = await SMTPAuth.findOne({ email });

//     if (existingRecord) {
//       console.log(`Email ${email} already exists with token: ${existingRecord.token}`);
//       return res.status(409).json({
//         success: false,
//         error: 'Email already configured',
//         message: `Email ${email} is already created with token: ${existingRecord.token}`,
//         existingToken: existingRecord.token,
//         createdAt: existingRecord.createdAt
//       });
//     }

//     // Generate new token for new record
//     const token = crypto.randomBytes(6).toString('hex');
//     console.log(`Creating new SMTP auth for email: ${email}`);

//     // Encrypt the password before saving
//     const encryptedPass = encrypt(pass);
//     console.log('Password encrypted successfully');

//     // Create new record
//     const result = await SMTPAuth.create({
//       email,
//       host: smtpSettings.host,
//       port: smtpSettings.port,
//       pass: encryptedPass,
//       token
//     });

//     console.log(`SMTP auth created successfully for email: ${email}`);

//     return res.json({
//       success: true,
//       token,
//       smtpSettings,
//       message: `New SMTP auth created for ${email}. Use token: ${token} to send and retrieve emails`
//     });
//   } catch (error) {
//     console.error('SMTP Auth Error:', error);

//     // Handle duplicate key error specifically
//     if (error.code === 11000) {
//       return res.status(409).json({ 
//         success: false, 
//         error: 'Email already exists',
//         message: 'This email is already configured. Please use a different email or contact support.'
//       });
//     }

//     return res.status(500).json({ success: false, error: error.message });
//   }
// });

// // 2️⃣ Send Email
// router.post('/api/emailsend', async (req, res) => {
//   try {
//     const { token, from, to, cc, bcc, subject, html, text, template, templateData, trackLinks, webhookUrl } = req.body;
//     if (!token || !from) {
//       return res.status(400).json({ success: false, error: 'Missing API token or from email' });
//     }

//     const smtp = await SMTPAuth.findOne({ email: from, token });
//     if (!smtp) {
//       return res.status(403).json({ success: false, error: 'Invalid token or sender email' });
//     }

//     // Decrypt the password
//     let decryptedPass;
//     try {
//       decryptedPass = decrypt(smtp.pass);
//       console.log('Password decrypted successfully');
//     } catch (decryptError) {
//       console.error('Password decryption failed:', decryptError);
//       return res.status(500).json({ success: false, error: 'Failed to decrypt stored credentials' });
//     }

//     // Create transporter with proper settings
//     const transporter = nodemailer.createTransport({
//       host: smtp.host,
//       port: smtp.port,
//       secure: smtp.port === 465, // true for 465, false for other ports
//       auth: { 
//         user: from, 
//         pass: decryptedPass 
//       },
//       tls: {
//         rejectUnauthorized: false // Allow self-signed certificates
//       }
//     });

//     // Verify connection configuration
//     try {
//       await transporter.verify();
//       console.log('SMTP connection verified successfully');
//     } catch (verifyError) {
//       console.error('SMTP verification failed:', verifyError);
//       return res.status(500).json({ 
//         success: false, 
//         error: 'SMTP connection failed', 
//         details: verifyError.message 
//       });
//     }

//     // Generate a unique tracking ID using crypto
//     const trackingId = crypto.randomBytes(16).toString('hex');

//     const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
//     const trackingPixelUrl = `${baseUrl}/api/track/open/${trackingId}`;

//     // Generate professional email content
//     let emailHtml = html;
//     let emailText = text;

//     if (template) {
//       const templateContent = generateEmailTemplate(template, templateData || {});
//       emailHtml = templateContent.html;
//       emailText = templateContent.text;
//       console.log('📧 Using template:', template);
//     } else if (!html && !text) {
//       // Default professional template if no content provided
//       const defaultTemplate = generateEmailTemplate('default', { subject, content: 'This is a professional email.' });
//       emailHtml = defaultTemplate.html;
//       emailText = defaultTemplate.text;
//       console.log('📧 Using default template');
//     }

//     console.log('📧 Email HTML length:', emailHtml ? emailHtml.length : 0);
//     console.log('📧 Email Text length:', emailText ? emailText.length : 0);

//     // Add tracking pixel to HTML emails
//     if (emailHtml) {
//       emailHtml += `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt=""/>`;
//       console.log('📧 Tracking pixel added to email:', trackingPixelUrl);
//     } else {
//       console.log('⚠️ No HTML content, tracking pixel not added');
//     }

//     // Modify links for click tracking if requested
//     if (emailHtml && trackLinks) {
//       emailHtml = emailHtml.replace(/href="(.*?)"/g, (match, url) => {
//         if (url.startsWith('http') && !url.includes(baseUrl)) {
//           const encodedUrl = encodeURIComponent(url);
//           return `href="${baseUrl}/api/track/click/${trackingId}?url=${encodedUrl}"`;
//         }
//         return match;
//       });
//     }

//     // Prepare email options with CC and BCC support
//     const emailOptions = {
//       from: from,
//       to,
//       subject,
//       html: emailHtml,
//       text: emailText,
//       headers: {
//         'X-Tracking-ID': trackingId,
//         'References': trackingId  // For reliable reply detection
//       }
//     };

//     // Add CC if provided
//     if (cc) {
//       emailOptions.cc = cc;
//     }

//     // Add BCC if provided
//     if (bcc) {
//       emailOptions.bcc = bcc;
//     }

//     const info = await transporter.sendMail(emailOptions);

//     console.log('Email sent successfully:', info.messageId);

//     // Save tracking information
//     console.log('Creating tracking record for:', trackingId);
//     const trackingRecord = new EmailTracking({
//       messageId: trackingId,
//       fromEmail: from,
//       toEmail: to,
//       subject,
//       webhookUrl: webhookUrl // Optional per-email webhook override
//     });

//     await trackingRecord.save();
//     console.log('Tracking record created successfully for message:', trackingId);

//     return res.json({ 
//       success: true, 
//       messageId: info.messageId,
//       trackingId,
//       smtpHost: smtp.host,
//       smtpPort: smtp.port,
//       recipients: {
//         to: to,
//         cc: cc || null,
//         bcc: bcc || null
//       }
//     });
//   } catch (err) {
//     console.error('Email Send Error:', err);
//     return res.status(500).json({ success: false, error: err.message });
//   }
// });

// // 3️⃣ Inbox Fetch with Read/Unread
// router.post('/api/fetchinbox', async (req, res) => {
//   try {
//     const { token, email, limit = 10 } = req.body;
//     if (!token || !email) {
//       return res.status(400).json({ success: false, error: 'Missing token or email' });
//     }

//     const smtp = await SMTPAuth.findOne({ email, token });
//     if (!smtp) {
//       return res.status(403).json({ success: false, error: 'Invalid token or sender email' });
//     }

//     // Decrypt the password
//     let decryptedPass;
//     try {
//       decryptedPass = decrypt(smtp.pass);
//     } catch (decryptError) {
//       console.error('Password decryption failed:', decryptError);
//       return res.status(500).json({ success: false, error: 'Failed to decrypt stored credentials' });
//     }

//     const client = new ImapFlow({
//       host: smtp.host,
//       port: 993,
//       secure: true,
//       auth: { user: email, pass: decryptedPass },
//       logger: false
//     });

//     await client.connect();
//     const lock = await client.mailboxOpen('INBOX');
//     const total = lock.exists;
//     const maxLimit = Math.max(Math.min(limit, 50), 1);
//     const start = Math.max(total - (maxLimit - 1), 1);

//     const messages = [];
//     for await (let msg of client.fetch(`${start}:${total}`, { envelope: true, uid: true, flags: true, source: true })) {
//       const parsed = await simpleParser(msg.source);
//       messages.push({
//         subject: msg.envelope.subject,
//         from: msg.envelope.from.map(f => `${f.name} <${f.address}>`).join(', '),
//         date: msg.envelope.date,
//         uid: msg.uid,
//         read: Array.isArray(msg.flags) ? msg.flags.includes('Seen') : false,
//         text: parsed.text || '',
//         html: parsed.html || ''
//       });
//     }
//     await client.logout();

//     return res.json({ success: true, inbox: messages.reverse() });
//   } catch (err) {
//     console.error('Inbox Fetch Error:', err);
//     return res.status(500).json({ success: false, error: err.message });
//   }
// });

// // 4️⃣ Host discovery from email
// router.get('/api/get-host', async (req, res) => {
//   try {
//     const { email } = req.query;
//     if (!email.includes('@')) return res.status(400).json({ success: false, message: 'Invalid email' });
//     const domain = email.split('@')[1];

//     // Get proper SMTP settings using the same logic as the setup endpoint
//     const smtpSettings = await getSMTPSettings(email);

//     // Get MX records for additional info
//     const mxRecords = await dns.resolveMx(domain);
//     const sorted = mxRecords.sort((a, b) => a.priority - b.priority);

//     return res.json({
//       success: true,
//       domain,
//       suggested_smtp: smtpSettings.host,
//       suggested_imap: smtpSettings.host.replace('smtp.', 'imap.'), // Convert SMTP to IMAP
//       smtp_port: smtpSettings.port,
//       imap_port: 993, // Standard IMAP port
//       mx_records: sorted,
//       provider_info: {
//         is_gmail: domain === 'gmail.com' || sorted.some(mx => mx.exchange.includes('google')),
//         is_google_workspace: sorted.some(mx => mx.exchange.includes('google')),
//         is_outlook: domain.includes('outlook') || domain.includes('hotmail'),
//         is_yahoo: domain.includes('yahoo')
//       }
//     });
//   } catch (err) {
//     return res.status(500).json({ success: false, message: 'Could not resolve host', error: err.message });
//   }
// });

// // 5️⃣ Email Tracking Endpoints

// // Track email opens
// router.get('/api/track/open/:trackingId', async (req, res) => {
//   try {
//     const trackingId = req.params.trackingId;
//     const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
//     const userAgent = req.headers['user-agent'];

//     console.log('🔍 Tracking pixel accessed:', trackingId);
//     console.log('🔍 IP:', ip);
//     console.log('🔍 User Agent:', userAgent);

//     const tracking = await EmailTracking.findOneAndUpdate(
//       { messageId: trackingId },
//       { 
//         $inc: { openedCount: 1 },
//         $set: { 
//           openedAt: new Date(),
//           lastOpenedIP: ip 
//         }
//       },
//       { new: true }
//     );

//     if (tracking) {
//       // Log email event
//       await logEmailEvent('opened', {
//         trackingId,
//         email: tracking.toEmail,
//         from: tracking.fromEmail,
//         subject: tracking.subject,
//         ip,
//         userAgent,
//         timestamp: new Date()
//       });
//     }

//     // Return a transparent pixel
//     res.set('Content-Type', 'image/png');
//     res.send(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
//   } catch (error) {
//     console.error('Open tracking error:', error);
//     res.status(500).send('Tracking error');
//   }
// });

// // Track link clicks
// router.get('/api/track/click/:trackingId', async (req, res) => {
//   try {
//     const trackingId = req.params.trackingId;
//     const url = decodeURIComponent(req.query.url);
//     const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
//     const userAgent = req.headers['user-agent'];

//     const tracking = await EmailTracking.findOneAndUpdate(
//       { messageId: trackingId },
//       { 
//         $push: { 
//           clickEvents: {
//             url,
//             clickedAt: new Date(),
//             ip,
//             userAgent
//           }
//         }
//       }
//     );

//     if (tracking) {
//       // Log email event
//       await logEmailEvent('clicked', {
//         trackingId,
//         email: tracking.toEmail,
//         from: tracking.fromEmail,
//         subject: tracking.subject,
//         url,
//         ip,
//         userAgent,
//         timestamp: new Date()
//       });
//     }

//     res.redirect(url);
//   } catch (error) {
//     console.error('Click tracking error:', error);
//     res.status(500).send('Tracking error');
//   }
// });

// // Get tracking status
// router.get('/api/track/:trackingId', async (req, res) => {
//   try {
//     const tracking = await EmailTracking.findOne({ 
//       messageId: req.params.trackingId 
//     });

//     if (!tracking) {
//       return res.status(404).json({ success: false, error: 'Tracking not found' });
//     }

//     res.json({
//       success: true,
//       tracking: {
//         sentAt: tracking.sentAt,
//         opened: !!tracking.openedAt,
//         openedCount: tracking.openedCount,
//         lastOpenedAt: tracking.openedAt,
//         replied: !!tracking.repliedAt,
//         repliedAt: tracking.repliedAt,
//         clicks: tracking.clickEvents || []
//       }
//     });
//   } catch (error) {
//     console.error('Tracking status error:', error);
//     res.status(500).json({ success: false, error: error.message });
//   }
// });

// // 6️⃣ Webhook Endpoint for Frontend Notifications

// // Check if tracking record exists (for debugging)
// router.get('/api/track-exists/:trackingId', async (req, res) => {
//   try {
//     const tracking = await EmailTracking.findOne({ messageId: req.params.trackingId });
//     res.json({
//       success: true,
//       exists: !!tracking,
//       tracking: tracking ? {
//         messageId: tracking.messageId,
//         fromEmail: tracking.fromEmail,
//         toEmail: tracking.toEmail,
//         subject: tracking.subject,
//         sentAt: tracking.sentAt
//       } : null
//     });
//   } catch (error) {
//     console.error('Track exists check error:', error);
//     res.status(500).json({ success: false, error: error.message });
//   }
// });

// // Get real-time email notifications
// router.get('/api/webhook', async (req, res) => {
//   try {
//     const { trackingId, lastCheck } = req.query;

//     if (!trackingId) {
//       return res.status(400).json({ 
//         success: false, 
//         error: 'trackingId is required' 
//       });
//     }

//     // Find the tracking record
//     const tracking = await EmailTracking.findOne({ messageId: trackingId });

//     if (!tracking) {
//       return res.status(404).json({ 
//         success: false, 
//         error: 'Tracking not found' 
//       });
//     }

//     // Check for new events since last check
//     const lastCheckTime = lastCheck ? new Date(lastCheck) : new Date(0);
//     const newEvents = [];

//     // Check for opens
//     if (tracking.openedAt && tracking.openedAt > lastCheckTime) {
//       newEvents.push({
//         event: 'opened',
//         timestamp: tracking.openedAt,
//         data: {
//           trackingId: tracking.messageId,
//           email: tracking.toEmail,
//           from: tracking.fromEmail,
//           subject: tracking.subject,
//           openedCount: tracking.openedCount,
//           ip: tracking.lastOpenedIP
//         }
//       });
//     }

//     // Check for replies
//     if (tracking.repliedAt && tracking.repliedAt > lastCheckTime) {
//       newEvents.push({
//         event: 'replied',
//         timestamp: tracking.repliedAt,
//         data: {
//           trackingId: tracking.messageId,
//           email: tracking.toEmail,
//           from: tracking.fromEmail,
//           subject: tracking.subject
//         }
//       });
//     }

//     // Check for new clicks
//     const newClicks = tracking.clickEvents.filter(click => 
//       click.clickedAt > lastCheckTime
//     );

//     newClicks.forEach(click => {
//       newEvents.push({
//         event: 'clicked',
//         timestamp: click.clickedAt,
//         data: {
//           trackingId: tracking.messageId,
//           email: tracking.toEmail,
//           from: tracking.fromEmail,
//           subject: tracking.subject,
//           url: click.url,
//           ip: click.ip,
//           userAgent: click.userAgent
//         }
//       });
//     });

//     // Sort events by timestamp
//     newEvents.sort((a, b) => a.timestamp - b.timestamp);

//     res.json({
//       success: true,
//       trackingId,
//       newEvents,
//       currentStatus: {
//         opened: !!tracking.openedAt,
//         openedCount: tracking.openedCount,
//         lastOpenedAt: tracking.openedAt,
//         replied: !!tracking.repliedAt,
//         repliedAt: tracking.repliedAt,
//         totalClicks: tracking.clickEvents.length
//       }
//     });

//   } catch (error) {
//     console.error('Webhook error:', error);
//     res.status(500).json({ success: false, error: error.message });
//   }
// });

// // 7️⃣ Reply Detection Function
// async function checkForReplies() {
//   try {
//     // Get all active tracking records where we haven't detected a reply yet
//     const trackings = await EmailTracking.find({ 
//       repliedAt: { $exists: false },
//       fromEmail: { $exists: true }
//     });

//     for (const tracking of trackings) {
//       const smtp = await SMTPAuth.findOne({ email: tracking.fromEmail });
//       if (!smtp) continue;

//       // Decrypt password
//       const decryptedPass = decrypt(smtp.pass);

//       const client = new ImapFlow({
//         host: smtp.host.replace('smtp.', 'imap.'), // Convert to IMAP host
//         port: 993,
//         secure: true,
//         auth: { user: tracking.fromEmail, pass: decryptedPass },
//         logger: false
//       });

//       try {
//         await client.connect();
//         await client.mailboxOpen('INBOX');

//         // Search for replies to this message using References header
//         const messages = await client.search({
//           answered: true,
//           OR: [
//             { headers: { 'In-Reply-To': tracking.messageId } },
//             { headers: { 'References': tracking.messageId } }
//           ]
//         });

//         if (messages.length > 0) {
//           // Update tracking record
//           tracking.repliedAt = new Date();
//           await tracking.save();

//           // Log email event
//           await logEmailEvent('replied', {
//             trackingId: tracking.messageId,
//             email: tracking.toEmail,
//             from: tracking.fromEmail,
//             subject: tracking.subject,
//             timestamp: new Date()
//           });
//         }
//       } finally {
//         await client.logout();
//       }
//     }
//   } catch (error) {
//     console.error('Reply checking error:', error);
//   }
// }

// // Set up periodic reply checking (every 5 minutes)
// setInterval(checkForReplies, 5 * 60 * 1000);

// module.exports = router;








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

// SMTP Settings Helper
async function getSMTPSettings(email, customHost, customPort) {
  const domain = email.split('@')[1].toLowerCase();
  if (customHost && customPort) return { host: customHost, port: customPort };

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

  try {
    const mxRecords = await dns.resolveMx(domain);
    const sorted = mxRecords.sort((a, b) => a.priority - b.priority);
    const isGoogleWorkspace = sorted.some(mx =>
      mx.exchange.includes('google') || mx.exchange.includes('aspmx.l.google.com') ||
      mx.exchange.includes('googlemail.com')
    );
    if (isGoogleWorkspace) return { host: 'smtp.gmail.com', port: 587 };

    const isOutlook = sorted.some(mx =>
      mx.exchange.includes('outlook') || mx.exchange.includes('hotmail') ||
      mx.exchange.includes('microsoft')
    );
    if (isOutlook) return { host: 'smtp-mail.outlook.com', port: 587 };

    return { host: `smtp.${domain}`, port: 587 };
  } catch (error) {
    console.log(`Could not resolve MX records for ${domain}:`, error.message);
    return { host: `smtp.${domain}`, port: 587 };
  }
}

// Email Template Generator
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
                <p><strong>Best regards,</strong><br>${data.senderName || 'Your Team'}</p>
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
    }
  };
  return templates[templateName] || templates.default;
}

// Webhook Notification Helper
async function sendWebhookNotification(webhookUrl, eventData) {
  if (!webhookUrl) return;
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventData)
    });
    console.log(`Webhook notification sent to ${webhookUrl}, status: ${response.status}`);
  } catch (error) {
    console.error('Webhook notification error:', error);
  }
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
      return res.status(409).json({
        success: false,
        error: 'Email already configured',
        message: `Email ${email} is already created with token: ${existingRecord.token}`,
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

    return res.json({
      success: true,
      token,
      smtpSettings,
      message: `New SMTP auth created for ${email}. Use token: ${token} to send and retrieve emails`
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
    const { token, from, to, cc, bcc, subject, html, text, template, templateData, trackLinks } = req.body;
    if (!token || !from || !to) {
      return res.status(400).json({ success: false, error: 'Missing required fields: token, from, to' });
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

    let emailHtml = html;
    let emailText = text;

    if (template) {
      const templateContent = generateEmailTemplate(template, templateData || {});
      emailHtml = templateContent.html;
      emailText = templateContent.text;
    } else if (!html && !text) {
      const defaultTemplate = generateEmailTemplate('default', { subject, content: 'This is a professional email.' });
      emailHtml = defaultTemplate.html;
      emailText = defaultTemplate.text;
    }

    // Add tracking pixel
    if (emailHtml) {
      emailHtml += `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none;border:0;" alt=""/>\n`;
    }

    // Track links
    if (emailHtml && trackLinks) {
      emailHtml = emailHtml.replace(/href=["'](.*?)["']/g, (match, url) => {
        if (url.startsWith('http') && !url.includes(baseUrl)) {
          const encodedUrl = encodeURIComponent(url);
          return `href="${baseUrl}/api/track/click/${trackingId}?url=${encodedUrl}"`;
        }
        return match;
      });
    }

    const emailOptions = {
      from,
      to,
      subject: subject || 'No Subject',
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

    // Set webhook URL only if trackLinks is true
    const webhookUrl = trackLinks ? 'https://videoresponse.onepgr.com:3001/emailtrachwebhook' : null;

    const trackingRecord = new EmailTracking({
      messageId: trackingId,
      originalMessageId: info.messageId,
      fromEmail: from,
      toEmail: to,
      subject,
      webhookUrl
    });

    await trackingRecord.save();

    // Send immediate notification only if webhook is enabled
    if (webhookUrl) {
      await sendWebhookNotification(webhookUrl, {
        event: 'sent',
        trackingId,
        email: to,
        from,
        subject,
        timestamp: new Date()
      });
    }

    return res.json({
      success: true,
      messageId: info.messageId,
      trackingId,
      recipients: { to, cc: cc || null, bcc: bcc || null }
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
    const mxRecords = await dns.resolveMx(domain);
    const sorted = mxRecords.sort((a, b) => a.priority - b.priority);

    return res.json({
      success: true,
      domain,
      suggested_smtp: smtpSettings.host,
      suggested_imap: smtpSettings.host.replace('smtp.', 'imap.'), // Convert SMTP to IMAP
      smtp_port: smtpSettings.port,
      imap_port: 993, // Standard IMAP port
      mx_records: sorted,
      provider_info: {
        is_gmail: domain === 'gmail.com' || sorted.some(mx => mx.exchange.includes('google')),
        is_google_workspace: sorted.some(mx => mx.exchange.includes('google')),
        is_outlook: domain.includes('outlook') || domain.includes('hotmail'),
        is_yahoo: domain.includes('yahoo')
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Could not resolve host', error: err.message });
  }
});


//_________________________Tracking API's_________________________

// 3️⃣ Track Email Opens
router.get('/api/track/open/:trackingId', async (req, res) => {
  try {
    const trackingId = req.params.trackingId;
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const tracking = await EmailTracking.findOneAndUpdate(
      { messageId: trackingId },
      {
        $inc: { openedCount: 1 },
        $set: {
          openedAt: new Date(),
          lastOpenedIP: ip
        }
      },
      { new: true }
    );

    if (tracking && tracking.webhookUrl) {
      await sendWebhookNotification(tracking.webhookUrl, {
        event: 'opened',
        trackingId,
        email: tracking.toEmail,
        from: tracking.fromEmail,
        subject: tracking.subject,
        ip,
        userAgent,
        openedCount: tracking.openedCount,
        timestamp: new Date()
      });
    }

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
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

    if (tracking && tracking.webhookUrl) {
      await sendWebhookNotification(tracking.webhookUrl, {
        event: 'clicked',
        trackingId,
        email: tracking.toEmail,
        from: tracking.fromEmail,
        subject: tracking.subject,
        url,
        ip,
        userAgent,
        timestamp: new Date()
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

      const decryptedPass = decrypt(smtp.pass);
      const client = new ImapFlow({
        host: smtp.host.replace('smtp.', 'imap.'),
        port: 993,
        secure: true,
        auth: { user: tracking.fromEmail, pass: decryptedPass },
        logger: false
      });

      try {
        await client.connect();
        await client.mailboxOpen('INBOX');

        const messages = await client.search({
          from: tracking.toEmail,
          header: {
            'References': tracking.messageId,
            'In-Reply-To': tracking.messageId
          }
        });

        if (messages.length > 0) {
          const replyTime = new Date();
          await EmailTracking.findOneAndUpdate(
            { messageId: tracking.messageId },
            { $set: { repliedAt: replyTime } }
          );

          if (tracking.webhookUrl) {
            await sendWebhookNotification(tracking.webhookUrl, {
              event: 'replied',
              trackingId: tracking.messageId,
              email: tracking.toEmail,
              from: tracking.fromEmail,
              subject: tracking.subject,
              timestamp: replyTime
            });
          }
        }
      } finally {
        await client.logout();
      }
    }
  } catch (error) {
    console.error('Reply checking error:', error);
  }
}

// 6️⃣ Get Tracking Status
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

        // Click Events
        clicks: tracking.clickEvents ? tracking.clickEvents.map(click => ({
          ...click,
          clickedAt: formatDate(click.clickedAt),
          ip: cleanIP(click.ip)
        })) : [],
        totalClicks: tracking.clickEvents ? tracking.clickEvents.length : 0,

        // Webhook (only if trackLinks was enabled)
        webhookUrl: tracking.webhookUrl || null,

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

// 7️⃣ Webhook Endpoint for POST Notifications
router.post('/emailtrachwebhook', async (req, res) => {
  try {
    const { event, trackingId, email, from, subject, timestamp, ip, userAgent, openedCount, url } = req.body;

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
      url
    });

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

// Start periodic reply checking
setInterval(checkForReplies, 2 * 60 * 1000); // Check every 2 minutes





module.exports = router;
