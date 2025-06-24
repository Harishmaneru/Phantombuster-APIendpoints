const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const router = express.Router();

// Enhanced API key check with multiple sources
const checkApiKey = (req, res, next) => {
  const API_KEY = req.headers['x-api-key'] ||
    req.query.api_key ||
    process.env.UNIPILE_API_KEY;

  if (!API_KEY) {
    return res.status(401).json({
      success: false,
      error: 'API key required. Provide via X-API-KEY header or api_key query parameter'
    });
  }

  req.apiKey = API_KEY;
  next();
};

// Build target URL with validation
const buildBaseUrl = (subdomain, port) => {
  if (!subdomain || !port) {
    throw new Error('Subdomain and port are required');
  }
  return `https://${subdomain}.unipile.com:${port}/api/v1`;
};

// Unified error handler
const handleError = (err, res) => {
  console.error('API Error:', {
    status: err.response?.status,
    message: err.message,
    url: err.config?.url
  });

  const status = err.response?.status || 500;
  const message = err.response?.data?.error || err.message || 'Internal server error';

  res.status(status).json({
    success: false,
    error: message
  });
};

// 1.____________________ Fetch Accounts _____________________
router.get('/:subdomain/:port/accounts', checkApiKey, async (req, res) => {
  try {
    const { subdomain, port } = req.params;
    const BASE_URL = buildBaseUrl(subdomain, port);

    const response = await axios.get(`${BASE_URL}/accounts`, {
      headers: {
        'X-API-KEY': req.apiKey,
        'Accept': 'application/json'
      }
    });

    res.json({
      success: true,
      data: response.data
    });
  } catch (err) {
    handleError(err, res);
  }
});

// 2.____________________ List Chats _____________________
router.get('/:subdomain/:port/chats', checkApiKey, async (req, res) => {
  try {
    const { subdomain, port } = req.params;
    const { account_id, limit = 50, cursor } = req.query;
    const BASE_URL = buildBaseUrl(subdomain, port);

    const params = new URLSearchParams();
    if (account_id) params.append('account_id', account_id);
    if (limit) params.append('limit', limit);
    if (cursor) params.append('cursor', cursor);

    const response = await axios.get(`${BASE_URL}/chats?${params}`, {
      headers: {
        'X-API-KEY': req.apiKey,
        'Accept': 'application/json'
      }
    });

    res.json({
      success: true,
      data: response.data
    });
  } catch (err) {
    handleError(err, res);
  }
});

// 3.____________________ Get Chat Messages _____________________
router.get('/:subdomain/:port/chats/:chatId/messages', checkApiKey, async (req, res) => {
  try {
    const { subdomain, port, chatId } = req.params;
    const { account_id, limit = 100, cursor } = req.query;
    const BASE_URL = buildBaseUrl(subdomain, port);

    const params = new URLSearchParams();
    if (account_id) params.append('account_id', account_id);
    if (limit) params.append('limit', limit);
    if (cursor) params.append('cursor', cursor);

    const response = await axios.get(
      `${BASE_URL}/chats/${chatId}/messages?${params}`,
      { headers: { 'X-API-KEY': req.apiKey, 'Accept': 'application/json' } }
    );

    res.json({
      success: true,
      data: response.data
    });
  } catch (err) {
    handleError(err, res);
  }
});

// 4.____________________ Send Message (with file handling) _____________________
router.post('/:subdomain/:port/chats/:chatId/messages', checkApiKey, async (req, res) => {
  try {
    const { subdomain, port, chatId } = req.params;
    const BASE_URL = buildBaseUrl(subdomain, port);
    const form = new FormData();

    // Handle text and files
    if (req.body.text) form.append('text', req.body.text);

    // Handle media attachments
    ['voice_message', 'video_message', 'attachments'].forEach(field => {
      const files = req.files?.[field];
      if (files) {
        Array.isArray(files)
          ? files.forEach(f => form.append(field, fs.createReadStream(f.path)))
          : form.append(field, fs.createReadStream(files.path));
      }
    });

    const response = await axios.post(
      `${BASE_URL}/chats/${chatId}/messages`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'X-API-KEY': req.apiKey
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );

    res.status(201).json({
      success: true,
      data: response.data
    });
  } catch (err) {
    handleError(err, res);
  }
});

// 5.____________________ Sync Chat _____________________ 
router.get('/:subdomain/:port/chats/:chatId/sync', checkApiKey, async (req, res) => {
  try {
    const { subdomain, port, chatId } = req.params;
    const { account_id, since } = req.query;
    const BASE_URL = buildBaseUrl(subdomain, port);

    const params = new URLSearchParams();
    if (account_id) params.append('account_id', account_id);
    if (since) params.append('since', since);

    const response = await axios.get(
      `${BASE_URL}/chats/${chatId}/sync?${params}`,
      { headers: { 'X-API-KEY': req.apiKey, 'Accept': 'application/json' } }
    );

    res.json({
      success: true,
      data: response.data
    });
  } catch (err) {
    handleError(err, res);
  }
});

// 6.____________________ Get Chat Attendees _____________________
router.get('/:subdomain/:port/chats/:chatId/attendees', checkApiKey, async (req, res) => {
  try {
    const { subdomain, port, chatId } = req.params;
    const BASE_URL = buildBaseUrl(subdomain, port);

    const response = await axios.get(
      `${BASE_URL}/chats/${chatId}/attendees`,
      {
        headers: {
          'X-API-KEY': req.apiKey,
          'Accept': 'application/json'
        }
      }
    );

    res.json({
      success: true,
      data: response.data
    });

  } catch (err) {
    handleError(err, res);
  }
});

module.exports = router;