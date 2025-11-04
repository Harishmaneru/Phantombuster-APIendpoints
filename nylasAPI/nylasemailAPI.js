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

router.get('/allthreads/:grantId', checkApiKey, async (req, res) => {
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

router.get('/specificthread/:grantId/:threadId', checkApiKey, async (req, res) => {
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


/*_________________________SEND EMAIL_________________________*/

/**
 * Send an email via Nylas
 * POST /api/nylas/sendemail/:grantId
 * Body: { 
 *   to,                    // Required: array or string
 *   subject,               // Required
 *   from,                  // Optional: array or string
 *   body,                  // Optional: plain text body
 *   html,                  // Optional: HTML body (or use body_html)
 *   body_html,             // Optional: HTML body (alternative to html)
 *   cc,                    // Optional: array or string
 *   bcc,                   // Optional: array or string
 *   reply_to,              // Optional: array or string
 *   reply_to_message_id,   // Optional: message ID to reply to
 *   attachments,           // Optional: array of attachment objects
 *   tracking_options       // Optional: { 
 *                          //   opens: bool - Track when message is opened
 *                          //   links: bool - Track link clicks (max 20 links)
 *                          //   thread_replies: bool - Track thread replies
 *                          //   payload: string - Custom tracking data
 *                          //   label: string - Custom label for tracking
 *                          // }
 * }
 * 
 * Reference: 
 * - https://developer.nylas.com/docs/v3/email/send-email/
 * - https://developer.nylas.com/docs/v3/email/message-tracking/
 */
router.post('/sendemail/:grantId', checkApiKey, async (req, res) => {
  try {
    const { grantId } = req.params;
    const {
      to,
      from,
      subject,
      body,
      html,
      body_html,
      cc,
      bcc,
      reply_to,
      reply_to_message_id,
      attachments,
      tracking_options
    } = req.body;

    // Validate required fields
    if (!to || !subject) {
      return res.status(400).json({
        success: false,
        message: 'To and subject are required fields',
        data: null,
        timestamp: new Date().toISOString()
      });
    }

    const url = `${NYLAS_API_BASE_URL}/grants/${grantId}/messages/send`;

    // Format recipients - handle both string and array formats
    // Returns array of { name, email } objects as per Nylas spec
    const formatRecipients = (recipients) => {
      if (!recipients) return [];
      if (typeof recipients === 'string') {
        // Parse "Name <email>" format or just email
        const match = recipients.match(/^(.+?)\s*<(.+?)>$/);
        if (match) {
          return [{ name: match[1].trim(), email: match[2].trim() }];
        }
        return [{ email: recipients.trim() }];
      }
      if (Array.isArray(recipients)) {
        return recipients.map(r => {
          if (typeof r === 'string') {
            const match = r.match(/^(.+?)\s*<(.+?)>$/);
            return match ? { name: match[1].trim(), email: match[2].trim() } : { email: r.trim() };
          }
          return r; // Already an object
        });
      }
      return [];
    };

    const payload = {
      subject: subject,
      to: formatRecipients(to)
    };

    // Add from field - must be array as per Nylas spec
    if (from) {
      const fromArray = formatRecipients(from);
      if (fromArray.length > 0) {
        payload.from = fromArray; // Array format as per docs
      }
    }

    // Add body - plain text (required if no HTML)
    if (body) {
      payload.body = body;
    } else if (html || body_html) {
      // Auto-extract text from HTML if no body provided
      const htmlContent = html || body_html;
      payload.body = htmlContent.replace(/<[^>]*>/g, '').trim();
    }

    // Add HTML body - use body_html as per Nylas spec (or html as alias)
    const htmlContent = body_html || html;
    if (htmlContent) {
      payload.body_html = htmlContent;
    }

    // Add CC if provided
    if (cc) {
      payload.cc = formatRecipients(cc);
    }

    // Add BCC if provided
    if (bcc) {
      payload.bcc = formatRecipients(bcc);
    }

    // Add reply_to if provided
    if (reply_to) {
      payload.reply_to = formatRecipients(reply_to);
    }

    // Add reply_to_message_id if provided
    if (reply_to_message_id) {
      payload.reply_to_message_id = reply_to_message_id;
    }

    // Add attachments if provided
    if (attachments && Array.isArray(attachments)) {
      payload.attachments = attachments;
    }

    // Add tracking_options if provided
    // Structure: { opens: bool, links: bool, thread_replies: bool, payload: string, label: string }
    // Reference: https://developer.nylas.com/docs/v3/email/message-tracking/
    if (tracking_options) {
      // Validate tracking options structure
      const validTrackingOptions = {};
      if (tracking_options.opens !== undefined) validTrackingOptions.opens = Boolean(tracking_options.opens);
      if (tracking_options.links !== undefined) validTrackingOptions.links = Boolean(tracking_options.links);
      if (tracking_options.thread_replies !== undefined) validTrackingOptions.thread_replies = Boolean(tracking_options.thread_replies);
      if (tracking_options.payload !== undefined) validTrackingOptions.payload = String(tracking_options.payload);
      if (tracking_options.label !== undefined) validTrackingOptions.label = String(tracking_options.label);

      if (Object.keys(validTrackingOptions).length > 0) {
        payload.tracking_options = validTrackingOptions;
      }
    }

    // Set timeout to 150 seconds as recommended by Nylas docs
    console.log('Sending email payload:', JSON.stringify(payload, null, 2));
    const response = await axios.post(url, payload, {
      headers: {
        'Accept': 'application/json, application/gzip',
        'Authorization': `Bearer ${NYLAS_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 150000 // 150 seconds as per Nylas recommendation for self-hosted Exchange
    });

    res.json({
      success: true,
      data: response.data,
      message: 'Email sent successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error sending email:', error.response?.data || error.message);

    // Handle 503 errors with backoff recommendation as per Nylas docs
    if (error.response?.status === 503) {
      return res.status(503).json({
        success: false,
        message: 'Service temporarily unavailable. Please wait 10-20 minutes before retrying.',
        data: error.response?.data || null,
        timestamp: new Date().toISOString()
      });
    }

    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Failed to send email',
      data: error.response?.data || null,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/fetchsentemails/:grantId', checkApiKey, async (req, res) => {
  try {
    const { grantId } = req.params;
    const limit = req.query.limit || 15;
    const page = req.query.page || 1;
    const subject = req.query.subject;
    const to = req.query.to;
    const start = req.query.start;
    const end = req.query.end;
    const folderId = req.query.folderId; // Optional: allow passing folder ID directly

    // Calculate offset for pagination
    const offset = (page - 1) * limit;

    let sentFolderId = folderId;

    // If no folder ID provided, fetch folders to find the "Sent" folder
    if (!sentFolderId) {
      try {
        const foldersUrl = `${NYLAS_API_BASE_URL}/grants/${grantId}/folders`;
        const foldersResponse = await axios.get(foldersUrl, {
          headers: {
            'Accept': 'application/json, application/gzip',
            'Authorization': `Bearer ${NYLAS_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });

        const folders = foldersResponse.data?.data || foldersResponse.data || [];
        
        // Find sent folder by role or name
        const sentFolder = folders.find(folder => 
          folder.role === 'sent' || 
          folder.role === 'sent_items' ||
          folder.name?.toLowerCase().includes('sent')
        );

        if (sentFolder) {
          sentFolderId = sentFolder.id;
        } else {
          // If no sent folder found, try common names
          const commonNames = ['Sent', 'Sent Mail', 'Sent Items', 'Sent Messages'];
          const folderByName = folders.find(folder => 
            commonNames.some(name => folder.name?.toLowerCase() === name.toLowerCase())
          );
          if (folderByName) {
            sentFolderId = folderByName.id;
          }
        }

        if (!sentFolderId) {
          return res.status(404).json({
            success: false,
            message: 'Sent folder not found. Please provide folderId as query parameter.',
            data: { availableFolders: folders.map(f => ({ id: f.id, name: f.name, role: f.role })) },
            timestamp: new Date().toISOString()
          });
        }
      } catch (folderError) {
        console.error('Error fetching folders:', folderError.response?.data || folderError.message);
        return res.status(500).json({
          success: false,
          message: 'Failed to fetch folders. Please provide folderId as query parameter.',
          data: folderError.response?.data || null,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Build query parameters
    const queryParams = new URLSearchParams();
    queryParams.append('limit', limit);
    queryParams.append('offset', offset);
    queryParams.append('in', sentFolderId); // Use folder ID instead of name

    if (subject) {
      queryParams.append('subject', subject);
    }

    if (to) {
      queryParams.append('to', to);
    }

    if (start) {
      queryParams.append('start', start);
    }

    if (end) {
      queryParams.append('end', end);
    }

    const url = `${NYLAS_API_BASE_URL}/grants/${grantId}/messages?${queryParams.toString()}`;

    const response = await axios.get(url, {
      headers: {
        'Accept': 'application/json, application/gzip',
        'Authorization': `Bearer ${NYLAS_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    // Add pagination info to response
    res.json({
      success: true,
      data: response.data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        offset: offset,
        hasMore: response.data.length >= limit // Check if there might be more results
      },
      message: 'Sent emails fetched successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching sent emails:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Failed to fetch sent emails',
      data: error.response?.data || null,
      timestamp: new Date().toISOString()
    });
  }
});

/*_________________________FOLDERS API_________________________*/

/**
 * Get all folders for a grant
 * GET /api/nylas/folders/:grantId
 * Query params: limit (optional, default: 50)
 */
router.get('/folders/:grantId', checkApiKey, async (req, res) => {
  try {
    const { grantId } = req.params;
    const limit = req.query.limit || 50;

    const url = `${NYLAS_API_BASE_URL}/grants/${grantId}/folders?limit=${limit}`;

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
    console.error('Error fetching folders:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Failed to fetch folders',
      data: error.response?.data || null,
      timestamp: new Date().toISOString()
    });
  }
});

/*_________________________MESSAGE TRACKING API's_________________________*/



router.get('/get-tracking/:grantId/:messageId', checkApiKey, async (req, res) => {
  try {
    const { grantId, messageId } = req.params;

    // 1. Get message details
    const messageUrl = `${NYLAS_API_BASE_URL}/grants/${grantId}/messages/${messageId}`;
    let message, threadId, thread;

    try {
      const messageResponse = await axios.get(messageUrl, {
        headers: {
          'Accept': 'application/json, application/gzip',
          'Authorization': `Bearer ${NYLAS_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      message = messageResponse.data?.data || messageResponse.data;
      threadId = message?.thread_id || message?.threadId;
    } catch (error) {
      console.error('Error fetching message:', error.response?.data || error.message);
      message = null;
    }

    // 2. Get thread details (for replies tracking)
    if (threadId) {
      try {
        const threadUrl = `${NYLAS_API_BASE_URL}/grants/${grantId}/threads/${threadId}`;
        const threadResponse = await axios.get(threadUrl, {
          headers: {
            'Accept': 'application/json, application/gzip',
            'Authorization': `Bearer ${NYLAS_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });
        thread = threadResponse.data?.data || threadResponse.data;
      } catch (error) {
        console.error('Error fetching thread:', error.response?.data || error.message);
        thread = null;
      }
    }

    // 3. Extract tracking data from message metadata
    const trackingMetadata = message?.metadata || message?.tracking_metadata || {};
    const trackingOptions = message?.tracking_options || {};

    // Extract link.clicked tracking data
    const linkClicked = [];
    if (message?.tracking?.links || trackingMetadata.link_clicks) {
      const links = Array.isArray(message?.tracking?.links) ? message.tracking.links :
        Array.isArray(trackingMetadata.link_clicks) ? trackingMetadata.link_clicks :
          trackingMetadata.links || [];

      links.forEach((link, index) => {
        linkClicked.push({
          url: link.url || link.link_url || link.href,
          linkId: link.link_id || link.id || `link-${index}`,
          clickedAt: link.clicked_at || link.timestamp || link.date,
          ip: link.ip || link.ip_address,
          userAgent: link.user_agent || link.userAgent,
          recents: link.recents || link.recent_clicks || [],
          payload: trackingOptions.payload || trackingMetadata.payload,
          label: trackingOptions.label || trackingMetadata.label
        });
      });
    }

    // Extract message.opened tracking data
    const messageOpened = [];
    if (message?.tracking?.opens || trackingMetadata.opens) {
      const opens = Array.isArray(message?.tracking?.opens) ? message.tracking.opens :
        Array.isArray(trackingMetadata.opens) ? trackingMetadata.opens :
          trackingMetadata.open_events || [];

      opens.forEach((open, index) => {
        messageOpened.push({
          openedId: open.opened_id || open.id || `open-${index}`,
          openedAt: open.opened_at || open.timestamp || open.date,
          ip: open.ip || open.ip_address,
          userAgent: open.user_agent || open.userAgent,
          recents: open.recents || open.recent_opens || [],
          payload: trackingOptions.payload || trackingMetadata.payload,
          label: trackingOptions.label || trackingMetadata.label
        });
      });
    }

    // Extract thread.replied tracking data
    let threadReplied = null;
    if (thread && thread.messages) {
      const replies = thread.messages.filter(msg =>
        msg.id !== messageId &&
        (msg.in_reply_to === messageId || msg.references?.includes(messageId))
      );

      if (replies.length > 0) {
        threadReplied = {
          messageId: replies[0]?.id,
          rootMessageId: messageId,
          threadId: threadId || thread.id,
          replyCount: replies.length,
          replyData: {
            count: replies.length,
            latestReply: replies[0]?.date || replies[0]?.timestamp,
            replies: replies.map(reply => ({
              messageId: reply.id,
              from: reply.from,
              subject: reply.subject,
              date: reply.date
            }))
          },
          payload: trackingOptions.payload || trackingMetadata.payload,
          label: trackingOptions.label || trackingMetadata.label
        };
      }
    }

    // 4. Compile unified tracking response
    const trackingData = {
      message_id: message?.id || messageId,
      subject: message?.subject,
      sent_at: message?.date,
      tracking_enabled: !!(message?.tracking || trackingOptions.opens || trackingOptions.links || trackingOptions.thread_replies),
      tracking_options: trackingOptions,

      // Link Clicked Tracking
      link_clicked: {
        enabled: trackingOptions.links === true,
        count: linkClicked.length,
        data: linkClicked.map(click => ({
          url: click.url,
          linkId: click.linkId,
          clickedAt: click.clickedAt,
          ip: click.ip,
          userAgent: click.userAgent,
          recents: click.recents,
          payload: click.payload,
          label: click.label
        }))
      },

      // Message Opened Tracking
      message_opened: {
        enabled: trackingOptions.opens === true,
        count: messageOpened.length,
        data: messageOpened.map(open => ({
          openedId: open.openedId,
          openedAt: open.openedAt,
          ip: open.ip,
          userAgent: open.userAgent,
          recents: open.recents,
          payload: open.payload,
          label: open.label
        }))
      },

      // Thread Replied Tracking
      thread_replied: {
        enabled: trackingOptions.thread_replies === true,
        hasReplies: !!threadReplied,
        data: threadReplied ? {
          messageId: threadReplied.messageId,
          rootMessageId: threadReplied.rootMessageId,
          threadId: threadReplied.threadId,
          replyCount: threadReplied.replyCount,
          replyData: threadReplied.replyData,
          payload: threadReplied.payload,
          label: threadReplied.label
        } : null
      },

      // Raw data for debugging
      raw_data: {
        message: message,
        thread: thread,
        metadata: trackingMetadata
      }
    };

    res.json({
      success: true,
      data: trackingData,
      message: 'All tracking data retrieved successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching tracking data:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Failed to fetch tracking data',
      data: error.response?.data || null,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get all tracking events for a message (aggregated view) - Legacy endpoint
 * GET /api/nylas/tracking-events/:grantId/:messageId
 * 
 * Returns aggregated tracking data for a specific message
 */
router.get('/tracking-events/:grantId/:messageId', checkApiKey, async (req, res) => {
  try {
    const { grantId, messageId } = req.params;

    // Get message details
    const messageUrl = `${NYLAS_API_BASE_URL}/grants/${grantId}/messages/${messageId}`;
    const messageResponse = await axios.get(messageUrl, {
      headers: {
        'Accept': 'application/json, application/gzip',
        'Authorization': `Bearer ${NYLAS_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const message = messageResponse.data?.data || messageResponse.data;

    // Format tracking summary
    const trackingSummary = {
      message_id: message?.id || messageId,
      subject: message?.subject,
      sent_at: message?.date,
      tracking_enabled: !!(message?.tracking || message?.tracking_options),
      tracking_options: message?.tracking_options || null,
      summary: {
        note: 'Use GET /api/nylas/get-tracking/:grantId/:messageId for detailed tracking data'
      },
      message_data: message
    };

    res.json({
      success: true,
      data: trackingSummary,
      message: 'Use GET /api/nylas/get-tracking/:grantId/:messageId for detailed tracking data',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching tracking events:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Failed to fetch tracking events',
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
router.get('/calendars/:grantId', checkApiKey, async (req, res) => {
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
router.get('/specificcalendar/:grantId/:calendarId', checkApiKey, async (req, res) => {
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
router.post('/createcalendar/:grantId', checkApiKey, async (req, res) => {
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
router.put('/updatecalendar/:grantId/:calendarId', checkApiKey, async (req, res) => {
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

