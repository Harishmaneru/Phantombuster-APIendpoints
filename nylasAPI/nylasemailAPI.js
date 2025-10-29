const express = require('express');
const axios = require('axios');
require('dotenv').config();

const router = express.Router();

const NYLAS_API_KEY = process.env.NYLAS_API_KEY;
const NYLAS_API_BASE_URL = 'https://api.us.nylas.com/v3';

// Middleware to check if API key is configured
const checkApiKey = (req, res, next) => {
  if (!NYLAS_API_KEY) {
    return res.status(500).json({
      success: false,
      message: 'NYLAS_API_KEY is not configured in environment variables',
      data: null
    });
  }
  next();
};

/**
 * Get a list of threads
 * GET /api/nylas/threads/:grantId
 * Query params: limit (optional, default: 5)
 */
router.get('/api/nylas/allthreads/:grantId', checkApiKey, async (req, res) => {
  try {
    const { grantId } = req.params;
    const limit = req.query.limit || 5;

    const url = `${NYLAS_API_BASE_URL}/grants/${grantId}/threads?limit=${limit}`;

    const response = await axios.get(url, {
      headers: {
        'Accept': 'application/json, application/gzip',
        'Authorization': `Bearer ${NYLAS_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    res.json({
      success: true,
      data: response.data,
      message: null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching threads:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Failed to fetch threads',
      data: error.response?.data || null,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get a specific thread by ID
 * GET /api/nylas/threads/:grantId/:threadId
 */
router.get('/api/nylas/specificthread/:grantId/:threadId', checkApiKey, async (req, res) => {
  try {
    const { grantId, threadId } = req.params;

    const url = `${NYLAS_API_BASE_URL}/grants/${grantId}/threads/${threadId}`;

    const response = await axios.get(url, {
      headers: {
        'Accept': 'application/json, application/gzip',
        'Authorization': `Bearer ${NYLAS_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    res.json({
      success: true,
      data: response.data,
      message: null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching thread:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Failed to fetch thread',
      data: error.response?.data || null,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;

