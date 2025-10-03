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

    // Use FormData for consistency
    const form = new FormData();
    
    form.append('provider', 'LINKEDIN');
    form.append('access_token', access_token);
    form.append('user_agent', user_agent);

    const response = await axios.post(`${getBaseUrl()}/accounts`, form, {
      headers: {
        'X-API-KEY': process.env.UNIPILE_API_KEY,
        ...form.getHeaders()
      }
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
      // Use metadata to pass custom data
      metadata: {
        user_id: user_id
      }
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
    const { status, account_id, name, provider, error, user_id, metadata } = req.body;
    
    // Also check for user_id in query parameters (from notify_url) and metadata
    const userIdFromQuery = req.query.user_id;
    const userIdFromMetadata = metadata?.user_id;
    const finalUserId = user_id || userIdFromQuery || userIdFromMetadata;

    console.log('Unipile webhook received:', {
      status,
      account_id,
      name,
      provider,
      user_id: finalUserId,
      user_id_from_body: user_id,
      user_id_from_query: userIdFromQuery,
      user_id_from_metadata: userIdFromMetadata,
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
// router.get('/api/unipile/chats', async (req, res) => {
//   try {
//     const { account_id, limit = 250, cursor } = req.query;

//     if (!account_id) {
//       return res.status(400).json({
//         success: false,
//         error: 'account_id is required'
//       });
//     }

//     const params = new URLSearchParams();
//     params.append('account_id', account_id);
//     params.append('limit', limit);
//     if (cursor) params.append('cursor', cursor);

//     const response = await axios.get(`${getBaseUrl()}/chats?${params}`, {
//       headers: getHeaders()
//     });

//     res.json({
//       success: true,
//       data: response.data
//     });
//   } catch (err) {
//     handleError(err, res);
//   }
// });

// Get all chats for a userId
router.get('/api/unipile/user/:userId/chats', async (req, res) => {
  try {
    const { userId } = req.params;
    const dbResult = await getLinkedInAccountStatus(userId);

    if (!dbResult.success || !dbResult.account_id) {
      return res.status(404).json({ success: false, error: 'No LinkedIn account found' });
    }

    const response = await axios.get(
      `${getBaseUrl()}/chats?account_id=${dbResult.account_id}&limit=50`,
      { headers: getHeaders() }
    );

    res.json({
      success: true,
      data: response.data,
      account_id: dbResult.account_id
    });
  } catch (err) {
    handleError(err, res);
  }
});

// Get messages for a userId + chatId
router.get('/api/unipile/user/:userId/chats/:chatId/messages', async (req, res) => {
  try {
    const { userId, chatId } = req.params;
    const { limit = 50, cursor } = req.query;

    const dbResult = await getLinkedInAccountStatus(userId);
    if (!dbResult.success || !dbResult.account_id) {
      return res.status(404).json({ success: false, error: 'No LinkedIn account found' });
    }

    const params = new URLSearchParams();
    params.append('account_id', dbResult.account_id);
    params.append('limit', limit);
    if (cursor) params.append('cursor', cursor);

    const response = await axios.get(
      `${getBaseUrl()}/chats/${chatId}/messages?${params}`,
      { headers: getHeaders() }
    );

    res.json({
      success: true,
      data: response.data,
      account_id: dbResult.account_id,
      chat_id: chatId
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



// ==================== LINKEDIN MESSAGING ====================

// Send LinkedIn message (creates chat if doesn't exist)
router.post('/api/unipile/linkedin/message', async (req, res) => {
  try {
    const {
      account_id,
      user_id, // Add this to lookup account_id
      profile_url,
      profile_identifier,
      message,
      subject,
      use_inmail = false,
      attachments // Support attachments
    } = req.body;

    // Get account_id from user_id if not provided
    let finalAccountId = account_id;
    if (!finalAccountId && user_id) {
      const dbResult = await getLinkedInAccountStatus(user_id);
      if (dbResult.success && dbResult.account_id) {
        finalAccountId = dbResult.account_id;
      }
    }

    // Validation
    if (!finalAccountId) {
      return res.status(400).json({
        success: false,
        error: 'account_id or user_id is required'
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
      // Handle various LinkedIn URL formats
      const patterns = [
        /linkedin\.com\/in\/([^\/\?#]+)/,           // Standard profile
        /linkedin\.com\/company\/([^\/\?#]+)/,      // Company page
        /linkedin\.com\/sales\/people\/([^\/\?#]+)/, // Sales Navigator
      ];
      
      let match = null;
      for (const pattern of patterns) {
        match = profile_url.match(pattern);
        if (match) {
          recipientId = match[1];
          break;
        }
      }
      
      if (!match) {
        return res.status(400).json({
          success: false,
          error: 'Invalid LinkedIn profile URL format. Expected: https://linkedin.com/in/username or https://linkedin.com/company/companyname'
        });
      }
    }

    // Build FormData payload
    const form = new FormData();
    
    form.append('account_id', finalAccountId);
    form.append('attendees_ids[]', recipientId);
    form.append('text', message);
    
    if (subject) {
      form.append('subject', subject);
    }
    
    if (use_inmail) {
      form.append('linkedin[inmail]', 'true');
    }
    
    // Handle attachments if provided
    if (attachments && Array.isArray(attachments)) {
      attachments.forEach(attachment => {
        if (attachment.path) {
          form.append('attachments', fs.createReadStream(attachment.path));
        }
      });
    }

    // Send message (Unipile creates chat if it doesn't exist)
    const response = await axios.post(
      `${getBaseUrl()}/chats`,
      form,
      { 
        headers: {
          'X-API-KEY': process.env.UNIPILE_API_KEY,
          ...form.getHeaders()
        }
      }
    );

    res.json({
      success: true,
      data: response.data,
      message: use_inmail ? 'InMail sent successfully' : 'Message sent successfully',
      chat_id: response.data.chat_id,
      message_id: response.data.message_id,
      recipient_id: recipientId,
      account_id: finalAccountId
    });
  } catch (err) {
    console.error('LinkedIn message error:', {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message
    });
    handleError(err, res);
  }
});

// ==================== ACCOUNT MANAGEMENT ENDPOINTS ====================


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

    // Create new account with Unipile using FormData
    const form = new FormData();
    
    form.append('provider', 'LINKEDIN');
    form.append('access_token', access_token);
    form.append('user_agent', user_agent);

    const response = await axios.post(`${getBaseUrl()}/accounts`, form, {
      headers: {
        'X-API-KEY': process.env.UNIPILE_API_KEY,
        ...form.getHeaders()
      }
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

// Get LinkedIn account details by account_id (Pure Unipile API)
router.get('/api/unipile/account/:accountId/details', async (req, res) => {
  try {
    const { accountId } = req.params;
    
    if (!accountId) {
      return res.status(400).json({
        success: false,
        error: 'account_id is required'
      });
    }

    // Fetch account details from Unipile only
    const response = await axios.get(
      `${getBaseUrl()}/accounts/${accountId}`,
      { headers: getHeaders() }
    );

    const unipileAccount = response.data;
    
    // Return pure Unipile response with minimal processing
    res.json({
      success: true,
      data: {
        account_id: unipileAccount.id,
        provider: unipileAccount.provider || unipileAccount.type,
        status: unipileAccount.status,
        username: unipileAccount.username,
        name: unipileAccount.name,
        created_at: unipileAccount.created_at,
        last_sync: unipileAccount.last_sync,
        profile: unipileAccount.profile,
        connection_params: unipileAccount.connection_params,
        sources: unipileAccount.sources,
        groups: unipileAccount.groups,
        object: unipileAccount.object,
        fetched_at: new Date(),
        source: 'unipile_api'
      }
    });

  } catch (err) {
    console.error('Error getting account details:', err);
    
    res.status(500).json({
      success: false,
      error: 'Failed to get account details',
      unipile_error: err.response?.data?.error || err.message,
      account_id: accountId
    });
  }
});



// ==================== LINKEDIN CONNECTION INVITE ====================

// Send LinkedIn connection request
router.post('/api/unipile/linkedin/invite', async (req, res) => {
  try {
    const {
      account_id,
      user_id,
      profile_url,
      profile_identifier,
      message
    } = req.body;

    // Get account_id from user_id if not provided
    let finalAccountId = account_id;
    if (!finalAccountId && user_id) {
      const dbResult = await getLinkedInAccountStatus(user_id);
      if (dbResult.success && dbResult.account_id) {
        finalAccountId = dbResult.account_id;
      }
    }

    // Validation
    if (!finalAccountId) {
      return res.status(400).json({
        success: false,
        error: 'account_id or user_id is required'
      });
    }

    if (!profile_url && !profile_identifier) {
      return res.status(400).json({
        success: false,
        error: 'Either profile_url or profile_identifier is required'
      });
    }

    // Extract LinkedIn identifier from URL
    let recipientIdentifier = profile_identifier;
    if (profile_url && !profile_identifier) {
      const patterns = [
        /linkedin\.com\/in\/([^\/\?#]+)/,
        /linkedin\.com\/sales\/people\/([^,]+)/,
        /linkedin\.com\/sales\/lead\/([^,]+)/
      ];
      
      let match = null;
      for (const pattern of patterns) {
        match = profile_url.match(pattern);
        if (match) {
          recipientIdentifier = match[1];
          break;
        }
      }
      
      if (!match) {
        return res.status(400).json({
          success: false,
          error: 'Invalid LinkedIn profile URL format. Expected: https://linkedin.com/in/username'
        });
      }
    }

    console.log('Step 1: Fetching user details for:', recipientIdentifier);
    
    // STEP 1: Get user details to obtain provider_id
    const userResponse = await axios.get(
      `${getBaseUrl()}/users/${encodeURIComponent(recipientIdentifier)}?account_id=${finalAccountId}`,
      { headers: getHeaders() }
    );

    if (!userResponse.data || !userResponse.data.provider_id) {
      return res.status(404).json({
        success: false,
        error: 'Could not find LinkedIn user or retrieve provider_id',
        identifier: recipientIdentifier,
        user_response: userResponse.data
      });
    }

    const providerUserId = userResponse.data.provider_id;
    console.log('Step 2: Found provider_id:', providerUserId);

    // STEP 2: Send invitation - Build JSON payload (NOT FormData!)
    const invitePayload = {
      account_id: finalAccountId,
      provider_id: providerUserId // ✅ Correct field name
    };

    // Only add message if provided
    if (message && message.trim()) {
      invitePayload.message = message.trim();
    }

    console.log('Step 3: Sending invitation with payload:', invitePayload);

    // Send as JSON, not FormData
    const inviteResponse = await axios.post(
      `${getBaseUrl()}/users/invite`,
      invitePayload,
      { 
        headers: getHeaders('application/json') // Send as JSON
      }
    );

    console.log('Step 4: Invitation sent successfully');

    res.json({
      success: true,
      data: inviteResponse.data,
      message: 'Connection request sent successfully',
      recipient: {
        identifier: recipientIdentifier,
        provider_id: providerUserId,
        name: userResponse.data.name || null,
        headline: userResponse.data.headline || null,
        profile_url: userResponse.data.profile_url || profile_url
      },
      account_id: finalAccountId,
      invitation_sent_at: new Date()
    });

  } catch (err) {
    console.error('LinkedIn invitation error:', {
      status: err.response?.status,
      statusText: err.response?.statusText,
      error: err.response?.data,
      message: err.message,
      url: err.config?.url
    });

    // Handle specific error cases
    if (err.response?.status === 404) {
      return res.status(404).json({
        success: false,
        error: 'LinkedIn user not found',
        details: err.response?.data?.detail || 'The profile identifier could not be found',
        identifier: req.body.profile_identifier || req.body.profile_url
      });
    }

    if (err.response?.status === 422) {
      const errorType = err.response?.data?.type;
      
      if (errorType === 'errors/already_invited_recently') {
        return res.status(422).json({
          success: false,
          error: 'Already sent invitation recently',
          details: 'You have already sent a connection request to this user recently'
        });
      }
      
      if (errorType === 'errors/cannot_invite_attendee') {
        return res.status(422).json({
          success: false,
          error: 'Cannot send invitation',
          details: 'You are already connected to this user or the invitation cannot be sent'
        });
      }

      if (errorType === 'errors/limit_exceeded') {
        return res.status(422).json({
          success: false,
          error: 'Invitation limit exceeded',
          details: 'LinkedIn weekly invitation limit reached'
        });
      }
    }

    if (err.response?.status === 429) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        details: 'Too many requests. Please try again later.'
      });
    }

    if (err.response?.status === 400) {
      return res.status(400).json({
        success: false,
        error: 'Bad request',
        details: err.response?.data?.detail || err.response?.data?.title || 'Invalid parameters',
        unipile_error: err.response?.data
      });
    }

    handleError(err, res);
  }
});


// ==================== CHECK CONNECTION STATUS ====================

// Check if a specific user is in your network
router.get('/api/unipile/linkedin/connection-status/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    const { account_id, user_id } = req.query;

    // Get account_id from user_id if not provided
    let finalAccountId = account_id;
    if (!finalAccountId && user_id) {
      const dbResult = await getLinkedInAccountStatus(user_id);
      if (dbResult.success && dbResult.account_id) {
        finalAccountId = dbResult.account_id;
      }
    }

    if (!finalAccountId) {
      return res.status(400).json({
        success: false,
        error: 'account_id or user_id is required'
      });
    }

    // Get user details first
    const userResponse = await axios.get(
      `${getBaseUrl()}/users/${encodeURIComponent(identifier)}?account_id=${finalAccountId}`,
      { headers: getHeaders() }
    );

    if (!userResponse.data || !userResponse.data.provider_id) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        identifier: identifier
      });
    }

    const providerUserId = userResponse.data.provider_id;

    let connectionStatus = 'not_connected';
    let connectionData = null;
    let invitationData = null;

    // Check existing connections
    try {
      const connectionsResponse = await axios.get(
        `${getBaseUrl()}/connections?account_id=${finalAccountId}&limit=1000`,
        { headers: getHeaders() }
      );

      const existingConnection = connectionsResponse.data.items?.find(
        connection => connection.provider_id === providerUserId
      );

      if (existingConnection) {
        connectionStatus = 'connected';
        connectionData = existingConnection;
      }
    } catch (connectionsError) {
      console.warn('Could not fetch connections:', connectionsError.message);
    }

    // Check pending invitations if not connected
    if (connectionStatus === 'not_connected') {
      try {
        const invitationsResponse = await axios.get(
          `${getBaseUrl()}/users/invitations/sent?account_id=${finalAccountId}`,
          { headers: getHeaders() }
        );

        const pendingInvitation = invitationsResponse.data.items?.find(
          invitation => invitation.provider_id === providerUserId
        );

        if (pendingInvitation) {
          connectionStatus = 'invitation_pending';
          invitationData = pendingInvitation;
        }
      } catch (invitationsError) {
        console.warn('Could not fetch invitations:', invitationsError.message);
      }
    }

    res.json({
      success: true,
      connection_status: connectionStatus,
      user: {
        identifier: identifier,
        provider_id: providerUserId,
        name: userResponse.data.name || null,
        headline: userResponse.data.headline || null,
        profile_url: userResponse.data.profile_url || null
      },
      connection: connectionData,
      invitation: invitationData,
      checked_at: new Date()
    });

  } catch (err) {
    console.error('Connection status check error:', err.response?.data || err.message);
    
    if (err.response?.status === 404) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        identifier: req.params.identifier
      });
    }
    
    handleError(err, res);
  }
});

// ==================== ENHANCED CONNECTION STATUS WITH INVITATION TRACKING ====================

// Check connection status including invitation acceptance
// router.get('/api/unipile/linkedin/connection-status/:identifier', async (req, res) => {
//   try {
//     const { identifier } = req.params;
//     const { account_id, user_id } = req.query;

//     // Get account_id from user_id if not provided
//     let finalAccountId = account_id;
//     if (!finalAccountId && user_id) {
//       const dbResult = await getLinkedInAccountStatus(user_id);
//       if (dbResult.success && dbResult.account_id) {
//         finalAccountId = dbResult.account_id;
//       }
//     }

//     if (!finalAccountId) {
//       return res.status(400).json({
//         success: false,
//         error: 'account_id or user_id is required'
//       });
//     }

//     // Get user details first
//     const userResponse = await axios.get(
//       `${getBaseUrl()}/users/${encodeURIComponent(identifier)}?account_id=${finalAccountId}`,
//       { headers: getHeaders() }
//     );

//     if (!userResponse.data || !userResponse.data.provider_id) {
//       return res.status(404).json({
//         success: false,
//         error: 'User not found',
//         identifier: identifier
//       });
//     }

//     const providerUserId = userResponse.data.provider_id;

//     let connectionStatus = 'not_connected';
//     let connectionData = null;
//     let invitationData = null;
//     let invitationStatus = null;

//     // Check existing connections (ACCEPTED invitations)
//     try {
//       const connectionsResponse = await axios.get(
//         `${getBaseUrl()}/connections?account_id=${finalAccountId}&limit=1000`,
//         { headers: getHeaders() }
//       );

//       const existingConnection = connectionsResponse.data.items?.find(
//         connection => connection.provider_id === providerUserId
//       );

//       if (existingConnection) {
//         connectionStatus = 'connected';
//         connectionData = existingConnection;
//         invitationStatus = 'accepted'; // If they're in connections, invitation was accepted
//       }
//     } catch (connectionsError) {
//       console.warn('Could not fetch connections:', connectionsError.message);
//     }

//     // Check sent invitations if not connected
//     if (connectionStatus === 'not_connected') {
//       try {
//         const invitationsResponse = await axios.get(
//           `${getBaseUrl()}/users/invitations/sent?account_id=${finalAccountId}`,
//           { headers: getHeaders() }
//         );

//         const pendingInvitation = invitationsResponse.data.items?.find(
//           invitation => invitation.provider_id === providerUserId
//         );

//         if (pendingInvitation) {
//           connectionStatus = 'invitation_pending';
//           invitationData = pendingInvitation;
//           invitationStatus = 'pending';
          
//           // Check if invitation was withdrawn or expired
//           if (pendingInvitation.state === 'WITHDRAWN') {
//             invitationStatus = 'withdrawn';
//             connectionStatus = 'not_connected';
//           } else if (pendingInvitation.state === 'EXPIRED') {
//             invitationStatus = 'expired';
//             connectionStatus = 'not_connected';
//           }
//         }
//       } catch (invitationsError) {
//         console.warn('Could not fetch sent invitations:', invitationsError.message);
//       }
//     }

//     // Check received invitations (if they sent you an invite)
//     if (connectionStatus === 'not_connected') {
//       try {
//         const receivedInvitationsResponse = await axios.get(
//           `${getBaseUrl()}/users/invitations/received?account_id=${finalAccountId}`,
//           { headers: getHeaders() }
//         );

//         const receivedInvitation = receivedInvitationsResponse.data.items?.find(
//           invitation => invitation.provider_id === providerUserId
//         );

//         if (receivedInvitation) {
//           connectionStatus = 'invitation_received';
//           invitationData = receivedInvitation;
//           invitationStatus = 'received';
//         }
//       } catch (receivedInvitationsError) {
//         console.warn('Could not fetch received invitations:', receivedInvitationsError.message);
//       }
//     }

//     res.json({
//       success: true,
//       connection_status: connectionStatus,
//       invitation_status: invitationStatus,
//       user: {
//         identifier: identifier,
//         provider_id: providerUserId,
//         name: userResponse.data.name || null,
//         headline: userResponse.data.headline || null,
//         profile_url: userResponse.data.profile_url || null
//       },
//       connection: connectionData,
//       invitation: invitationData,
//       checked_at: new Date()
//     });

//   } catch (err) {
//     console.error('Connection status check error:', err.response?.data || err.message);
    
//     if (err.response?.status === 404) {
//       return res.status(404).json({
//         success: false,
//         error: 'User not found',
//         identifier: req.params.identifier
//       });
//     }
    
//     handleError(err, res);
//   }
// });

// ==================== GET USER DETAILS (Helper) ====================

// Get LinkedIn user details by identifier
router.get('/api/unipile/linkedin/fetch-profile/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    const { account_id, user_id } = req.query;

    // Get account_id from user_id if not provided
    let finalAccountId = account_id;
    if (!finalAccountId && user_id) {
      const dbResult = await getLinkedInAccountStatus(user_id);
      if (dbResult.success && dbResult.account_id) {
        finalAccountId = dbResult.account_id;
      }
    }

    if (!finalAccountId) {
      return res.status(400).json({
        success: false,
        error: 'account_id or user_id is required'
      });
    }

    // Call Unipile API to get user details
    const response = await axios.get(
      `${getBaseUrl()}/users/${encodeURIComponent(identifier)}?account_id=${finalAccountId}`,
      { headers: getHeaders() }
    );

    res.json({
      success: true,
      data: response.data,
      user: {
        provider_id: response.data.provider_id,
        name: response.data.name,
        headline: response.data.headline,
        profile_url: response.data.profile_url,
        picture: response.data.picture,
        identifier: identifier,
        location: response.data.location,
        industry: response.data.industry,
        summary: response.data.summary,
        experience: response.data.experience,
        education: response.data.education,
        skills: response.data.skills,
        connections_count: response.data.connections_count,
        followers_count: response.data.followers_count
      },
      account_id: finalAccountId,
      fetched_at: new Date()
    });

  } catch (err) {
    console.error('Get user error:', err.response?.data || err.message);
    
    if (err.response?.status === 404) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        identifier: req.params.identifier
      });
    }
    
    handleError(err, res);
  }
});





// Get current user's own LinkedIn profile
router.get('/api/unipile/linkedin/user/me', async (req, res) => {
  try {
    const { account_id, user_id } = req.query;

    // Get account_id from user_id if not provided
    let finalAccountId = account_id;
    if (!finalAccountId && user_id) {
      const dbResult = await getLinkedInAccountStatus(user_id);
      if (dbResult.success && dbResult.account_id) {
        finalAccountId = dbResult.account_id;
      }
    }

    if (!finalAccountId) {
      return res.status(400).json({
        success: false,
        error: 'account_id or user_id is required'
      });
    }

    // Call Unipile API to get current user's profile
    const response = await axios.get(
      `${getBaseUrl()}/users/me?account_id=${finalAccountId}`,
      { headers: getHeaders() }
    );

    res.json({
      success: true,
      data: response.data,
      profile: {
        provider_id: response.data.provider_id,
        name: response.data.name,
        headline: response.data.headline,
        profile_url: response.data.profile_url,
        picture: response.data.picture,
        location: response.data.location,
        industry: response.data.industry,
        summary: response.data.summary,
        experience: response.data.experience,
        education: response.data.education,
        skills: response.data.skills,
        connections_count: response.data.connections_count,
        followers_count: response.data.followers_count,
        premium_features: response.data.premium_features,
        organizations: response.data.organizations,
        contact_info: response.data.contact_info
      },
      account_id: finalAccountId,
      fetched_at: new Date()
    });

  } catch (err) {
    console.error('Get current user profile error:', err.response?.data || err.message);
    
    if (err.response?.status === 404) {
      return res.status(404).json({
        success: false,
        error: 'User profile not found',
        details: 'Unable to fetch current user profile from LinkedIn'
      });
    }
    
    handleError(err, res);
  }
});



// Check connection/invitation status
router.get('/api/unipile/linkedin/status/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    const { user_id } = req.query;

    // Lookup account_id from DB
    const dbResult = await getLinkedInAccountStatus(user_id);
    if (!dbResult.success || !dbResult.account_id) {
      return res.status(404).json({ success: false, error: 'No LinkedIn account found' });
    }

    const accountId = dbResult.account_id;

    // Step 1: Check if already connected
    const userResponse = await axios.get(
      `${getBaseUrl()}/users/${encodeURIComponent(identifier)}?account_id=${accountId}`,
      { headers: getHeaders() }
    );

    if (userResponse.data?.is_relation) {
      return res.json({ success: true, status: 'connected', user: userResponse.data });
    }

    // Step 2: Check pending invitations
    const invitesResponse = await axios.get(
      `${getBaseUrl()}/users/invitations/sent?account_id=${accountId}`,
      { headers: getHeaders() }
    );

    const pending = invitesResponse.data.items?.find(
      (i) => i.user_public_identifier === identifier || i.user_provider_id === identifier
    );

    if (pending) {
      return res.json({ success: true, status: 'pending', invitation: pending });
    }

    // Otherwise not invited yet
    res.json({ success: true, status: 'not_invited' });

  } catch (err) {
    console.error('Error checking LinkedIn status:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: 'Failed to check status' });
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