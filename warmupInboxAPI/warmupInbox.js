const express = require('express');
const axios = require('axios');
const router = express.Router();

const axiosInstance = axios.create({
  baseURL: process.env.WARMUP_API_BASE_URL || 'https://api.warmupinbox.com',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.WARMUPINBOX_API_KEY
  }
});

const getInboxMetrics = async (inboxId) => {
  if (!inboxId) {
    throw new Error("Inbox ID is required.");
  }

  const to = Math.floor(Date.now() / 1000);
  const from = to - (7 * 24 * 60 * 60);

  try {
    const response = await axiosInstance.get(`/v1/inboxes/${inboxId}/metrics`, {
      params: { from, to }
    });
    console.log('getInboxMetrics', response.data);
    return {
      metrics: response.data,
      dateRange: {
        from: new Date(from * 1000).toISOString(),
        to: new Date(to * 1000).toISOString()
      }

    };

  } catch (error) {
    console.error('Error fetching inbox metrics:', error.response ? error.response.data : error.message);
    throw error;
  }
};

const addInbox = async (inboxData) => {
  if (!inboxData.email || !inboxData.password || !inboxData.sender_first || !inboxData.sender_last) {
    throw new Error("Missing required fields: email, password, sender_first, sender_last are required.");
  }

  try {
    const payload = {
      email: inboxData.email,
      password: inboxData.password,
      sender_first: inboxData.sender_first,
      sender_last: inboxData.sender_last,
      plan: "send_only",
      frequency: {
        starting_baseline: 10,
        increase_per_day: 5,
        max_sends_per_day: 100,
        reply_rate: 25
      }
    };

    const response = await axiosInstance.post('/v1/inboxes', payload);
    console.log('addInbox', response.data);
    return response.data;
  } catch (error) {
    console.error('Error adding inbox:', error.response ? error.response.data : error.message);
    throw error;
  }
};

/**
 * Start an inbox (warmup)
 * @param {string} inboxId - ID of the inbox to start
 */
const startInbox = async (inboxId) => {
  if (!inboxId) {
    throw new Error("Inbox ID is required.");
  }

  try {
    const response = await axiosInstance.post(`/v1/inboxes/${inboxId}/start`);
    console.log('startInbox', response.data);
    return response.data;
  } catch (error) {
    console.error('Error starting inbox:', error.response ? error.response.data : error.message);
    throw error;
  }
};

/**
 * Stop an inbox (warmup)
 * @param {string} inboxId - ID of the inbox to stop
 */
const stopInbox = async (inboxId) => {
  if (!inboxId) {
    throw new Error("Inbox ID is required.");
  }

  try {
    const response = await axiosInstance.post(`/v1/inboxes/${inboxId}/pause`);
    console.log('stopInbox', response.data);
    return response.data;
  } catch (error) {
    console.error('Error stopping inbox:', error.response ? error.response.data : error.message);
    throw error;
  }
};


const getInboxDetails = async (inboxId) => {
  if (!inboxId) {
    throw new Error("Inbox ID is required.");
  }

  try {
    const response = await axiosInstance.get(`/v1/inboxes/${inboxId}`);
    console.log('getInboxDetails', response.data);
    return response.data;
  } catch (error) {
    console.error('Error fetching inbox details:', error.response ? error.response.data : error.message);
    throw error;
  }
};

/**
 * List all inboxes
 */
const listInboxes = async () => {
  try {
    const response = await axiosInstance.get('/v1/inboxes');
    console.log('listInboxes', response.data);
    return response.data;
  } catch (error) {
    console.error('Error listing inboxes:', error.response ? error.response.data : error.message);
    throw error;
  }
};

// Express Routes for Adding Inbox
router.post('/add-inbox', async (req, res) => {
  try {
    const response = await addInbox(req.body);
    console.log('add-inbox', response);
    res.status(200).json(response);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      status: "-1",
      message: error.response?.data?.message || error.message
    });
  }
});

// Express Routes for Starting Inbox
router.post('/start-inbox', async (req, res) => {
  try {
    const inboxId = req.body.inboxId || req.query.inboxId;
    if (!inboxId) {
      return res.status(400).json({
        status: "-1",
        message: "Inbox ID is required"
      });
    }
    const response = await startInbox(inboxId);
    console.log('start-inbox', response);
    res.status(200).json(response);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      status: "-1",
      message: error.response?.data?.message || error.message
    });
  }
});

// Express Routes for Stopping Inbox
router.post('/stop-inbox', async (req, res) => {
  try {
    const inboxId = req.body.inboxId || req.query.inboxId;
    if (!inboxId) {
      return res.status(400).json({
        status: "-1",
        message: "Inbox ID is required"
      });
    }
    const response = await stopInbox(inboxId);

    res.status(200).json(response);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      status: "-1",
      message: error.response?.data?.message || error.message
    });
  }
});

// Express Routes for Inbox Details
router.get('/inbox-details/:inboxId?', async (req, res) => {
  try {
    const inboxId = req.params.inboxId || req.body.inboxId || req.query.inboxId;
    if (!inboxId) {
      return res.status(400).json({
        status: "-1",
        message: "Inbox ID is required"
      });
    }
    const response = await getInboxDetails(inboxId);

    res.status(200).json(response);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      status: "-1",
      message: error.response?.data?.message || error.message
    });
  }
});

// Express Route for Listing Inboxes
router.get('/list-inboxes', async (req, res) => {
  try {
    const response = await listInboxes();

    res.status(200).json(response);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      status: "-1",
      message: error.response?.data?.message || error.message
    });
  }
});

router.get('/inbox-metrics/:inboxId?', async (req, res) => {
  try {
    const inboxId = req.params.inboxId || req.query.inboxId;

    if (!inboxId) {
      return res.status(400).json({
        status: "-1",
        message: "Inbox ID is required"
      });
    }

    const response = await getInboxMetrics(inboxId);
    res.status(200).json(response);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      status: "-1",
      message: error.response?.data?.message || error.message
    });
  }
});


module.exports = router;