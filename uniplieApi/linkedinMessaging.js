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



// Get all chats/conversations for a userId
router.get('/api/unipile/user/:userId/allchats', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, cursor, search } = req.query;

    const dbResult = await getLinkedInAccountStatus(userId);

    if (!dbResult.success || !dbResult.account_id) {
      return res.status(404).json({ success: false, error: 'No LinkedIn account found' });
    }

    const params = new URLSearchParams();
    params.append('account_id', dbResult.account_id);
    params.append('limit', limit);
    if (cursor) params.append('cursor', cursor);
    if (search) params.append('search', search);

    const response = await axios.get(
      `${getBaseUrl()}/chats?${params}`,
      { headers: getHeaders() }
    );

    res.json({
      success: true,
      data: response.data,
      account_id: dbResult.account_id,
      user_id: userId
    });
  } catch (err) {
    handleError(err, res);
  }
});



// Get a specific conversation/chat by ID for a user
router.get('/api/unipile/user/:userId/conversations/:chatId', async (req, res) => {
  try {
    const { userId, chatId } = req.params;

    const dbResult = await getLinkedInAccountStatus(userId);
    if (!dbResult.success || !dbResult.account_id) {
      return res.status(404).json({ success: false, error: 'No LinkedIn account found' });
    }

    const params = new URLSearchParams();
    params.append('account_id', dbResult.account_id);

    const response = await axios.get(
      `${getBaseUrl()}/chats/${chatId}?${params}`,
      { headers: getHeaders() }
    );

    res.json({
      success: true,
      data: response.data,
      account_id: dbResult.account_id,
      chat_id: chatId,
      user_id: userId
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
      chat_id: chatId,
      user_id: userId
    });
  } catch (err) {
    handleError(err, res);
  }
});



// Get conversation attendees (participants) for a chat
router.get('/api/unipile/user/:userId/conversations/:chatId/attendees', async (req, res) => {
  try {
    const { userId, chatId } = req.params;

    const dbResult = await getLinkedInAccountStatus(userId);
    if (!dbResult.success || !dbResult.account_id) {
      return res.status(404).json({ success: false, error: 'No LinkedIn account found' });
    }

    const params = new URLSearchParams();
    params.append('account_id', dbResult.account_id);

    const response = await axios.get(
      `${getBaseUrl()}/chats/${chatId}/attendees?${params}`,
      { headers: getHeaders() }
    );

    res.json({
      success: true,
      data: response.data,
      account_id: dbResult.account_id,
      chat_id: chatId,
      user_id: userId
    });
  } catch (err) {
    handleError(err, res);
  }
});

// Sync chat (get new messages since timestamp) - with user_id in URL
router.get('/api/unipile/user/:userId/conversations/:chatId/sync', async (req, res) => {
  try {
    const { userId, chatId } = req.params;
    const { since } = req.query;

    const dbResult = await getLinkedInAccountStatus(userId);
    if (!dbResult.success || !dbResult.account_id) {
      return res.status(404).json({ success: false, error: 'No LinkedIn account found' });
    }

    const params = new URLSearchParams();
    params.append('account_id', dbResult.account_id);
    if (since) params.append('since', since);

    const response = await axios.get(
      `${getBaseUrl()}/chats/${chatId}/sync?${params}`,
      { headers: getHeaders() }
    );

    res.json({
      success: true,
      data: response.data,
      account_id: dbResult.account_id,
      chat_id: chatId,
      user_id: userId
    });
  } catch (err) {
    handleError(err, res);
  }
});

// Sync chat (get new messages since timestamp) - legacy endpoint with account_id in query
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

// Send LinkedIn message (user_id in URL path)
router.post('/api/unipile/user/:userId/linkedin/message', async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      profile_url,
      profile_identifier,
      message,
      subject,
      use_inmail = false,
      attachments
    } = req.body;

    // Get account_id from user_id
    const dbResult = await getLinkedInAccountStatus(userId);
    if (!dbResult.success || !dbResult.account_id) {
      return res.status(404).json({
        success: false,
        error: 'No LinkedIn account found for this user'
      });
    }

    const finalAccountId = dbResult.account_id;

    // Validation
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
    let recipientIdentifier = profile_identifier;
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
          recipientIdentifier = match[1];
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

    // Try to get provider_id from Unipile API (more reliable than public identifier)
    let recipientId = recipientIdentifier;
    try {
      const userResponse = await axios.get(
        `${getBaseUrl()}/users/${encodeURIComponent(recipientIdentifier)}?account_id=${finalAccountId}`,
        { headers: getHeaders() }
      );

      // Use provider_id if available, otherwise fall back to identifier
      if (userResponse.data?.provider_id) {
        recipientId = userResponse.data.provider_id;
        console.log(`Found provider_id for ${recipientIdentifier}: ${recipientId}`);
      } else {
        console.log(`No provider_id found, using identifier: ${recipientIdentifier}`);
      }
    } catch (userError) {
      console.warn(`Could not fetch user details for ${recipientIdentifier}, using identifier directly:`, userError.message);
      // Continue with identifier if user lookup fails - Unipile might accept it
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
      account_id: finalAccountId,
      user_id: userId
    });
  } catch (err) {
    console.error('LinkedIn message error:', {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message,
      url: err.config?.url,
      recipient_id: recipientId,
      account_id: finalAccountId,
      user_id: userId
    });

    // Provide detailed error information for 422 errors from Unipile
    if (err.response?.status === 422) {
      const unipileError = err.response?.data;
      return res.status(422).json({
        success: false,
        error: unipileError?.error || unipileError?.message || 'Unprocessable Entity - Unable to send message',
        details: unipileError?.detail || unipileError?.details || unipileError?.title,
        type: unipileError?.type,
        recipient_id: recipientId,
        account_id: finalAccountId,
        user_id: userId,
        unipile_response: unipileError,
        possible_reasons: [
          'Recipient profile not found or invalid',
          'Account not properly connected to LinkedIn',
          'Rate limit exceeded',
          'Recipient is not a connection (may need InMail)',
          'LinkedIn account has restrictions'
        ]
      });
    }

    handleError(err, res);
  }
});

// Get full conversation details with messages and attendee profiles
router.get('/api/unipile/user/:userId/chats/:chatId/full-messages', async (req, res) => {
  try {
    const { userId, chatId } = req.params;
    const { limit = 100, cursor } = req.query;

    const dbResult = await getLinkedInAccountStatus(userId);
    if (!dbResult.success || !dbResult.account_id) {
      return res.status(404).json({ success: false, error: 'No LinkedIn account found' });
    }

    const accountId = dbResult.account_id;

    // Get current user's profile
    const currentUserResponse = await axios.get(
      `${getBaseUrl()}/accounts/${accountId}`,
      { headers: getHeaders() }
    );
    const currentUserProviderId = currentUserResponse.data?.provider_id;

    const params = new URLSearchParams();
    params.append('account_id', accountId);
    params.append('limit', limit);
    if (cursor) params.append('cursor', cursor);

    const [messagesResponse, chatResponse, attendeesResponse] = await Promise.all([
      axios.get(`${getBaseUrl()}/chats/${chatId}/messages?${params}`, { headers: getHeaders() }),
      axios.get(`${getBaseUrl()}/chats/${chatId}?account_id=${accountId}`, { headers: getHeaders() }),
      axios.get(`${getBaseUrl()}/chats/${chatId}/attendees?account_id=${accountId}`, { headers: getHeaders() })
    ]);

    const messages = messagesResponse.data?.messages || messagesResponse.data?.items || [];
    const chatInfo = chatResponse.data || {};
    const attendeesData = attendeesResponse.data?.attendees || attendeesResponse.data?.items || attendeesResponse.data || [];
    const attendees = Array.isArray(attendeesData) ? attendeesData : [];

    // Remove duplicate attendees based on provider_id
    const uniqueAttendees = attendees.filter((attendee, index, self) =>
      index === self.findIndex(a => a.provider_id === attendee.provider_id)
    );

    // Find current user's attendee profile
    const currentUserAttendee = uniqueAttendees.find(attendee =>
      attendee.provider_id === currentUserProviderId || attendee.is_self === 1
    );

    // Find other attendees (excluding current user)
    const otherAttendees = uniqueAttendees.filter(attendee =>
      attendee.provider_id !== currentUserProviderId && attendee.is_self !== 1
    );

    // Process messages with clean structure
    const processedMessages = messages.map(msg => {
      const isMyMessage = msg.is_sender === 1;
      const senderAttendee = uniqueAttendees.find(attendee =>
        attendee.provider_id === msg.sender_id
      );

      return {
        id: msg.id,
        text: msg.text,
        timestamp: msg.timestamp,
        is_my_message: isMyMessage,
        is_sender: msg.is_sender,
        sender_id: msg.sender_id,
        message_type: msg.message_type,
        delivered: msg.delivered,
        seen: msg.seen,
        reactions: msg.reactions,
        attachments: msg.attachments
        // Removed duplicate profile fields
      };
    }).reverse(); // Reverse to show oldest first (like real chat)

    const myMessages = processedMessages.filter(msg => msg.is_my_message);
    const attendeeMessages = processedMessages.filter(msg => !msg.is_my_message);

    // Clean, polished response
    res.json({
      success: true,
      data: {
        // Clean message lists without duplicate profiles
        messages: processedMessages,
        my_messages: myMessages,
        attendee_messages: attendeeMessages,

        // Single source of truth for profiles
        participants: {
          current_user: currentUserAttendee ? {
            id: currentUserAttendee.id,
            name: currentUserAttendee.name,
            picture_url: currentUserAttendee.picture_url,
            profile_url: currentUserAttendee.profile_url,
            occupation: currentUserAttendee.specifics?.occupation
          } : null,

          other_attendees: otherAttendees.map(attendee => ({
            id: attendee.id,
            name: attendee.name,
            picture_url: attendee.picture_url,
            profile_url: attendee.profile_url,
            occupation: attendee.specifics?.occupation,
            network_distance: attendee.specifics?.network_distance
          }))
        },

        // Simplified chat info
        chat_info: {
          id: chatInfo.id,
          unread_count: chatInfo.unread_count,
          last_message: chatInfo.lastMessage ? {
            text: chatInfo.lastMessage.text,
            timestamp: chatInfo.lastMessage.timestamp,
            is_my_message: chatInfo.lastMessage.is_sender === 1
          } : null
        },

        pagination: messagesResponse.data?.pagination || {
          cursor: messagesResponse.data?.cursor || null,
          has_more: messagesResponse.data?.has_more || false,
          limit: parseInt(limit),
          total: processedMessages.length
        }
      },
      meta: {
        account_id: accountId,
        chat_id: chatId,
        user_id: userId,
        total_messages: processedMessages.length,
        my_message_count: myMessages.length,
        attendee_message_count: attendeeMessages.length,
        participant_count: uniqueAttendees.length
      }
    });
  } catch (err) {
    console.error('Polished messages API error:', err.message);
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
// router.get('/api/unipile/linkedin/fetch-profile/:identifier', async (req, res) => {
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

//     // Call Unipile API to get user details
//     const response = await axios.get(
//       `${getBaseUrl()}/users/${encodeURIComponent(identifier)}?account_id=${finalAccountId}`,
//       { headers: getHeaders() }
//     );

//     res.json({
//       success: true,
//       data: response.data,
//       user: {
//         provider_id: response.data.provider_id,
//         name: response.data.name,
//         headline: response.data.headline,
//         profile_url: response.data.profile_url,
//         picture: response.data.picture,
//         identifier: identifier,
//         location: response.data.location,
//         industry: response.data.industry,
//         summary: response.data.summary,
//         experience: response.data.experience,
//         education: response.data.education,
//         skills: response.data.skills,
//         connections_count: response.data.connections_count,
//         followers_count: response.data.followers_count
//       },
//       account_id: finalAccountId,
//       fetched_at: new Date()
//     });

//   } catch (err) {
//     console.error('Get user error:', err.response?.data || err.message);

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

    const userProfile = response.data;
    let chatId = null;
    let hasExistingChat = false;

    // Try to find chat ID using the user's provider_id or public_identifier
    const providerId = userProfile?.provider_id;
    const publicIdentifier = userProfile?.public_identifier || identifier;

    if (providerId || publicIdentifier) {
      try {
        // Fetch chats with higher limit to find existing chats
        const chatsResponse = await axios.get(
          `${getBaseUrl()}/chats?account_id=${finalAccountId}&limit=250`,
          { headers: getHeaders() }
        );

        const chats = chatsResponse.data?.chats || chatsResponse.data?.items || chatsResponse.data || [];
        const chatsArray = Array.isArray(chats) ? chats : [];

        console.log(`Searching through ${chatsArray.length} chats for provider_id: ${providerId} or identifier: ${publicIdentifier}`);

        // First, try to find chat where attendees are included in the response
        let userChat = chatsArray.find(chat => {
          const attendees = chat.attendees || chat.participants || [];
          if (!Array.isArray(attendees)) return false;
          
          return attendees.some(attendee => {
            // Match by provider_id (most reliable)
            if (providerId && (attendee.provider_id === providerId || attendee.id === providerId)) {
              return true;
            }
            // Match by public_identifier as fallback
            if (publicIdentifier && (
              attendee.public_identifier === publicIdentifier ||
              attendee.identifier === publicIdentifier ||
              attendee.username === publicIdentifier
            )) {
              return true;
            }
            return false;
          });
        });

        // If not found in initial response, fetch attendees for each chat
        if (!userChat && chatsArray.length > 0) {
          console.log('Chat not found in initial response, checking attendees for each chat...');
          
          // Check all chats (not just first 20)
          for (const chat of chatsArray) {
            try {
              const currentChatId = chat.id || chat.chat_id || chat.chatId;
              if (!currentChatId) continue;

              const attendeesResponse = await axios.get(
                `${getBaseUrl()}/chats/${currentChatId}/attendees?account_id=${finalAccountId}`,
                { headers: getHeaders() }
              );

              const attendeesData = attendeesResponse.data?.attendees || 
                                   attendeesResponse.data?.items || 
                                   attendeesResponse.data || [];
              const attendees = Array.isArray(attendeesData) ? attendeesData : [];

              // Check for match by provider_id or public_identifier
              const foundAttendee = attendees.find(attendee => {
                // Match by provider_id (most reliable)
                if (providerId && (
                  attendee.provider_id === providerId ||
                  attendee.id === providerId ||
                  attendee.account_id === providerId
                )) {
                  return true;
                }
                // Match by public_identifier as fallback
                if (publicIdentifier && (
                  attendee.public_identifier === publicIdentifier ||
                  attendee.identifier === publicIdentifier ||
                  attendee.username === publicIdentifier ||
                  attendee.profile_url?.includes(publicIdentifier)
                )) {
                  return true;
                }
                return false;
              });

              if (foundAttendee) {
                userChat = chat;
                console.log(`Found matching chat: ${currentChatId} for ${providerId || publicIdentifier}`);
                break;
              }
            } catch (attendeeError) {
              // Continue to next chat if this one fails
              continue;
            }
          }
        }

        // Extract chat ID
        if (userChat) {
          chatId = userChat.id || userChat.chat_id || userChat.chatId || null;
          hasExistingChat = !!chatId;
          console.log(`Chat found: ${chatId} for user ${providerId || publicIdentifier}`);
        } else {
          console.log(`No chat found for user ${providerId || publicIdentifier}`);
        }

      } catch (chatError) {
        console.error('Could not fetch chat ID:', chatError.message);
        console.error('Chat error details:', chatError.response?.data || chatError.message);
        // Continue without chat ID if chat fetch fails
      }
    } else {
      console.log('No provider_id or public_identifier found in user profile, skipping chat lookup');
    }

    res.json({
      success: true,
      data: userProfile,
      user: {
        provider_id: userProfile.provider_id,
        name: userProfile.name,
        headline: userProfile.headline,
        profile_url: userProfile.profile_url,
        picture: userProfile.profile_picture_url,
        identifier: identifier,
        location: userProfile.location,
        industry: userProfile.industry,
        summary: userProfile.summary,
        experience: userProfile.experience,
        education: userProfile.education,
        skills: userProfile.skills,
        connections_count: userProfile.connections_count,
        followers_count: userProfile.follower_count
      },
      chat_info: {
        chat_id: chatId,
        has_existing_chat: hasExistingChat
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
// Check connection/invitation status - FIXED VERSION
router.get('/api/unipile/linkedin/status/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    const { user_id } = req.query;

    // Validate parameters
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id query parameter is required'
      });
    }

    // Lookup account_id from DB
    const dbResult = await getLinkedInAccountStatus(user_id);
    if (!dbResult.success || !dbResult.account_id) {
      return res.status(404).json({
        success: false,
        error: 'No LinkedIn account found for this user'
      });
    }

    const accountId = dbResult.account_id;
    console.log(`🔍 Checking LinkedIn status for: ${identifier}, account: ${accountId}`);

    // STEP 1: Check connections (1st degree)
    try {
      const connectionsResponse = await axios.get(
        `${getBaseUrl()}/connections?account_id=${accountId}&search=${encodeURIComponent(identifier)}`,
        { headers: getHeaders() }
      );

      console.log('🔗 Connections check:', JSON.stringify(connectionsResponse.data, null, 2));

      // Check if user is in connections
      const connectedUser = connectionsResponse.data.items?.find(connection =>
        connection.public_identifier === identifier ||
        connection.provider_id === identifier ||
        connection.profile_url?.includes(identifier)
      );

      if (connectedUser) {
        return res.json({
          success: true,
          status: 'connected',
          user: connectedUser,
          message: 'Already connected on LinkedIn'
        });
      }
    } catch (connectionsError) {
      console.log('No connections found or error:', connectionsError.message);
    }

    // STEP 2: Check pending invitations
    try {
      const invitesResponse = await axios.get(
        `${getBaseUrl()}/users/invitations/sent?account_id=${accountId}`,
        { headers: getHeaders() }
      );

      console.log('📨 Pending invitations:', JSON.stringify(invitesResponse.data, null, 2));

      // Find pending invitation for this user
      const pendingInvite = invitesResponse.data.items?.find(invite =>
        invite.user_public_identifier === identifier ||
        invite.user_provider_id === identifier ||
        invite.user_profile_url?.includes(identifier) ||
        invite.invitation_identifier === identifier
      );

      if (pendingInvite) {
        return res.json({
          success: true,
          status: 'pending',
          invitation: pendingInvite,
          message: 'Invitation already sent and pending'
        });
      }
    } catch (invitesError) {
      console.log('Error checking invitations:', invitesError.message);
    }

    // STEP 3: Check if we can invite (profile exists)
    try {
      const profileResponse = await axios.get(
        `${getBaseUrl()}/users/${encodeURIComponent(identifier)}?account_id=${accountId}`,
        { headers: getHeaders() }
      );

      console.log('👤 Profile found:', JSON.stringify(profileResponse.data, null, 2));

      // If profile exists but not connected and no pending invite
      if (profileResponse.data) {
        return res.json({
          success: true,
          status: 'can_invite',
          user: profileResponse.data,
          message: 'Profile found - can send invitation'
        });
      }
    } catch (profileError) {
      // Profile not found or other error
      console.log('Profile check result:', profileError.response?.status, profileError.message);
    }

    // If we get here, user not found or can't be invited
    res.json({
      success: true,
      status: 'not_found',
      message: 'User not found or cannot be invited'
    });

  } catch (err) {
    console.error('❌ Error checking LinkedIn status:', err.response?.data || err.message);

    res.status(500).json({
      success: false,
      error: 'Failed to check LinkedIn status',
      details: err.message
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