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

/*_________________________GET ALL THREADS_________________________*/

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

/*_________________________GET SPECIFIC THREAD BY ID_________________________*/

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


/*_________________________Calendar API's_________________________*/

/**
 * Get available calendars
 * GET /api/nylas/calendars/:grantId
 * Query params: limit (optional, default: 5)
 */
router.get('/api/nylas/calendars/:grantId', checkApiKey, async (req, res) => {
  try {
    const { grantId } = req.params;
    const limit = req.query.limit || 5;

    const url = `${NYLAS_API_BASE_URL}/grants/${grantId}/calendars?limit=${limit}`;

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
    console.error('Error fetching calendars:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Failed to fetch calendars',
      data: error.response?.data || null,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get a specific calendar by ID
 * GET /api/nylas/specificcalendar/:grantId/:calendarId
 */
router.get('/api/nylas/specificcalendar/:grantId/:calendarId', checkApiKey, async (req, res) => {
  try {
    const { grantId, calendarId } = req.params;

    const url = `${NYLAS_API_BASE_URL}/grants/${grantId}/calendars/${calendarId}`;

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
    console.error('Error fetching calendar:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Failed to fetch calendar',
      data: error.response?.data || null,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Create a calendar
 * POST /api/nylas/createcalendar/:grantId
 * Body: { name, description, location, timezone }
 */
router.post('/api/nylas/createcalendar/:grantId', checkApiKey, async (req, res) => {
  try {
    const { grantId } = req.params;
    const { name, description, location, timezone } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Calendar name is required',
        data: null,
        timestamp: new Date().toISOString()
      });
    }

    const url = `${NYLAS_API_BASE_URL}/grants/${grantId}/calendars`;

    const response = await axios.post(url, {
      name,
      description,
      location,
      timezone
    }, {
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
    console.error('Error creating calendar:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Failed to create calendar',
      data: error.response?.data || null,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Update a calendar
 * PUT /api/nylas/updatecalendar/:grantId/:calendarId
 * Body: { name, description, location, timezone }
 */
router.put('/api/nylas/updatecalendar/:grantId/:calendarId', checkApiKey, async (req, res) => {
  try {
    const { grantId, calendarId } = req.params;
    const { name, description, location, timezone } = req.body;

    const url = `${NYLAS_API_BASE_URL}/grants/${grantId}/calendars/${calendarId}`;

    const response = await axios.put(url, {
      name,
      description,
      location,
      timezone
    }, {
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
    console.error('Error updating calendar:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Failed to update calendar',
      data: error.response?.data || null,
      timestamp: new Date().toISOString()
    });
  }
});


module.exports = router;

