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
  baseURL: 'https://api.warmupinbox.com/v1',
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
// router.post('/api/warmup/add-inbox', async (req, res) => {
//   const { userId, email, password, sender_first, sender_last } = req.body;

//   // Validation - According to API docs
//   if (!userId || !email || !password || !sender_first || !sender_last) {
//     return res.status(400).json({
//       status: "-1",
//       message: "Missing required fields",
//       details: {
//         required_fields: {
//           userId: "string",
//           email: "valid email address",
//           password: "string (min 8 chars)",
//           sender_first: "string",
//           sender_last: "string"
//         }
//       }
//     });
//   }

//   try {
//     await connectToMongoDB();

//     // Check if inbox already exists for this user and email
//     const existingInbox = await WarmupInbox.findOne({ userId, email });
//     if (existingInbox) {
//       return res.status(409).json({
//         status: "-1",
//         message: "Inbox already exists for this userId and email",
//         data: {
//           inbox_id: existingInbox.inbox_id,
//           email: existingInbox.email,
//           status: existingInbox.status
//         }
//       });
//     }

//     // Build payload according to API docs
//     const payload = {
//       email: email,
//       password: password,
//       sender_first: sender_first,
//       sender_last: sender_last,
//       plan: "basic", // or "pro"/"max" based on subscription
//       frequency: {
//         starting_baseline: 4,    // Must be ≤4 for basic plan
//         increase_per_day: 4,      // Must be ≤4 for basic plan
//         max_sends_per_day: 20,    // Must be ≤20 for basic plan
//         reply_rate: 25,           // Must be ≤25 for basic plan
//         strategy: "progressive"   // Required field per docs
//       },
//       // Optional but recommended:
//       extended_reply: true,       // For more natural conversations
//       esp_priority: {             // ESP targeting
//         google: true,
//         outlook: false,
//         all_other: false
//       }
//     };

//     console.log('Sending payload to Warmup Inbox:', {
//       email: payload.email,
//       sender_first: payload.sender_first,
//       sender_last: payload.sender_last,
//       plan: payload.plan,
//       frequency: payload.frequency,
//       hasPassword: !!payload.password,
//       extended_reply: payload.extended_reply,
//       esp_priority: payload.esp_priority
//     });

//     // Make API call
//     const response = await axiosInstance.post('/inboxes', payload);

//     // Handle response according to API docs
//     if (response.data.code === 'created') {
//       // Store the response in MongoDB
//       const warmupInboxData = new WarmupInbox({
//         userId,
//         email,
//         inbox_id: response.data.inbox_id,
//         password, // Consider encrypting this before storage
//         sender_first,
//         sender_last,
//         status: response.data.code || 'created',
//         plan: payload.plan,
//         frequency: payload.frequency,
//         warmup_response: response.data,
//         updated_at: new Date()
//       });

//       await warmupInboxData.save();

//       return res.status(201).json({
//         status: "1",
//         message: "Inbox successfully added to warmup",
//         data: {
//           inbox_id: response.data.inbox_id,
//           status: "pending_activation",
//           next_steps: [
//             "Configure email client filters using filter_id",
//             "Verify DNS records (MX, SPF, DKIM)"
//           ],
//           userId,
//           stored_in_db: true
//         }
//       });
//     }

//   } catch (error) {
//     console.error('Warmup Inbox API Error:', error.response?.data || error.message);

//     // Handle specific error cases from API docs
//     const apiError = error.response?.data?.error || "unknown_error";
//     const statusCode = error.response?.status || 500;

//     const errorMap = {
//       'invalid_api_key': 401,
//       'missing_api_key': 401,
//       'invalid_request': 400,
//       'inbox_already_exists': 409,
//       'domain_not_configured': 422
//     };

//     // More detailed error handling for common issues
//     let errorMessage = error.response?.data?.message || error.message;

//     if (error.response?.status === 422) {
//       errorMessage = "Domain configuration error. Please verify: " + 
//         "1) MX records are properly configured\n" +
//         "2) SPF record includes: v=spf1 a mx include:_spf.warmupinbox.com ~all\n" +
//         "3) Email credentials are correct and SMTP/IMAP is enabled";
//     } else if (error.response?.status === 409) {
//       errorMessage = "Inbox already exists in Warmup Inbox service";
//     } else if (error.response?.status === 401) {
//       errorMessage = "Invalid API key. Please check your WARMUPINBOX_API_KEY configuration";
//     }

//     return res.status(errorMap[apiError] || statusCode).json({
//       status: "-1",
//       error: apiError,
//       message: errorMessage,
//       details: error.response?.data?.details || undefined
//     });
//   }
// });



router.post('/api/warmup/add-inbox', async (req, res) => {
  const { userId, email, password, sender_first, sender_last } = req.body;

  // Validation - According to API docs
  if (!userId || !email || !password || !sender_first || !sender_last) {
    return res.status(400).json({
      status: "-1",
      message: "Missing required fields",
      details: {
        required_fields: {
          userId: "string",
          email: "valid email address",
          password: "string (min 8 chars)",
          sender_first: "string",
          sender_last: "string"
        }
      }
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

    // Extract domain from email to determine mail server
    const domain = email.split('@')[1];
    const mailServer = `mail.${domain}`;

    // Build payload for ADVANCED endpoint with explicit SMTP/IMAP settings
    const payload = {
      email: email,
      sender_first: sender_first,
      sender_last: sender_last,
      plan: "basic", // or "pro"/"max" based on subscription
      frequency: {
        starting_baseline: 2,    // Must be ≤4 for basic plan
        increase_per_day: 2,      // Must be ≤4 for basic plan
        max_sends_per_day: 5,    // Must be ≤20 for basic plan
        reply_rate: 9,           // Must be ≤25 for basic plan
        strategy: "progressive"   // Required field per docs
      },
      // Explicit SMTP configuration
      smtp: {
        host: mailServer,         // mail.engagegptapp.com
        port: 465,                // SSL port
        username: email,          // Full email as username
        password: password,
        tls: true                 // Use TLS/SSL for secure connection
      },
      // Explicit IMAP configuration
      imap: {
        host: mailServer,         // mail.engagegptapp.com
        port: 993,                // IMAP SSL port
        username: email,          // Full email as username
        password: password,
        tls: true                 // Use TLS/SSL for secure connection
      },
      // Optional but recommended:
      extended_reply: true,       // For more natural conversations
      esp_priority: {             // ESP targeting
        google: true,
        outlook: false,
        all_other: false
      }
    };

    console.log('Sending payload to Warmup Inbox (Advanced):', {
      email: payload.email,
      sender_first: payload.sender_first,
      sender_last: payload.sender_last,
      plan: payload.plan,
      frequency: payload.frequency,
      smtp: {
        host: payload.smtp.host,
        port: payload.smtp.port,
        username: payload.smtp.username,
        tls: payload.smtp.tls,
        hasPassword: !!payload.smtp.password
      },
      imap: {
        host: payload.imap.host,
        port: payload.imap.port,
        username: payload.imap.username,
        tls: payload.imap.tls,
        hasPassword: !!payload.imap.password
      },
      extended_reply: payload.extended_reply,
      esp_priority: payload.esp_priority
    });

    // Make API call to ADVANCED endpoint
    const response = await axiosInstance.post('/inboxes/advanced', payload);
    console.log('Warmup Inbox API Response:', response.data);
    // Handle response according to API docs
    if (response.data.code === 'created') {
      // Store the response in MongoDB
      const warmupInboxData = new WarmupInbox({
        userId,
        email,
        inbox_id: response.data.inbox_id,
        password, // Consider encrypting this before storage
        sender_first,
        sender_last,
        status: response.data.code || 'created',
        plan: payload.plan,
        frequency: payload.frequency,
        smtp_settings: payload.smtp,
        imap_settings: payload.imap,
        warmup_response: response.data,
        updated_at: new Date()
      });

      await warmupInboxData.save();

      return res.status(201).json({
        status: "1",
        message: "Inbox successfully added to warmup",
        data: {
          inbox_id: response.data.inbox_id,
          status: "pending_activation",
          next_steps: [
            "Configure email client filters using filter_id",
            "Verify DNS records (MX, SPF, DKIM)",
            "Test SMTP/IMAP connectivity"
          ],
          userId,
          stored_in_db: true
        }
      });
    }

  } catch (error) {
    console.error('Warmup Inbox API Error:', error.response?.data || error.message);

    // Handle specific error cases from API docs
    const apiError = error.response?.data?.error || "unknown_error";
    const statusCode = error.response?.status || 500;

    const errorMap = {
      'invalid_api_key': 401,
      'missing_api_key': 401,
      'invalid_request': 400,
      'inbox_already_exists': 409,
      'domain_not_configured': 422,
      'smtp_connection_failed': 422,
      'imap_connection_failed': 422
    };

    // More detailed error handling for common issues
    let errorMessage = error.response?.data?.message || error.message;

    if (error.response?.status === 422) {
      // Check if it's SMTP/IMAP connection error
      if (error.response?.data?.details?.includes('SMTP') ||
        error.response?.data?.details?.includes('IMAP')) {
        errorMessage = "Email server connection failed. Please verify: " +
          "1) Email credentials are correct\n" +
          "2) SMTP/IMAP is enabled for the email account\n" +
          "3) Mail server hostname is accessible: mail." + email.split('@')[1] + "\n" +
          "4) Firewall allows connections on ports 465 (SMTP) and 993 (IMAP)";
      } else {
        errorMessage = "Domain configuration error. Please verify: " +
          "1) MX records are properly configured\n" +
          "2) SPF record includes: v=spf1 a mx include:_spf.warmupinbox.com ~all\n" +
          "3) Email credentials are correct and SMTP/IMAP is enabled";
      }
    } else if (error.response?.status === 409) {
      errorMessage = "Inbox already exists in Warmup Inbox service";
    } else if (error.response?.status === 401) {
      errorMessage = "Invalid API key. Please check your WARMUPINBOX_API_KEY configuration";
    }

    return res.status(errorMap[apiError] || statusCode).json({
      status: "-1",
      error: apiError,
      message: errorMessage,
      details: error.response?.data?.details || undefined
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
    const response = await axiosInstance.post(`/inboxes/${inboxId}/start`);

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
    const response = await axiosInstance.post(`/inboxes/${inboxId}/pause`);

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
    const response = await axiosInstance.get(`/inboxes/${inboxId}/metrics`, {
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
    const response = await axiosInstance.get(`/inboxes/${inboxId}/metrics`, {
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
    const response = await axiosInstance.get(`/inboxes/${inboxId}`);

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
    const response = await axiosInstance.delete(`/inboxes/${inboxId}`);

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
router.post('/api/warmup/inbox-status/bulk', async (req, res) => {
  const { userId, emails } = req.body;

  if (!userId || !emails || !Array.isArray(emails)) {
    return res.status(400).json({
      status: "-1",
      message: "userId and emails (array) are required",
      error_code: "missing_parameters"
    });
  }

  try {
    await connectToMongoDB();

    // 1. Fetch all matching inboxes from MongoDB
    const inboxes = await WarmupInbox.find({ 
      userId, 
      email: { $in: emails } 
    }).select('-password -__v');

    if (!inboxes.length) {
      return res.status(404).json({
        status: "-1",
        message: "No inboxes found for this userId and emails",
        error_code: "no_matching_inboxes"
      });
    }

    // 2. Fetch real-time status for each inbox with proper error handling
    const statusPromises = inboxes.map(async (inbox) => {
      try {
        const response = await warmupAxios.get(`/inboxes/${inbox.inbox_id}`);
        
        // Map API status to consistent values
        const statusMap = {
          running: "running",
          paused: "paused",
          banned: "banned",
          error: "error",
          suspended: "suspended"
        };

        return {
          ...inbox.toObject(),
          warmup_status: statusMap[response.data.status] || "unknown_status",
          status_details: response.data, // Full API response
          last_checked: new Date(),
          health_check: response.data.health_check // From API docs
        };
      } catch (error) {
        // Handle specific API errors from documentation
        const errorResponse = {
          ...inbox.toObject(),
          last_checked: new Date(),
          status_details: null
        };

        if (error.response) {
          // API returned an error response
          switch (error.response.status) {
            case 401:
              return {
                ...errorResponse,
                warmup_status: "auth_error",
                error_code: "invalid_api_key"
              };
            case 404:
              return {
                ...errorResponse,
                warmup_status: "not_found",
                error_code: "inbox_not_found"
              };
            case 429:
              return {
                ...errorResponse,
                warmup_status: "rate_limited",
                error_code: "too_many_requests"
              };
            default:
              return {
                ...errorResponse,
                warmup_status: "api_error",
                error_code: error.response.data?.error || "unknown_api_error"
              };
          }
        } else {
          // Network/other errors
          return {
            ...errorResponse,
            warmup_status: "connection_error",
            error_code: error.code || "network_error"
          };
        }
      }
    });

    const results = await Promise.all(statusPromises);

    // 3. Prepare metadata
    const foundEmails = inboxes.map(i => i.email);
    const missingEmails = emails.filter(email => !foundEmails.includes(email));

    return res.status(200).json({
      status: "1",
      message: "Bulk status fetched successfully",
      data: {
        inboxes: results,
        metadata: {
          total_requested: emails.length,
          success_count: results.filter(r => !r.error_code).length,
          error_count: results.filter(r => r.error_code).length,
          missing_from_db: missingEmails
        }
      }
    });

  } catch (error) {
    console.error('Bulk status error:', error);
    return res.status(500).json({
      status: "-1",
      message: "Internal server error",
      error_code: "server_error",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * 8. Update inbox configuration
 *
 *    PUT /api/warmup/update-inbox
 *
 *    Body JSON:
 *      {
 *        "userId": "user123",
 *        "email": "sales@testgpt.com",
 *        "frequency": {
 *          "starting_baseline": 6,
 *          "increase_per_day": 6,
 *          "max_sends_per_day": 30,
 *          "reply_rate": 30
 *        },
 *        "sender_first": "Updated",
 *        "sender_last": "Name"
 *      }
 *
 *    → Updates the inbox configuration in Warmup Inbox
 *
 *    Endpoint hit: PUT /v1/inboxes/{id}
 *    Documentation: https://docs.warmupinbox.com/
 */
router.put('/api/warmup/update-inbox', async (req, res) => {
  const { userId, email, frequency, sender_first, sender_last } = req.body;

  if (!userId || !email) {
    return res.status(400).json({
      status: "-1",
      message: "userId and email are required"
    });
  }

  try {
    // Get inbox_id from database
    const inboxId = await getInboxIdFromDB(userId, email);

    // Build update payload with only provided fields
    const updatePayload = {};
    if (frequency) updatePayload.frequency = frequency;
    if (sender_first) updatePayload.sender_first = sender_first;
    if (sender_last) updatePayload.sender_last = sender_last;

    // PUT /v1/inboxes/{id}
    const response = await axiosInstance.put(`/inboxes/${inboxId}`, updatePayload);

    // Update local database
    await WarmupInbox.findOneAndUpdate(
      { userId, email },
      {
        ...updatePayload,
        updated_at: new Date()
      }
    );

    return res.status(200).json({
      status: "1",
      message: "Inbox configuration updated successfully.",
      data: {
        ...response.data,
        userId,
        email,
        inbox_id: inboxId
      }
    });
  } catch (error) {
    console.error('Error updating inbox configuration:', error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      status: "-1",
      message: error.response?.data?.message || error.message
    });
  }
});

/**
 * 9. Get inbox health status
 *
 *    GET /api/warmup/inbox-health/:userId/:email
 *    OR
 *    POST /api/warmup/inbox-health
 *
 *    Body JSON (for POST):
 *      {
 *        "userId": "user123",
 *        "email": "sales@testgpt.com"
 *      }
 *
 *    → Returns health check results for the inbox
 *
 *    Endpoint hit: GET /v1/inboxes/{id}/health
 *    Documentation: https://docs.warmupinbox.com/
 */
router.get('/api/warmup/inbox-health/:userId/:email', async (req, res) => {
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

    // GET /v1/inboxes/{id}/health
    const response = await axiosInstance.get(`/inboxes/${inboxId}/health`);

    return res.status(200).json({
      status: "1",
      message: "Fetched inbox health status successfully.",
      data: {
        ...response.data,
        userId,
        email,
        inbox_id: inboxId
      }
    });
  } catch (error) {
    console.error('Error fetching inbox health:', error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      status: "-1",
      message: error.response?.data?.message || error.message
    });
  }
});

// POST version of inbox-health
router.post('/api/warmup/inbox-health', async (req, res) => {
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

    // GET /v1/inboxes/{id}/health
    const response = await axiosInstance.get(`/inboxes/${inboxId}/health`);

    return res.status(200).json({
      status: "1",
      message: "Fetched inbox health status successfully.",
      data: {
        ...response.data,
        userId,
        email,
        inbox_id: inboxId
      }
    });
  } catch (error) {
    console.error('Error fetching inbox health:', error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      status: "-1",
      message: error.response?.data?.message || error.message
    });
  }
});

/**
 * 10. Get account usage and limits
 *
 *    GET /api/warmup/account-usage
 *
 *    → Returns account usage statistics and limits
 *
 *    Endpoint hit: GET /v1/account/usage
 *    Documentation: https://docs.warmupinbox.com/
 */
router.get('/api/warmup/account-usage', async (req, res) => {
  try {
    // GET /v1/account/usage
    const response = await axiosInstance.get('/account/usage');

    return res.status(200).json({
      status: "1",
      message: "Fetched account usage successfully.",
      data: response.data
    });
  } catch (error) {
    console.error('Error fetching account usage:', error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      status: "-1",
      message: error.response?.data?.message || error.message
    });
  }
});

module.exports = router;
