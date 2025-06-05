const express = require('express');
const axios = require('axios');
const router = express.Router();

// Create an Axios instance preconfigured with your Warmup Inbox base URL + API key
const axiosInstance = axios.create({
  baseURL: process.env.WARMUP_API_BASE_URL || 'https://api.warmupinbox.com',
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.WARMUPINBOX_API_KEY
  }
});

/**
 * 1. Add a new inbox to Warmup Inbox
 *
 *    POST /api/warmup/add-inbox
 *
 *    Body JSON:
 *      {
 *        "email": "sales@testgpt.com",
 *        "password": "CPANEL_MAIL_PASSWORD",
 *        "sender_first": "Sales",
 *        "sender_last": "TestGpt"
 *      }
 *
 *    → Returns the newly created Warmup Inbox object, which includes an "id" field
 *      that you will use for starting/pausing and fetching metrics.
 *
 *    Endpoint hit: POST /v1/inboxes
 *    Documentation: 
 */
router.post('/add-inbox', async (req, res) => {
  const { email, password, sender_first, sender_last } = req.body;

  if (!email || !password || !sender_first || !sender_last) {
    return res.status(400).json({
      status: "-1",
      message: "Missing required fields: email, password, sender_first, sender_last are all required."
    });
  }

  try {
    // Build the payload exactly as Warmup Inbox expects
    const payload = {
      email,                    // e.g. "sales@testgpt.com"
      password,                 // the cPanel‐generated mailbox password
      sender_first,             // e.g. "Sales"
      sender_last,              // e.g. "TestGpt"
      plan: "send_only",        // you can choose "send_only" or "engagement" depending on your plan
      frequency: {
        starting_baseline: 10,
        increase_per_day: 5,
        max_sends_per_day: 100,
        reply_rate: 25
      }
    };

    // POST /v1/inboxes
    const response = await axiosInstance.post('/v1/inboxes', payload);
    // response.data will look like:
    // {
    //   id: "abcdef123456", 
    //   email: "sales@testgpt.com",
    //   smtp: { ... }, 
    //   imap: { ... }, 
    //   status: "pending", 
    //   ...
    // }

    return res.status(200).json({
      status: "1",
      message: "Inbox added to Warmup Inbox successfully.",
      data: response.data
    });
  } catch (error) {
    console.error('Error adding inbox to Warmup:', error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      status: "-1",
      message: error.response?.data?.message || error.message
    });
  }
});

/**
 * 2. Start the warmup process for an inbox
 *
 *    POST /api/warmup/start-inbox
 *
 *    Body or Query JSON:
 *      {
 *        "inboxId": "abcdef123456"
 *      }
 *
 *    → Returns the Warmup Inbox response indicating that warming has begun.
 *
 *    Endpoint hit: POST /v1/inboxes/{id}/start
 *    Documentation: 
 */
router.post('/start-inbox', async (req, res) => {
  const inboxId = req.body.inboxId || req.query.inboxId;
  if (!inboxId) {
    return res.status(400).json({
      status: "-1",
      message: "inboxId is required"
    });
  }

  try {
    // POST /v1/inboxes/{id}/start
    const response = await axiosInstance.post(`/v1/inboxes/${inboxId}/start`);
    return res.status(200).json({
      status: "1",
      message: "Inbox warmup started successfully.",
      data: response.data
    });
  } catch (error) {
    console.error('Error starting inbox warmup:', error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      status: "-1",
      message: error.response?.data?.message || error.message
    });
  }
});

/**
 * 3. Pause (stop) the warmup process for an inbox
 *
 *    POST /api/warmup/stop-inbox
 *
 *    Body or Query JSON:
 *      {
 *        "inboxId": "abcdef123456"
 *      }
 *
 *    → Returns the Warmup Inbox response confirming the pause.
 *
 *    Endpoint hit: POST /v1/inboxes/{id}/pause
 *    Documentation: 
 */
router.post('/stop-inbox', async (req, res) => {
  const inboxId = req.body.inboxId || req.query.inboxId;
  if (!inboxId) {
    return res.status(400).json({
      status: "-1",
      message: "inboxId is required"
    });
  }

  try {
    // POST /v1/inboxes/{id}/pause
    const response = await axiosInstance.post(`/v1/inboxes/${inboxId}/pause`);
    return res.status(200).json({
      status: "1",
      message: "Inbox warmup paused successfully.",
      data: response.data
    });
  } catch (error) {
    console.error('Error pausing inbox warmup:', error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      status: "-1",
      message: error.response?.data?.message || error.message
    });
  }
});

/**
 * 4. Fetch warmup statistics for an inbox
 *
 *    GET /api/warmup/inbox-metrics/:inboxId
 *
 *    Example request:
 *      GET /api/warmup/inbox-metrics/abcdef123456
 *
 *    Query parameters (optional):
 *      - from: UNIX timestamp (in seconds)
 *      - to:   UNIX timestamp (in seconds)
 *
 *    If you omit from/to, the code below defaults to “last 7 days.”  
 *
 *    → Returns JSON shaped like:
 *      {
 *        metrics: {
 *          sent: 123,
 *          received: 120,
 *          replied: 45,
 *          reputation: {
 *            score: 95,
 *            category: "good"
 *          },
 *          ...
 *        },
 *        dateRange: { from: "...", to: "..." }
 *      }
 *
 *    Endpoint hit: GET /v1/inboxes/{id}/metrics?from={}&to={}
 *    Documentation: 
 */
router.get('/inbox-metrics/:inboxId', async (req, res) => {
  const inboxId = req.params.inboxId || req.query.inboxId;
  if (!inboxId) {
    return res.status(400).json({
      status: "-1",
      message: "inboxId is required"
    });
  }

  // If the client passed ?from=...&to=..., use those; otherwise default to last 7 days
  let { from, to } = req.query;
  const nowInSecs = Math.floor(Date.now() / 1000);

  if (!from || !to) {
    to = nowInSecs;
    from = nowInSecs - 7 * 24 * 60 * 60; // 7 days ago
  }

  try {
    // GET /v1/inboxes/{id}/metrics?from={from}&to={to}
    const response = await axiosInstance.get(`/v1/inboxes/${inboxId}/metrics`, {
      params: { from, to }
    });

    return res.status(200).json({
      status: "1",
      message: "Fetched warmup metrics successfully.",
      data: {
        metrics: response.data,
        dateRange: {
          from: new Date(parseInt(from, 10) * 1000).toISOString(),
          to: new Date(parseInt(to, 10) * 1000).toISOString()
        }
      }
    });
  } catch (error) {
    console.error('Error fetching warmup metrics:', error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      status: "-1",
      message: error.response?.data?.message || error.message
    });
  }
});

module.exports = router;
