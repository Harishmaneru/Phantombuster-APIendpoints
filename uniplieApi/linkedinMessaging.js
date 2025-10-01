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

// Import LinkedIn account service
const {
    connectLinkedInAccount,
    disconnectLinkedInAccount,
    getLinkedInAccountStatus,
    refreshLinkedInAccount,
    handleAccountError,
    getAllLinkedInAccounts,
    deleteLinkedInAccount
} = require('./linkedinAccountService');

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
    const { access_token, user_agent, user_id, name } = req.body;

    if (!access_token || !user_agent) {
      return res.status(400).json({
        success: false,
        error: 'access_token (li_at) and user_agent are required'
      });
    }

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id is required to store account information'
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

    // Store account in database
    if (response.data && response.data.account_id) {
      const dbResult = await connectLinkedInAccount(
        user_id,
        response.data.account_id,
        'LINKEDIN',
        name || 'LinkedIn Account',
        {
          user_agent: user_agent,
          connected_via: 'cookie',
          unipile_response: response.data
        }
      );

      if (!dbResult.success) {
        console.error('Failed to store account in database:', dbResult.error);
        // Continue with success response but log the error
      }
    }

    res.status(201).json({
      success: true,
      data: response.data,
      message: 'LinkedIn account connected successfully',
      stored_in_db: response.data && response.data.account_id ? true : false
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
      user_id,
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

    // Include user_id in notify_url if provided
    let finalNotifyUrl = notify_url;
    if (user_id && notify_url) {
      const separator = notify_url.includes('?') ? '&' : '?';
      finalNotifyUrl = `${notify_url}${separator}user_id=${user_id}`;
    }

    const payload = {
      type,
      providers,
      expiresOn,
      api_url: `https://${process.env.UNIPILE_SUBDOMAIN}.unipile.com:${process.env.UNIPILE_PORT}`,
      ...(success_redirect_url && { success_redirect_url }),
      ...(failure_redirect_url && { failure_redirect_url }),
      ...(finalNotifyUrl && { notify_url: finalNotifyUrl }),
      ...(name && { name }),
      ...(user_id && { user_id }) // Include user_id in payload for webhook
    };

    const response = await axios.post(
      `${getBaseUrl()}/hosted/accounts/link`,
      payload,
      { headers: getHeaders() }
    );

    res.json({
      success: true,
      data: response.data,
      message: 'Hosted auth link created successfully',
      user_id: user_id,
      note: user_id ? 'User ID included for webhook processing' : 'No user ID provided - account will not be stored automatically'
    });
  } catch (err) {
    handleError(err, res);
  }
});

// Webhook handler for account creation and errors
router.post('/api/unipile/webhook/unipile-account', async (req, res) => {
  try {
    const { status, account_id, name, provider, error, user_id } = req.body;
    
    // Also check for user_id in query parameters (from notify_url)
    const userIdFromQuery = req.query.user_id;
    const finalUserId = user_id || userIdFromQuery;

    console.log('Unipile webhook received:', {
      status,
      account_id,
      name,
      provider,
      user_id: finalUserId,
      user_id_from_body: user_id,
      user_id_from_query: userIdFromQuery,
      timestamp: new Date().toISOString()
    });

    if (status === 'CREATION_SUCCESS' && account_id) {
      console.log(`✅ Account created successfully for user ${name || finalUserId}: ${account_id}`);
      
      // Store account in database if user_id is provided
      if (finalUserId) {
        const dbResult = await connectLinkedInAccount(
          finalUserId,
          account_id,
          provider || 'LINKEDIN',
          name || 'LinkedIn Account',
          {
            connected_via: 'hosted_auth',
            webhook_data: req.body
          }
        );

        if (!dbResult.success) {
          console.error('Failed to store account in database:', dbResult.error);
        }
      } else {
        // If no user_id provided, store with a temporary identifier
        // This allows you to manually associate the account later
        const tempUserId = `temp_${account_id}_${Date.now()}`;
        console.log(`⚠️ No user_id provided, storing with temporary ID: ${tempUserId}`);
        
        const dbResult = await connectLinkedInAccount(
          tempUserId,
          account_id,
          provider || 'LINKEDIN',
          name || 'LinkedIn Account',
          {
            connected_via: 'hosted_auth',
            webhook_data: req.body,
            is_temporary: true,
            needs_user_association: true
          }
        );

        if (!dbResult.success) {
          console.error('Failed to store account in database:', dbResult.error);
        }
      }

      res.json({
        success: true,
        message: 'Account creation processed successfully',
        stored_in_db: true,
        user_id: finalUserId || `temp_${account_id}_${Date.now()}`,
        note: finalUserId ? 'Account associated with user' : 'Account stored with temporary ID - needs user association'
      });
    } 
    else if (status === 'CREATION_FAILED') {
      console.log(`❌ Account creation failed for user ${name || finalUserId}:`, error);
      
      // Update user status if user_id is provided
      if (finalUserId) {
        const dbResult = await disconnectLinkedInAccount(
          finalUserId,
          error || 'Account creation failed'
        );
        
        if (!dbResult.success) {
          console.error('Failed to update account status in database:', dbResult.error);
        }
      }

      res.json({
        success: true,
        message: 'Account creation failure processed',
        updated_in_db: !!finalUserId
      });
    }
    else if (status === 'ACCOUNT_ERROR' || status === 'ACCOUNT_STOPPED') {
      console.log(`⚠️ Account error/stopped for account ${account_id}:`, error);
      
      // Handle account error
      const dbResult = await handleAccountError(account_id, error || 'Account error occurred');
      
      if (!dbResult.success) {
        console.error('Failed to handle account error in database:', dbResult.error);
      }

      res.json({
        success: true,
        message: 'Account error handled successfully',
        updated_in_db: dbResult.success
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

// ==================== ACCOUNT MANAGEMENT ENDPOINTS ====================

// Associate temporary account with real user ID
router.post('/api/unipile/account/associate', async (req, res) => {
  try {
    const { account_id, user_id, name } = req.body;
    
    if (!account_id || !user_id) {
      return res.status(400).json({
        success: false,
        error: 'account_id and user_id are required'
      });
    }

    // Use the service function to handle the association
    const result = await connectLinkedInAccount(
      user_id,
      account_id,
      'LINKEDIN',
      name || 'LinkedIn Account',
      {
        connected_via: 'association',
        is_temporary: false,
        needs_user_association: false,
        associated_at: new Date()
      }
    );

    if (result.success) {
      res.json({
        success: true,
        message: 'Account associated successfully',
        account_id: account_id,
        user_id: user_id
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Failed to associate account'
      });
    }
  } catch (err) {
    console.error('Error associating account:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to associate account'
    });
  }
});

// Get temporary accounts that need user association
router.get('/api/unipile/accounts/temporary', async (req, res) => {
  try {
    const result = await getAllLinkedInAccounts({
      'metadata.is_temporary': true,
      'metadata.needs_user_association': true
    });

    res.json(result);
  } catch (err) {
    console.error('Error getting temporary accounts:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to get temporary accounts'
    });
  }
});

// Get LinkedIn account status for a user (from database)
router.get('/api/unipile/account/status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'user_id is required'
      });
    }

    const result = await getLinkedInAccountStatus(userId);
    res.json(result);
  } catch (err) {
    console.error('Error getting account status:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to get account status'
    });
  }
});

// Get live LinkedIn account status from Unipile API
router.get('/api/unipile/account/live-status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'user_id is required'
      });
    }

    // First, get the account_id from our database
    const dbResult = await getLinkedInAccountStatus(userId);
    
    if (!dbResult.success || !dbResult.account_id) {
      return res.json({
        success: true,
        connected: false,
        message: 'No LinkedIn account found in database',
        source: 'database'
      });
    }

    // Now fetch live status from Unipile
    const response = await axios.get(
      `${getBaseUrl()}/accounts/${dbResult.account_id}`,
      { headers: getHeaders() }
    );

    const unipileAccount = response.data;
    
    // Parse the Unipile response to determine connection status
    let isConnected = false;
    let connectionStatus = 'unknown';
    let lastError = null;
    let sources = [];
    let linkedinProfile = null;

    if (unipileAccount && unipileAccount.sources) {
      sources = unipileAccount.sources;
      
      // Check if any source has status "OK" (based on your API response)
      const activeSource = sources.find(source => 
        source.status === 'OK' || 
        source.status === 'active' || 
        source.status === 'connected'
      );
      
      if (activeSource) {
        isConnected = true;
        connectionStatus = activeSource.status;
      } else {
        isConnected = false;
        connectionStatus = sources.length > 0 ? sources[0].status : 'unknown';
        lastError = sources.length > 0 ? sources[0].error : 'No active sources';
      }
    }

    // Extract LinkedIn profile information if available
    if (unipileAccount.connection_params && unipileAccount.connection_params.im) {
      linkedinProfile = {
        id: unipileAccount.connection_params.im.id,
        publicIdentifier: unipileAccount.connection_params.im.publicIdentifier,
        username: unipileAccount.connection_params.im.username,
        premiumId: unipileAccount.connection_params.im.premiumId,
        premiumFeatures: unipileAccount.connection_params.im.premiumFeatures,
        organizations: unipileAccount.connection_params.im.organizations
      };
    }

    // Update database if status changed
    if (isConnected !== dbResult.connected) {
      if (isConnected) {
        await connectLinkedInAccount(
          userId,
          dbResult.account_id,
          'LINKEDIN',
          dbResult.name,
          {
            ...dbResult.metadata,
            last_live_check: new Date(),
            live_status: connectionStatus
          }
        );
      } else {
        await disconnectLinkedInAccount(
          userId,
          lastError || 'Account disconnected (live check)'
        );
      }
    }

    res.json({
      success: true,
      connected: isConnected,
      account_id: dbResult.account_id,
      name: unipileAccount.name || dbResult.name,
      type: unipileAccount.type,
      created_at: unipileAccount.created_at,
      connection_status: connectionStatus,
      last_error: lastError,
      sources: sources,
      linkedin_profile: linkedinProfile,
      unipile_data: unipileAccount,
      last_checked: new Date(),
      source: 'unipile_live',
      database_status: {
        connected: dbResult.connected,
        connected_at: dbResult.connected_at,
        last_error: dbResult.last_error
      }
    });

  } catch (err) {
    console.error('Error getting live account status:', err);
    
    // If Unipile API fails, fall back to database status
    try {
      const dbResult = await getLinkedInAccountStatus(req.params.userId);
      res.json({
        success: true,
        connected: dbResult.connected || false,
        account_id: dbResult.account_id,
        name: dbResult.name,
        last_error: dbResult.last_error,
        source: 'database_fallback',
        unipile_error: err.response?.data?.error || err.message,
        note: 'Unipile API unavailable, showing database status'
      });
    } catch (dbErr) {
      res.status(500).json({
        success: false,
        error: 'Failed to get account status from both Unipile and database',
        unipile_error: err.response?.data?.error || err.message,
        database_error: dbErr.message
      });
    }
  }
});

// Disconnect LinkedIn account
router.post('/api/unipile/account/disconnect', async (req, res) => {
  try {
    const { user_id, reason } = req.body;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id is required'
      });
    }

    const result = await disconnectLinkedInAccount(user_id, reason);
    res.json(result);
  } catch (err) {
    console.error('Error disconnecting account:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to disconnect account'
    });
  }
});

// Refresh LinkedIn account (reconnect with new credentials)
router.post('/api/unipile/account/refresh', async (req, res) => {
  try {
    const { user_id, access_token, user_agent, name } = req.body;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id is required'
      });
    }

    if (!access_token || !user_agent) {
      return res.status(400).json({
        success: false,
        error: 'access_token (li_at) and user_agent are required for refresh'
      });
    }

    // Create new account with Unipile
    const payload = {
      provider: 'LINKEDIN',
      access_token,
      user_agent
    };

    const response = await axios.post(`${getBaseUrl()}/accounts`, payload, {
      headers: getHeaders()
    });

    if (response.data && response.data.account_id) {
      // Update database with new account
      const dbResult = await refreshLinkedInAccount(
        user_id,
        response.data.account_id,
        name || 'LinkedIn Account',
        {
          user_agent: user_agent,
          connected_via: 'refresh',
          unipile_response: response.data
        }
      );

      res.json({
        success: true,
        data: response.data,
        message: 'LinkedIn account refreshed successfully',
        stored_in_db: dbResult.success
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Failed to create new account with Unipile'
      });
    }
  } catch (err) {
    console.error('Error refreshing account:', err);
    handleError(err, res);
  }
});

// Delete LinkedIn account completely
router.delete('/api/unipile/account/delete/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'user_id is required'
      });
    }

    const result = await deleteLinkedInAccount(userId);
    res.json(result);
  } catch (err) {
    console.error('Error deleting account:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to delete account'
    });
  }
});

// Get all LinkedIn accounts (admin endpoint)
router.get('/api/unipile/accounts/all', async (req, res) => {
  try {
    const { connected, user_id } = req.query;
    
    const filters = {};
    if (connected !== undefined) {
      filters.connected = connected === 'true';
    }
    if (user_id) {
      filters.user_id = user_id;
    }

    const result = await getAllLinkedInAccounts(filters);
    res.json(result);
  } catch (err) {
    console.error('Error getting all accounts:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to get accounts'
    });
  }
});

// Restart LinkedIn account (restore connection)
router.post('/api/unipile/account/restart/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'user_id is required'
      });
    }

    // First, get the account_id from our database
    const dbResult = await getLinkedInAccountStatus(userId);
    
    if (!dbResult.success || !dbResult.account_id) {
      return res.status(404).json({
        success: false,
        error: 'No LinkedIn account found for this user'
      });
    }

    // Call Unipile restart API
    const response = await axios.post(
      `${getBaseUrl()}/accounts/${dbResult.account_id}/restart`,
      {},
      { headers: getHeaders() }
    );

    // Update database to reflect restart attempt
    await connectLinkedInAccount(
      userId,
      dbResult.account_id,
      'LINKEDIN',
      dbResult.name,
      {
        ...dbResult.metadata,
        last_restart_attempt: new Date(),
        restart_response: response.data,
        connected_via: dbResult.metadata?.connected_via || 'restart'
      }
    );

    res.json({
      success: true,
      message: 'Account restart initiated successfully',
      account_id: dbResult.account_id,
      user_id: userId,
      unipile_response: response.data,
      restart_attempted_at: new Date()
    });

  } catch (err) {
    console.error('Error restarting account:', err);
    
    // If restart fails, still update database with error
    try {
      const dbResult = await getLinkedInAccountStatus(req.params.userId);
      if (dbResult.success && dbResult.account_id) {
        await disconnectLinkedInAccount(
          req.params.userId,
          `Restart failed: ${err.response?.data?.error || err.message}`
        );
      }
    } catch (dbErr) {
      console.error('Error updating database after restart failure:', dbErr);
    }

    res.status(500).json({
      success: false,
      error: 'Failed to restart account',
      unipile_error: err.response?.data?.error || err.message,
      account_id: err.config?.url?.split('/').pop() || 'unknown'
    });
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