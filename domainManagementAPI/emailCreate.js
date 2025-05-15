
// require('dotenv').config();
// const { google } = require('googleapis');
// const fs = require('fs');
// const path = require('path');
// const express = require('express');
// const router = express.Router();

// // Configuration
// const KEYFILE_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
// const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
// const DOMAIN = process.env.DOMAIN || (ADMIN_EMAIL && ADMIN_EMAIL.split('@')[1]);

// // Validate environment variables
// if (!KEYFILE_PATH || !ADMIN_EMAIL || !DOMAIN) {
//   console.error('❌ Missing required environment variables: GOOGLE_APPLICATION_CREDENTIALS, ADMIN_EMAIL, DOMAIN');
//   throw new Error('Server initialization failed');
// }

// // Initialize Google Workspace Client
// let authClient;
// let directoryService;

// async function initializeClient() {
//   try {
//     // Resolve and validate credentials path
//     const resolvedKeyPath = path.resolve(KEYFILE_PATH);
//     if (!fs.existsSync(resolvedKeyPath)) {
//       throw new Error(`Credentials file not found at ${resolvedKeyPath}`);
//     }

//     // Load service account credentials
//     const credentials = require(resolvedKeyPath);

//     // Validate credentials
//     const requiredFields = ['client_email', 'private_key'];
//     const missingFields = requiredFields.filter(field => !credentials[field]);
//     if (missingFields.length > 0) {
//       throw new Error(`Missing required fields in credentials: ${missingFields.join(', ')}`);
//     }

//     // Initialize auth client with domain-wide delegation
//     authClient = new google.auth.JWT({
//       email: credentials.client_email,
//       key: credentials.private_key.replace(/\\n/g, '\n'),
//       scopes: [
//         'https://www.googleapis.com/auth/admin.directory.user',
//         'https://www.googleapis.com/auth/admin.directory.user.security'
//       ],
//       subject: ADMIN_EMAIL
//     });

//     // Initialize Directory Service
//     directoryService = google.admin({ version: 'directory_v1', auth: authClient });

//     // Test authentication and API access
//     await authClient.authorize();
//     await directoryService.users.list({ domain: DOMAIN, maxResults: 1 });
//     console.log('[emailCreateAPI] ✅ Google Workspace Email API client initialized successfully');
//   } catch (err) {
//     console.error('[emailCreateAPI] ❌ Failed to initialize Google Workspace client:', {
//       message: err.message,
//       code: err.code,
//       details: err.response?.data?.error,
//       stack: err.stack
//     });
//     throw err;
//   }
// }

// // Initialize client
// initializeClient().catch(() => process.exit(1));

// // Input validation utility
// function validateEmail(email) {
//   const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
//   return re.test(email);
// }

// function sanitizeInput(input) {
//   return typeof input === 'string' ? input.replace(/[<>"'&]/g, '') : input;
// }

// /**
//  * @api {post} /google/email/create Create Email Account
//  * @apiName CreateEmailAccount
//  * @apiGroup GoogleEmail
//  * 
//  * @apiParam {String} firstName User's first name
//  * @apiParam {String} lastName User's last name
//  * @apiParam {String} email User's email address
//  * @apiParam {String} password Initial password (min 8 characters)
//  * 
//  * @apiSuccess {Boolean} success Operation status
//  * @apiSuccess {Object} data Created user data
//  */
// router.post('/google/email/create', async (req, res) => {
//   try {
//     let { firstName, lastName, email, password } = req.body;

//     // Sanitize inputs
//     firstName = sanitizeInput(firstName);
//     lastName = sanitizeInput(lastName);
//     email = sanitizeInput(email);

//     // Validate input
//     if (!firstName || !lastName || !email || !password) {
//       return res.status(400).json({
//         success: false,
//         error: 'Missing required fields',
//         required: ['firstName', 'lastName', 'email', 'password']
//       });
//     }

//     if (!validateEmail(email)) {
//       return res.status(400).json({
//         success: false,
//         error: 'Invalid email format'
//       });
//     }

//     if (password.length < 8) {
//       return res.status(400).json({
//         success: false,
//         error: 'Password must be at least 8 characters'
//       });
//     }

//     // Validate email domain
//     const userDomain = email.split('@')[1];
//     if (userDomain !== DOMAIN) {
//       return res.status(400).json({
//         success: false,
//         error: `Email must belong to ${DOMAIN} domain`
//       });
//     }

//     // Create user
//     const response = await directoryService.users.insert({
//       requestBody: {
//         name: {
//           givenName: firstName,
//           familyName: lastName
//         },
//         primaryEmail: email,
//         password,
//         changePasswordAtNextLogin: true,
//         agreedToTerms: true,
//         suspended: false,
//         includeInGlobalAddressList: true
//       }
//     });

//     res.json({
//       success: true,
//       data: {
//         id: response.data.id,
//         email: response.data.primaryEmail,
//         name: response.data.name,
//         status: 'created'
//       }
//     });
//   } catch (err) {
//     console.error('[emailCreateAPI] ❌ Email creation error:', {
//       message: err.message,
//       code: err.code,
//       details: err.response?.data?.error
//     });

//     let statusCode = 500;
//     if (err.code === 409) statusCode = 409; // Duplicate account
//     else if (err.code === 403) statusCode = 403; // Permission denied
//     else if (err.code === 400) statusCode = 400; // Invalid input

//     res.status(statusCode).json({
//       success: false,
//       error: err.message,
//       details: err.response?.data?.error || null
//     });
//   }
// });

// /**
//  * @api {get} /google/email/check/:email Check Email Existence
//  * @apiName CheckEmailExists
//  * @apiGroup GoogleEmail
//  * 
//  * @apiParam {String} email Email address to check
//  * 
//  * @apiSuccess {Boolean} success Operation status
//  * @apiSuccess {Boolean} exists Whether email exists
//  * @apiSuccess {Object} data User data if exists
//  */
// router.get('/google/email/check/:email', async (req, res) => {
//   try {
//     const email = sanitizeInput(req.params.email);

//     if (!email || !validateEmail(email)) {
//       return res.status(400).json({
//         success: false,
//         error: 'Valid email parameter is required'
//       });
//     }

//     const response = await directoryService.users.get({
//       userKey: email
//     });

//     res.json({
//       success: true,
//       exists: true,
//       data: {
//         id: response.data.id,
//         email: response.data.primaryEmail,
//         name: response.data.name,
//         suspended: response.data.suspended
//       }
//     });
//   } catch (err) {
//     if (err.code === 404) {
//       res.json({
//         success: true,
//         exists: false
//       });
//     } else {
//       console.error('[emailCreateAPI] ❌ Email check error:', {
//         message: err.message,
//         code: err.code,
//         details: err.response?.data?.error
//       });
//       const statusCode = err.code === 403 ? 403 : 500;
//       res.status(statusCode).json({
//         success: false,
//         error: err.message,
//         details: err.response?.data?.error || null
//       });
//     }
//   }
// });

// /**
//  * @api {get} /google/email/health Health Check
//  * @apiName EmailApiHealth
//  * @apiGroup GoogleEmail
//  * 
//  * @apiSuccess {Boolean} success API status
//  * @apiSuccess {String} message Status message
//  */
// router.get('/google/email/health', async (req, res) => {
//   try {
//     await authClient.authorize();
//     const response = await directoryService.users.list({
//       domain: DOMAIN,
//       maxResults: 1
//     });

//     res.json({
//       success: true,
//       message: 'Google Workspace Email API is healthy',
//       domain: DOMAIN,
//       usersFound: response.data.users?.length || 0
//     });
//   } catch (err) {
//     console.error('[emailCreateAPI] ❌ Health check error:', {
//       message: err.message,
//       code: err.code,
//       details: err.response?.data?.error
//     });

//     res.status(500).json({
//       success: false,
//       error: err.message,
//       details: err.response?.data?.error || null
//     });
//   }
// });

// module.exports = router;