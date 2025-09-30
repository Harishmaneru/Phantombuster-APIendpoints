// const express = require('express');
// const axios = require('axios');
// const FormData = require('form-data');
// const fs = require('fs');
// const router = express.Router();

// // Use server-side API key from environment variables
// const checkApiKey = (req, res, next) => {
//   const API_KEY = process.env.UNIPILE_API_KEY;

//   if (!API_KEY) {
//     return res.status(500).json({
//       success: false,
//       error: 'Server configuration error: UniPlie API key not configured'
//     });
//   }

//   req.apiKey = API_KEY;
//   next();
// };

// // Build target URL with validation and environment defaults
// const buildBaseUrl = (subdomain, port) => {
//   // Use environment variables as defaults if not provided
//   const finalSubdomain = subdomain || process.env.UNIPILE_SUBDOMAIN;
//   const finalPort = port || process.env.UNIPILE_PORT;
  
//   if (!finalSubdomain || !finalPort) {
//     throw new Error('Subdomain and port are required. Provide via URL params or environment variables.');
//   }
//   return `https://${finalSubdomain}.unipile.com:${finalPort}/api/v1`;
// };

// // Unified error handler
// const handleError = (err, res) => {
//   console.error('API Error:', {
//     status: err.response?.status,
//     message: err.message,
//     url: err.config?.url
//   });

//   const status = err.response?.status || 500;
//   const message = err.response?.data?.error || err.message || 'Internal server error';

//   res.status(status).json({
//     success: false,
//     error: message
//   });
// };

// // 1.____________________ Fetch Accounts (with environment defaults) _____________________
// router.get('/accounts', checkApiKey, async (req, res) => {
//   try {
//     const BASE_URL = buildBaseUrl();
//     const response = await axios.get(`${BASE_URL}/accounts`, {
//       headers: {
//         'X-API-KEY': req.apiKey,
//         'Accept': 'application/json'
//       }
//     });

//     res.json({
//       success: true,
//       data: response.data
//     });
//   } catch (err) {
//     handleError(err, res);
//   }
// });

// // 1b.____________________ Fetch Accounts (legacy with params) _____________________
// router.get('/:subdomain/:port/accounts', checkApiKey, async (req, res) => {
//   try {
//     const { subdomain, port } = req.params;
//     const BASE_URL = buildBaseUrl(subdomain, port);

//     const response = await axios.get(`${BASE_URL}/accounts`, {
//       headers: {
//         'X-API-KEY': req.apiKey,
//         'Accept': 'application/json'
//       }
//     });

//     res.json({
//       success: true,
//       data: response.data
//     });
//   } catch (err) {
//     handleError(err, res);
//   }
// });

// // 2.____________________ List Chats (with environment defaults) _____________________
// router.get('/chats', checkApiKey, async (req, res) => {
//   try {
//     const { account_id, limit = 50, cursor } = req.query;
//     const BASE_URL = buildBaseUrl();

//     const params = new URLSearchParams();
//     if (account_id) params.append('account_id', account_id);
//     if (limit) params.append('limit', limit);
//     if (cursor) params.append('cursor', cursor);

//     const response = await axios.get(`${BASE_URL}/chats?${params}`, {
//       headers: {
//         'X-API-KEY': req.apiKey,
//         'Accept': 'application/json'
//       }
//     });

//     res.json({
//       success: true,
//       data: response.data
//     });
//   } catch (err) {
//     handleError(err, res);
//   }
// });

// // 2b.____________________ List Chats (legacy with params) _____________________
// router.get('/:subdomain/:port/chats', checkApiKey, async (req, res) => {
//   try {
//     const { subdomain, port } = req.params;
//     const { account_id, limit = 50, cursor } = req.query;
//     const BASE_URL = buildBaseUrl(subdomain, port);

//     const params = new URLSearchParams();
//     if (account_id) params.append('account_id', account_id);
//     if (limit) params.append('limit', limit);
//     if (cursor) params.append('cursor', cursor);

//     const response = await axios.get(`${BASE_URL}/chats?${params}`, {
//       headers: {
//         'X-API-KEY': req.apiKey,
//         'Accept': 'application/json'
//       }
//     });

//     res.json({
//       success: true,
//       data: response.data
//     });
//   } catch (err) {
//     handleError(err, res);
//   }
// });

// // 3.____________________ Get Chat Messages _____________________
// router.get('/:subdomain/:port/chats/:chatId/messages', checkApiKey, async (req, res) => {
//   try {
//     const { subdomain, port, chatId } = req.params;
//     const { account_id, limit = 100, cursor } = req.query;
//     const BASE_URL = buildBaseUrl(subdomain, port);

//     const params = new URLSearchParams();
//     if (account_id) params.append('account_id', account_id);
//     if (limit) params.append('limit', limit);
//     if (cursor) params.append('cursor', cursor);

//     const response = await axios.get(
//       `${BASE_URL}/chats/${chatId}/messages?${params}`,
//       { headers: { 'X-API-KEY': req.apiKey, 'Accept': 'application/json' } }
//     );

//     res.json({
//       success: true,
//       data: response.data
//     });
//   } catch (err) {
//     handleError(err, res);
//   }
// });

// // 4.____________________ Send Message (with file handling) _____________________
// router.post('/:subdomain/:port/chats/:chatId/messages', checkApiKey, async (req, res) => {
//   try {
//     const { subdomain, port, chatId } = req.params;
//     const BASE_URL = buildBaseUrl(subdomain, port);
//     const form = new FormData();

//     // Handle text and files
//     if (req.body.text) form.append('text', req.body.text);

//     // Handle media attachments
//     ['voice_message', 'video_message', 'attachments'].forEach(field => {
//       const files = req.files?.[field];
//       if (files) {
//         Array.isArray(files)
//           ? files.forEach(f => form.append(field, fs.createReadStream(f.path)))
//           : form.append(field, fs.createReadStream(files.path));
//       }
//     });

//     const response = await axios.post(
//       `${BASE_URL}/chats/${chatId}/messages`,
//       form,
//       {
//         headers: {
//           ...form.getHeaders(),
//           'X-API-KEY': req.apiKey
//         },
//         maxContentLength: Infinity,
//         maxBodyLength: Infinity
//       }
//     );

//     res.status(201).json({
//       success: true,
//       data: response.data
//     });
//   } catch (err) {
//     handleError(err, res);
//   }
// });

// // 5.____________________ Sync Chat _____________________ 
// router.get('/:subdomain/:port/chats/:chatId/sync', checkApiKey, async (req, res) => {
//   try {
//     const { subdomain, port, chatId } = req.params;
//     const { account_id, since } = req.query;
//     const BASE_URL = buildBaseUrl(subdomain, port);

//     const params = new URLSearchParams();
//     if (account_id) params.append('account_id', account_id);
//     if (since) params.append('since', since);

//     const response = await axios.get(
//       `${BASE_URL}/chats/${chatId}/sync?${params}`,
//       { headers: { 'X-API-KEY': req.apiKey, 'Accept': 'application/json' } }
//     );

//     res.json({
//       success: true,
//       data: response.data
//     });
//   } catch (err) {
//     handleError(err, res);
//   }
// });

// // 6.____________________ Get Chat Attendees _____________________
// router.get('/:subdomain/:port/chats/:chatId/attendees', checkApiKey, async (req, res) => {
//   try {
//     const { subdomain, port, chatId } = req.params;
//     const BASE_URL = buildBaseUrl(subdomain, port);

//     const response = await axios.get(
//       `${BASE_URL}/chats/${chatId}/attendees`,
//       {
//         headers: {
//           'X-API-KEY': req.apiKey,
//           'Accept': 'application/json'
//         }
//       }
//     );

//     res.json({
//       success: true,
//       data: response.data
//     });

//   } catch (err) {
//     handleError(err, res);
//   }
// });



// // 7.____________________ Create Hosted Auth Link (with environment defaults) _____________________
// router.post('/hosted/accounts/link', checkApiKey, async (req, res) => {
//   try {
//     const BASE_URL = buildBaseUrl();

//     // Payload from client - following Unipile documentation
//     const {
//       type = "create",
//       providers = ["LINKEDIN"],
//       success_redirect_url,
//       failure_redirect_url,
//       notify_url,
//       name
//     } = req.body;

//     // Validate required fields
//     if (!providers || !Array.isArray(providers)) {
//       return res.status(400).json({
//         success: false,
//         error: 'providers array is required'
//       });
//     }

//     // Generate expiration date (24 hours from now)
//     const expiresOn = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

//     const payload = {
//       type,
//       providers,
//       expiresOn, // Required: ISO 8601 UTC datetime
//       api_url: `https://${process.env.UNIPILE_SUBDOMAIN}.unipile.com:${process.env.UNIPILE_PORT}`, // Required: Unipile server URL
//       ...(success_redirect_url && { success_redirect_url }),
//       ...(failure_redirect_url && { failure_redirect_url }),
//       ...(notify_url && { notify_url }),
//       ...(name && { name })
//     };

//     // Debug logging
//     console.log('Sending payload to Unipile:', {
//       url: `${BASE_URL}/hosted/accounts/link`,
//       payload,
//       headers: {
//         'X-API-KEY': req.apiKey ? '***masked***' : 'MISSING',
//         'Content-Type': 'application/json'
//       }
//     });

//     const response = await axios.post(
//       `${BASE_URL}/hosted/accounts/link`,
//       payload,
//       {
//         headers: {
//           'X-API-KEY': req.apiKey,
//           'Content-Type': 'application/json'
//         }
//       }
//     );

//     res.json({
//       success: true,
//       data: response.data, // contains the hosted-auth URL
//       message: 'Hosted auth link created successfully. Redirect user to the provided URL.'
//     });
//   } catch (err) {
//     // Enhanced error logging for debugging
//     console.error('Unipile API Error Details:', {
//       status: err.response?.status,
//       statusText: err.response?.statusText,
//       data: err.response?.data,
//       url: err.config?.url,
//       method: err.config?.method,
//       headers: err.config?.headers
//     });
//     handleError(err, res);
//   }
// });

// // 7b.____________________ Create Hosted Auth Link (legacy with params) _____________________
// router.post('/:subdomain/:port/hosted/accounts/link', checkApiKey, async (req, res) => {
//   try {
//     const { subdomain, port } = req.params;
//     const BASE_URL = buildBaseUrl(subdomain, port);

//     // Payload from client - following Unipile documentation
//     const {
//       type = "create",
//       providers = ["LINKEDIN"],
//       success_redirect_url,
//       failure_redirect_url,
//       notify_url,
//       name
//     } = req.body;

//     // Validate required fields
//     if (!providers || !Array.isArray(providers)) {
//       return res.status(400).json({
//         success: false,
//         error: 'providers array is required'
//       });
//     }

//     // Generate expiration date (24 hours from now)
//     const expiresOn = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

//     const payload = {
//       type,
//       providers,
//       expiresOn, // Required: ISO 8601 UTC datetime
//       api_url: `https://${subdomain}.unipile.com:${port}`, // Required: Unipile server URL
//       ...(success_redirect_url && { success_redirect_url }),
//       ...(failure_redirect_url && { failure_redirect_url }),
//       ...(notify_url && { notify_url }),
//       ...(name && { name })
//     };

//     // Debug logging
//     console.log('Sending payload to Unipile:', {
//       url: `${BASE_URL}/hosted/accounts/link`,
//       payload,
//       headers: {
//         'X-API-KEY': req.apiKey ? '***masked***' : 'MISSING',
//         'Content-Type': 'application/json'
//       }
//     });

//     const response = await axios.post(
//       `${BASE_URL}/hosted/accounts/link`,
//       payload,
//       {
//         headers: {
//           'X-API-KEY': req.apiKey,
//           'Content-Type': 'application/json'
//         }
//       }
//     );

//     res.json({
//       success: true,
//       data: response.data, // contains the hosted-auth URL
//       message: 'Hosted auth link created successfully. Redirect user to the provided URL.'
//     });
//   } catch (err) {
//     // Enhanced error logging for debugging
//     console.error('Unipile API Error Details:', {
//       status: err.response?.status,
//       statusText: err.response?.statusText,
//       data: err.response?.data,
//       url: err.config?.url,
//       method: err.config?.method,
//       headers: err.config?.headers
//     });
//     handleError(err, res);
//   }
// });

// // 8.____________________ Webhook Handler for Account Creation _____________________
// router.post('/webhook/account-created', async (req, res) => {
//   try {
//     const { status, account_id, name, provider } = req.body;

//     console.log('Unipile webhook received:', {
//       status,
//       account_id,
//       name,
//       provider,
//       timestamp: new Date().toISOString()
//     });

//     // Handle successful account creation
//     if (status === 'CREATION_SUCCESS' && account_id) {
//       // Here you would typically:
//       // 1. Store the account_id in your database
//       // 2. Associate it with the user (using the 'name' field)
//       // 3. Update user's account status

//       console.log(`Account created successfully for user ${name}: ${account_id}`);

//       // Example: Store in database (implement your own logic)
//       // await User.updateOne(
//       //   { _id: name }, 
//       //   { 
//       //     $set: { 
//       //       linkedin_account_id: account_id,
//       //       linkedin_connected: true,
//       //       linkedin_connected_at: new Date()
//       //     }
//       //   }
//       // );

//       res.status(200).json({
//         success: true,
//         message: 'Account creation webhook processed successfully'
//       });
//     }
//     // Handle account creation failure
//     else if (status === 'CREATION_FAILED') {
//       console.log(`Account creation failed for user ${name}:`, req.body);

//       // Update user status to reflect failure
//       // await User.updateOne(
//       //   { _id: name }, 
//       //   { 
//       //     $set: { 
//       //       linkedin_connected: false,
//       //       linkedin_error: req.body.error || 'Account creation failed'
//       //     }
//       //   }
//       // );

//       res.status(200).json({
//         success: true,
//         message: 'Account creation failure webhook processed'
//       });
//     }
//     // Handle other statuses
//     else {
//       console.log('Unknown webhook status:', status);
//       res.status(200).json({
//         success: true,
//         message: 'Webhook received with unknown status'
//       });
//     }
//   } catch (err) {
//     console.error('Webhook processing error:', err);
//     res.status(500).json({
//       success: false,
//       error: 'Webhook processing failed'
//     });
//   }
// });

// // 9.____________________ Get Account Details _____________________
// router.get('/:subdomain/:port/accounts/:accountId', checkApiKey, async (req, res) => {
//   try {
//     const { subdomain, port, accountId } = req.params;
//     const BASE_URL = buildBaseUrl(subdomain, port);

//     const response = await axios.get(
//       `${BASE_URL}/accounts/${accountId}`,
//       {
//         headers: {
//           'X-API-KEY': req.apiKey,
//           'Accept': 'application/json'
//         }
//       }
//     );

//     res.json({
//       success: true,
//       data: response.data
//     });
//   } catch (err) {
//     handleError(err, res);
//   }
// });

// // 10.____________________ Delete Account _____________________
// router.delete('/:subdomain/:port/accounts/:accountId', checkApiKey, async (req, res) => {
//   try {
//     const { subdomain, port, accountId } = req.params;
//     const BASE_URL = buildBaseUrl(subdomain, port);

//     const response = await axios.delete(
//       `${BASE_URL}/accounts/${accountId}`,
//       {
//         headers: {
//           'X-API-KEY': req.apiKey,
//           'Accept': 'application/json'
//         }
//       }
//     );

//     res.json({
//       success: true,
//       data: response.data,
//       message: 'Account deleted successfully'
//     });
//   } catch (err) {
//     handleError(err, res);
//   }
// });

// // 11.____________________ Send LinkedIn Message (with environment defaults) _____________________
// router.post('/linkedin/message', checkApiKey, async (req, res) => {
//   try {
//     const BASE_URL = buildBaseUrl();

//     const {
//       account_id,            // Required: Unipile LinkedIn account ID
//       profile_url,           // LinkedIn profile URL (e.g., https://linkedin.com/in/johndoe)
//       profile_identifier,    // Alternative: LinkedIn username/identifier
//       message,               // Required: Message text
//       use_inmail = false,    // Optional: true → send as InMail (requires Premium)
//       attachments            // Optional: file attachments
//     } = req.body;

//     // Validate
//     if (!account_id || !message) {
//       return res.status(400).json({ success: false, error: 'account_id and message are required' });
//     }
//     if (!profile_url && !profile_identifier) {
//       return res.status(400).json({ success: false, error: 'Provide profile_url or profile_identifier' });
//     }

//     // Extract identifier from URL if provided
//     let recipientId = profile_identifier;
//     if (profile_url && !profile_identifier) {
//       const match = profile_url.match(/linkedin\.com\/in\/([^\/\?]+)/);
//       if (match) {
//         recipientId = match[1];
//       } else {
//         return res.status(400).json({ success: false, error: 'Invalid LinkedIn profile URL format' });
//       }
//     }

//     // Build payload
//     const payload = {
//       account_id,
//       attendees_ids: [recipientId],
//       text: message,
//       ...(use_inmail && { options: { linkedin: { inmail: true } } })
//     };

//     // Send message (Unipile will create new chat if needed)
//     const response = await axios.post(
//       `${BASE_URL}/chats`,
//       payload,
//       {
//         headers: {
//           'X-API-KEY': req.apiKey,
//           'Content-Type': 'application/json'
//         }
//       }
//     );

//     res.json({
//       success: true,
//       data: response.data,
//       message: use_inmail
//         ? 'InMail sent successfully'
//         : 'Message sent successfully (chat created if it did not exist)',
//       chat_id: response.data.id,
//       recipient_id: recipientId
//     });

//   } catch (err) {
//     console.error('LinkedIn message error:', err.response?.data || err.message);
//     handleError(err, res);
//   }
// });

// // 11b.____________________ Send LinkedIn Message (legacy with params) _____________________
// router.post('/:subdomain/:port/linkedin/message', checkApiKey, async (req, res) => {
//   try {
//     const { subdomain, port } = req.params;
//     const BASE_URL = buildBaseUrl(subdomain, port);

//     const {
//       account_id,            // Required: Unipile LinkedIn account ID
//       profile_url,           // LinkedIn profile URL (e.g., https://linkedin.com/in/johndoe)
//       profile_identifier,    // Alternative: LinkedIn username/identifier
//       message,               // Required: Message text
//       use_inmail = false,    // Optional: true → send as InMail (requires Premium)
//       attachments            // Optional: file attachments
//     } = req.body;

//     // Validate
//     if (!account_id || !message) {
//       return res.status(400).json({ success: false, error: 'account_id and message are required' });
//     }
//     if (!profile_url && !profile_identifier) {
//       return res.status(400).json({ success: false, error: 'Provide profile_url or profile_identifier' });
//     }

//     // Extract identifier from URL if provided
//     let recipientId = profile_identifier;
//     if (profile_url && !profile_identifier) {
//       const match = profile_url.match(/linkedin\.com\/in\/([^\/\?]+)/);
//       if (match) {
//         recipientId = match[1];
//       } else {
//         return res.status(400).json({ success: false, error: 'Invalid LinkedIn profile URL format' });
//       }
//     }

//     // Build payload
//     const payload = {
//       account_id,
//       attendees_ids: [recipientId],
//       text: message,
//       ...(use_inmail && { options: { linkedin: { inmail: true } } })
//     };

//     // Send message (Unipile will create new chat if needed)
//     const response = await axios.post(
//       `${BASE_URL}/chats`,
//       payload,
//       {
//         headers: {
//           'X-API-KEY': req.apiKey,
//           'Content-Type': 'application/json'
//         }
//       }
//     );

//     res.json({
//       success: true,
//       data: response.data,
//       message: use_inmail
//         ? 'InMail sent successfully'
//         : 'Message sent successfully (chat created if it did not exist)',
//       chat_id: response.data.id,
//       recipient_id: recipientId
//     });

//   } catch (err) {
//     console.error('LinkedIn message error:', err.response?.data || err.message);
//     handleError(err, res);
//   }
// });


// router.post('/accounts/cookie', checkApiKey, async (req, res) => {
//   const BASE_URL = buildBaseUrl();
//   const { access_token, user_agent } = req.body;

//   if (!access_token || !user_agent) {
//     return res.status(400).json({
//       success: false,
//       error: 'access_token (li_at) and user_agent are required'
//     });
//   }

//   const payload = { provider: "LINKEDIN", access_token, user_agent };
//   try {
//     const response = await axios.post(`${BASE_URL}/accounts`, payload, {
//       headers: { 'X-API-KEY': req.apiKey, 'Content-Type': 'application/json' }
//     });
//     res.status(201).json({ success: true, data: response.data });
//   } catch (err) {
//     handleError(err, res);
//   }
// });


// module.exports = router;



const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const router = express.Router();

// ==================== MIDDLEWARE ====================

// Validate environment variables on startup
const validateConfig = () => {
  const required = ['UNIPILE_API_KEY', 'UNIPILE_SUBDOMAIN', 'UNIPILE_PORT'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};

validateConfig();

// Build base URL from environment
const getBaseUrl = () => {
  return `https://${process.env.UNIPILE_SUBDOMAIN}.unipile.com:${process.env.UNIPILE_PORT}/api/v1`;
};

// Standard headers for all requests
const getHeaders = (contentType = 'application/json') => ({
  'X-API-KEY': process.env.UNIPILE_API_KEY,
  'Accept': 'application/json',
  ...(contentType && { 'Content-Type': contentType })
});

// Unified error handler
const handleError = (err, res) => {
  console.error('API Error:', {
    status: err.response?.status,
    message: err.message,
    data: err.response?.data,
    url: err.config?.url
  });

  const status = err.response?.status || 500;
  const message = err.response?.data?.error || err.message || 'Internal server error';

  res.status(status).json({
    success: false,
    error: message
  });
};

// ==================== ACCOUNT ENDPOINTS ====================

// Get all accounts
router.get('/api/unipile/accounts', async (req, res) => {
  try {
    const response = await axios.get(`${getBaseUrl()}/accounts`, {
      headers: getHeaders()
    });

    res.json({
      success: true,
      data: response.data
    });
  } catch (err) {
    handleError(err, res);
  }
});

// Get specific account details
router.get('/api/unipile/accounts/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    
    const response = await axios.get(`${getBaseUrl()}/accounts/${accountId}`, {
      headers: getHeaders()
    });

    res.json({
      success: true,
      data: response.data
    });
  } catch (err) {
    handleError(err, res);
  }
});

// Create account via cookie (li_at token)
router.post('/api/unipile/accounts/cookie', async (req, res) => {
  try {
    const { access_token, user_agent } = req.body;

    if (!access_token || !user_agent) {
      return res.status(400).json({
        success: false,
        error: 'access_token (li_at) and user_agent are required'
      });
    }

    const payload = {
      provider: 'LINKEDIN',
      access_token,
      user_agent
    };

    const response = await axios.post(`${getBaseUrl()}/accounts`, payload, {
      headers: getHeaders()
    });

    res.status(201).json({
      success: true,
      data: response.data,
      message: 'LinkedIn account connected successfully'
    });
  } catch (err) {
    handleError(err, res);
  }
});

// Delete account
router.delete('/api/unipile/accounts/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    
    const response = await axios.delete(`${getBaseUrl()}/accounts/${accountId}`, {
      headers: getHeaders()
    });

    res.json({
      success: true,
      data: response.data,
      message: 'Account deleted successfully'
    });
  } catch (err) {
    handleError(err, res);
  }
});

// ==================== HOSTED AUTH ENDPOINTS ====================

// Create hosted authentication link
router.post('/api/unipile/auth/link', async (req, res) => {
  try {
    const {
      providers = ['LINKEDIN'],
      success_redirect_url,
      failure_redirect_url,
      notify_url,
      name,
      type = 'create'
    } = req.body;

    // Validate providers
    if (!providers || !Array.isArray(providers) || providers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'providers array is required and must not be empty'
      });
    }

    // Generate expiration (24 hours from now)
    const expiresOn = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const payload = {
      type,
      providers,
      expiresOn,
      api_url: `https://${process.env.UNIPILE_SUBDOMAIN}.unipile.com:${process.env.UNIPILE_PORT}`,
      ...(success_redirect_url && { success_redirect_url }),
      ...(failure_redirect_url && { failure_redirect_url }),
      ...(notify_url && { notify_url }),
      ...(name && { name })
    };

    const response = await axios.post(
      `${getBaseUrl()}/hosted/accounts/link`,
      payload,
      { headers: getHeaders() }
    );

    res.json({
      success: true,
      data: response.data,
      message: 'Hosted auth link created successfully'
    });
  } catch (err) {
    handleError(err, res);
  }
});

// Webhook handler for account creation
router.post('/api/unipile/webhook/unipile-account', async (req, res) => {
  try {
    const { status, account_id, name, provider, error } = req.body;

    console.log('Unipile webhook received:', {
      status,
      account_id,
      name,
      provider,
      timestamp: new Date().toISOString()
    });

    if (status === 'CREATION_SUCCESS' && account_id) {
      console.log(`✅ Account created successfully for user ${name}: ${account_id}`);
      
      // TODO: Store account_id in your database
      // Example:
      // await User.updateOne(
      //   { _id: name },
      //   {
      //     $set: {
      //       linkedin_account_id: account_id,
      //       linkedin_connected: true,
      //       linkedin_connected_at: new Date()
      //     }
      //   }
      // );

      res.json({
        success: true,
        message: 'Account creation processed successfully'
      });
    } 
    else if (status === 'CREATION_FAILED') {
      console.log(`❌ Account creation failed for user ${name}:`, error);
      
      // TODO: Update user status
      // await User.updateOne(
      //   { _id: name },
      //   {
      //     $set: {
      //       linkedin_connected: false,
      //       linkedin_error: error || 'Account creation failed'
      //     }
      //   }
      // );

      res.json({
        success: true,
        message: 'Account creation failure processed'
      });
    }
    else {
      console.log('⚠️ Unknown webhook status:', status);
      res.json({
        success: true,
        message: 'Webhook received'
      });
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(500).json({
      success: false,
      error: 'Webhook processing failed'
    });
  }
});

// ==================== CHAT ENDPOINTS ====================

// List all chats
router.get('/api/unipile/chats', async (req, res) => {
  try {
    const { account_id, limit = 50, cursor } = req.query;

    if (!account_id) {
      return res.status(400).json({
        success: false,
        error: 'account_id is required'
      });
    }

    const params = new URLSearchParams();
    params.append('account_id', account_id);
    params.append('limit', limit);
    if (cursor) params.append('cursor', cursor);

    const response = await axios.get(`${getBaseUrl()}/chats?${params}`, {
      headers: getHeaders()
    });

    res.json({
      success: true,
      data: response.data
    });
  } catch (err) {
    handleError(err, res);
  }
});

// Get messages from a specific chat
router.get('/api/unipile/chats/:chatId/messages', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { account_id, limit = 100, cursor } = req.query;

    if (!account_id) {
      return res.status(400).json({
        success: false,
        error: 'account_id is required'
      });
    }

    const params = new URLSearchParams();
    params.append('account_id', account_id);
    params.append('limit', limit);
    if (cursor) params.append('cursor', cursor);

    const response = await axios.get(
      `${getBaseUrl()}/chats/${chatId}/messages?${params}`,
      { headers: getHeaders() }
    );

    res.json({
      success: true,
      data: response.data
    });
  } catch (err) {
    handleError(err, res);
  }
});

// Send message in existing chat
router.post('/api/unipile/chats/:chatId/messages', async (req, res) => {
  try {
    const { chatId } = req.params;
    const form = new FormData();

    // Add text message
    if (req.body.text) {
      form.append('text', req.body.text);
    }

    // Add account_id if provided
    if (req.body.account_id) {
      form.append('account_id', req.body.account_id);
    }

    // Handle file attachments
    ['voice_message', 'video_message', 'attachments'].forEach(field => {
      const files = req.files?.[field];
      if (files) {
        const fileArray = Array.isArray(files) ? files : [files];
        fileArray.forEach(file => {
          form.append(field, fs.createReadStream(file.path));
        });
      }
    });

    const response = await axios.post(
      `${getBaseUrl()}/chats/${chatId}/messages`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'X-API-KEY': process.env.UNIPILE_API_KEY
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );

    res.status(201).json({
      success: true,
      data: response.data,
      message: 'Message sent successfully'
    });
  } catch (err) {
    handleError(err, res);
  }
});

// Sync chat (get new messages since timestamp)
router.get('/api/unipile/chats/:chatId/sync', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { account_id, since } = req.query;

    if (!account_id) {
      return res.status(400).json({
        success: false,
        error: 'account_id is required'
      });
    }

    const params = new URLSearchParams();
    params.append('account_id', account_id);
    if (since) params.append('since', since);

    const response = await axios.get(
      `${getBaseUrl()}/chats/${chatId}/sync?${params}`,
      { headers: getHeaders() }
    );

    res.json({
      success: true,
      data: response.data
    });
  } catch (err) {
    handleError(err, res);
  }
});

// Get chat attendees/participants
router.get('/api/unipile/chats/:chatId/attendees', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { account_id } = req.query;

    if (!account_id) {
      return res.status(400).json({
        success: false,
        error: 'account_id is required'
      });
    }

    const params = new URLSearchParams();
    params.append('account_id', account_id);

    const response = await axios.get(
      `${getBaseUrl()}/chats/${chatId}/attendees?${params}`,
      { headers: getHeaders() }
    );

    res.json({
      success: true,
      data: response.data
    });
  } catch (err) {
    handleError(err, res);
  }
});

// ==================== LINKEDIN MESSAGING ====================

// Send LinkedIn message (creates chat if doesn't exist)
router.post('/api/unipile/linkedin/message', async (req, res) => {
  try {
    const {
      account_id,
      profile_url,
      profile_identifier,
      message,
      use_inmail = false
    } = req.body;

    // Validation
    if (!account_id) {
      return res.status(400).json({
        success: false,
        error: 'account_id is required'
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'message is required'
      });
    }

    if (!profile_url && !profile_identifier) {
      return res.status(400).json({
        success: false,
        error: 'Either profile_url or profile_identifier is required'
      });
    }

    // Extract LinkedIn identifier from URL if provided
    let recipientId = profile_identifier;
    if (profile_url && !profile_identifier) {
      const match = profile_url.match(/linkedin\.com\/in\/([^\/\?]+)/);
      if (match) {
        recipientId = match[1];
      } else {
        return res.status(400).json({
          success: false,
          error: 'Invalid LinkedIn profile URL format. Expected: https://linkedin.com/in/username'
        });
      }
    }

    // Build payload
    const payload = {
      account_id,
      attendees_ids: [recipientId],
      text: message,
      ...(use_inmail && { options: { linkedin: { inmail: true } } })
    };

    // Send message (Unipile creates chat if it doesn't exist)
    const response = await axios.post(
      `${getBaseUrl()}/chats`,
      payload,
      { headers: getHeaders() }
    );

    res.json({
      success: true,
      data: response.data,
      message: use_inmail
        ? 'InMail sent successfully'
        : 'Message sent successfully',
      chat_id: response.data.id,
      recipient_id: recipientId
    });
  } catch (err) {
    console.error('LinkedIn message error:', err.response?.data || err.message);
    handleError(err, res);
  }
});

// ==================== HEALTH CHECK ====================

router.get('/api/unipile/health', (req, res) => {
  res.json({
    success: true,
    message: 'Unipile API proxy is running',
    config: {
      subdomain: process.env.UNIPILE_SUBDOMAIN,
      port: process.env.UNIPILE_PORT,
      api_key_configured: !!process.env.UNIPILE_API_KEY
    }
  });
});

module.exports = router;