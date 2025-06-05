const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const router = express.Router();

// MongoDB connection
const connectToMongoDB = async () => {
  if (mongoose.connection.readyState === 1) {
    console.log('Warmup API: MongoDB already connected');
    return;
  }
  try {
    await mongoose.connect(process.env.ONEPGR_MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Warmup API: Connected to MongoDB onepgr_apps database');
  } catch (error) {
    console.error('Warmup API: MongoDB connection error:', error);
    throw error;
  }
};

// Schema for storing warmup inbox details
const warmupInboxSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  email: { type: String, required: true },
  inbox_id: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  sender_first: { type: String, required: true },
  sender_last: { type: String, required: true },
  status: { type: String, default: 'created' },
  plan: { type: String, default: 'basic' },
  frequency: {
    starting_baseline: { type: Number, default: 4 },
    increase_per_day: { type: Number, default: 4 },
    max_sends_per_day: { type: Number, default: 20 },
    reply_rate: { type: Number, default: 25 }
  },
  warmup_response: { type: mongoose.Schema.Types.Mixed }, // Store full response from Warmup Inbox
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, {
  collection: 'warmup-inbox'
});

// Create compound index for userId + email for faster queries
warmupInboxSchema.index({ userId: 1, email: 1 });

const WarmupInbox = mongoose.model('WarmupInbox', warmupInboxSchema);

// Create an Axios instance preconfigured with your Warmup Inbox base URL + API key
const axiosInstance = axios.create({
  baseURL: process.env.WARMUP_API_BASE_URL || 'https://api.warmupinbox.com',
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.WARMUPINBOX_API_KEY
  }
});

// Helper function to get inbox_id from database
const getInboxIdFromDB = async (userId, email) => {
  await connectToMongoDB();
  const warmupInbox = await WarmupInbox.findOne({ userId, email });
  if (!warmupInbox) {
    throw new Error(`No warmup inbox found for userId: ${userId} and email: ${email}`);
  }
  return warmupInbox.inbox_id;
};

/**
 * 1. Add a new inbox to Warmup Inbox
 *
 *    POST /api/warmup/add-inbox
 *
 *    Body JSON:
 *      {
 *        "userId": "user123",
 *        "email": "sales@testgpt.com",
 *        "password": "CPANEL_MAIL_PASSWORD",
 *        "sender_first": "Sales",
 *        "sender_last": "TestGpt"
 *      }
 *
 *    → Returns the newly created Warmup Inbox object and stores it in MongoDB
 *
 *    Endpoint hit: POST /v1/inboxes
 *    Documentation: 
 */
router.post('/api/warmup/add-inbox', async (req, res) => {
  const { userId, email, password, sender_first, sender_last } = req.body;

  if (!userId || !email || !password || !sender_first || !sender_last) {
    return res.status(400).json({
      status: "-1",
      message: "Missing required fields: userId, email, password, sender_first, sender_last are all required."
    });
  }

  try {
    await connectToMongoDB();

    // Check if inbox already exists for this user and email
    const existingInbox = await WarmupInbox.findOne({ userId, email });
    if (existingInbox) {
      return res.status(409).json({
        status: "-1",
        message: "Inbox already exists for this userId and email",
        data: {
          inbox_id: existingInbox.inbox_id,
          email: existingInbox.email,
          status: existingInbox.status
        }
      });
    }

    // Build the payload exactly as Warmup Inbox expects
    const payload = {
      email,                    // e.g. "sales@testgpt.com"
      password,                 // the cPanel‐generated mailbox password
      sender_first,             // e.g. "Sales"
      sender_last,              // e.g. "TestGpt"
      plan: "basic",        // you can choose "send_only" or "engagement" depending on your plan
      frequency: {
        starting_baseline: 4,   // ≤ 4 for Basic
        increase_per_day: 4,    // ≤ 4 for Basic
        max_sends_per_day: 20,  // any reasonable number; 25 is OK
        reply_rate: 25
      }
    };

    // POST /v1/inboxes
    const response = await axiosInstance.post('/v1/inboxes', payload);

    // Store the response in MongoDB
    const warmupInboxData = new WarmupInbox({
      userId,
      email,
      inbox_id: response.data.inbox_id,
      password,
      sender_first,
      sender_last,
      status: response.data.code || 'created',
      plan: payload.plan,
      frequency: payload.frequency,
      warmup_response: response.data,
      updated_at: new Date()
    });

    await warmupInboxData.save();

    return res.status(200).json({
      status: "1",
      message: "Inbox added to Warmup Inbox successfully and stored in database.",
      data: {
        ...response.data,
        userId,
        stored_in_db: true
      }
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
 *    Body JSON:
 *      {
 *        "userId": "user123",
 *        "email": "sales@testgpt.com"
 *      }
 *
 *    → Returns the Warmup Inbox response indicating that warming has begun.
 *
 *    Endpoint hit: POST /v1/inboxes/{id}/start
 *    Documentation: 
 */
router.post('/api/warmup/start-inbox', async (req, res) => {
  const { userId, email } = req.body;

  if (!userId || !email) {
    return res.status(400).json({
      status: "-1",
      message: "userId and email are required"
    });
  }

  try {
    // Get inbox_id from database
    const inboxId = await getInboxIdFromDB(userId, email);

    // POST /v1/inboxes/{id}/start
    const response = await axiosInstance.post(`/v1/inboxes/${inboxId}/start`);

    // Update status in database
    await WarmupInbox.findOneAndUpdate(
      { userId, email },
      { status: 'warming', updated_at: new Date() }
    );

    return res.status(200).json({
      status: "1",
      message: "Inbox warmup started successfully.",
      data: {
        ...response.data,
        userId,
        email,
        inbox_id: inboxId
      }
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
 *    Body JSON:
 *      {
 *        "userId": "user123",
 *        "email": "sales@testgpt.com"
 *      }
 *
 *    → Returns the Warmup Inbox response confirming the pause.
 *
 *    Endpoint hit: POST /v1/inboxes/{id}/pause
 *    Documentation: 
 */
router.post('/api/warmup/stop-inbox', async (req, res) => {
  const { userId, email } = req.body;

  if (!userId || !email) {
    return res.status(400).json({
      status: "-1",
      message: "userId and email are required"
    });
  }

  try {
    // Get inbox_id from database
    const inboxId = await getInboxIdFromDB(userId, email);

    // POST /v1/inboxes/{id}/pause
    const response = await axiosInstance.post(`/v1/inboxes/${inboxId}/pause`);

    // Update status in database
    await WarmupInbox.findOneAndUpdate(
      { userId, email },
      { status: 'paused', updated_at: new Date() }
    );

    return res.status(200).json({
      status: "1",
      message: "Inbox warmup paused successfully.",
      data: {
        ...response.data,
        userId,
        email,
        inbox_id: inboxId
      }
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
 *    GET /api/warmup/inbox-metrics/:userId/:email
 *    OR
 *    POST /api/warmup/inbox-metrics
 *
 *    Body JSON (for POST):
 *      {
 *        "userId": "user123",
 *        "email": "sales@testgpt.com",
 *        "from": 1234567890,  // optional UNIX timestamp
 *        "to": 1234567890     // optional UNIX timestamp
 *      }
 *
 *    Query parameters (optional for GET):
 *      - from: UNIX timestamp (in seconds)
 *      - to:   UNIX timestamp (in seconds)
 *
 *    If you omit from/to, the code below defaults to "last 7 days."  
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
router.get('/api/warmup/inbox-metrics/:userId/:email', async (req, res) => {
  const { userId, email } = req.params;

  if (!userId || !email) {
    return res.status(400).json({
      status: "-1",
      message: "userId and email are required"
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
    // Get inbox_id from database
    const inboxId = await getInboxIdFromDB(userId, email);

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
        },
        userId,
        email,
        inbox_id: inboxId
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

// POST version of inbox-metrics for easier API consumption
router.post('/api/warmup/inbox-metrics', async (req, res) => {
  const { userId, email, from, to } = req.body;

  if (!userId || !email) {
    return res.status(400).json({
      status: "-1",
      message: "userId and email are required"
    });
  }

  // If the client passed from/to, use those; otherwise default to last 7 days
  const nowInSecs = Math.floor(Date.now() / 1000);
  const fromTime = from || (nowInSecs - 7 * 24 * 60 * 60);
  const toTime = to || nowInSecs;

  try {
    // Get inbox_id from database
    const inboxId = await getInboxIdFromDB(userId, email);

    // GET /v1/inboxes/{id}/metrics?from={from}&to={to}
    const response = await axiosInstance.get(`/v1/inboxes/${inboxId}/metrics`, {
      params: { from: fromTime, to: toTime }
    });

    return res.status(200).json({
      status: "1",
      message: "Fetched warmup metrics successfully.",
      data: {
        metrics: response.data,
        dateRange: {
          from: new Date(parseInt(fromTime, 10) * 1000).toISOString(),
          to: new Date(parseInt(toTime, 10) * 1000).toISOString()
        },
        userId,
        email,
        inbox_id: inboxId
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

/**
 * 5. Get detailed information for a specific inbox
 *
 *    GET /api/warmup/inbox-details/:userId/:email
 *    OR
 *    POST /api/warmup/inbox-details
 *
 *    Body JSON (for POST):
 *      {
 *        "userId": "user123",
 *        "email": "sales@testgpt.com"
 *      }
 *
 *    → Returns comprehensive inbox information including:
 *      - Basic info (id, status, email, etc.)
 *      - Frequency settings
 *      - Reputation scores
 *      - Schedule configuration
 *      - Health check results
 *      - And more...
 *
 *    Endpoint hit: GET /v1/inboxes/{id}
 *    Documentation: https://docs.warmupinbox.com/
 */

router.get('/api/warmup/inbox-details/:userId/:email', async (req, res) => {
  const { userId, email } = req.params;

  if (!userId || !email) {
    return res.status(400).json({
      status: "-1",
      message: "userId and email are required"
    });
  }

  try {
    // Get inbox_id from database
    const inboxId = await getInboxIdFromDB(userId, email);

    // GET /v1/inboxes/{id}
    const response = await axiosInstance.get(`/v1/inboxes/${inboxId}`);

    return res.status(200).json({
      status: "1",
      message: "Fetched inbox details successfully.",
      data: {
        ...response.data,
        userId,
        email,
        inbox_id: inboxId
      }
    });
  } catch (error) {
    console.error('Error fetching inbox details:', error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      status: "-1",
      message: error.response?.data?.message || error.message
    });
  }
});



/**
 * 6. Delete an inbox from Warmup Inbox and database
 *
 *    DELETE /api/warmup/delete-inbox
 *
 *    Body JSON:
 *      {
 *        "userId": "user123",
 *        "email": "sales@testgpt.com"
 *      }
 *
 *    → Deletes the inbox from Warmup Inbox service and removes from database
 *
 *    Endpoint hit: DELETE /v1/inboxes/{id}
 *    Documentation: https://docs.warmupinbox.com/
 */
router.delete('/api/warmup/delete-inbox', async (req, res) => {
  const { userId, email } = req.body;

  if (!userId || !email) {
    return res.status(400).json({
      status: "-1",
      message: "userId and email are required"
    });
  }

  try {
    // Get inbox_id from database
    const inboxId = await getInboxIdFromDB(userId, email);

    // DELETE /v1/inboxes/{id}
    const response = await axiosInstance.delete(`/v1/inboxes/${inboxId}`);

    // Remove from database
    await WarmupInbox.findOneAndDelete({ userId, email });

    return res.status(200).json({
      status: "1",
      message: "Inbox deleted successfully from Warmup Inbox and database.",
      data: {
        ...response.data,
        userId,
        email,
        inbox_id: inboxId,
        deleted_from_db: true
      }
    });
  } catch (error) {
    console.error('Error deleting inbox:', error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      status: "-1",
      message: error.response?.data?.message || error.message
    });
  }
});

/**
 * 7. List all inboxes for a user
 *
 *    GET /api/warmup/list-inboxes/:userId
 *    OR
 *    POST /api/warmup/list-inboxes
 *
 *    Body JSON (for POST):
 *      {
 *        "userId": "user123"
 *      }
 *
 *    → Returns all warmup inboxes for the specified user
 */
router.get('/api/warmup/list-inboxes/:userId', async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({
      status: "-1",
      message: "userId is required"
    });
  }

  try {
    await connectToMongoDB();

    const inboxes = await WarmupInbox.find({ userId }).select('-password').sort({ created_at: -1 });

    return res.status(200).json({
      status: "1",
      message: "Fetched user inboxes successfully.",
      data: {
        userId,
        count: inboxes.length,
        inboxes
      }
    });
  } catch (error) {
    console.error('Error fetching user inboxes:', error.message);
    return res.status(500).json({
      status: "-1",
      message: error.message
    });
  }
});




// POST version of inbox-status
router.post('/api/warmup/inbox-status', async (req, res) => {
  const { userId, email } = req.body;

  if (!userId || !email) {
    return res.status(400).json({
      status: "-1",
      message: "userId and email are required"
    });
  }

  try {
    await connectToMongoDB();

    const inbox = await WarmupInbox.findOne({ userId, email }).select('-password');

    if (!inbox) {
      return res.status(404).json({
        status: "-1",
        message: "No inbox found for this userId and email"
      });
    }

    return res.status(200).json({
      status: "1",
      message: "Fetched inbox status successfully.",
      data: inbox
    });
  } catch (error) {
    console.error('Error fetching inbox status:', error.message);
    return res.status(500).json({
      status: "-1",
      message: error.message
    });
  }
});

module.exports = router;
