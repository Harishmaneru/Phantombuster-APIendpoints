const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { WebClient } = require('@slack/web-api');

// Initialize Slack Web API client
const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

// MongoDB connection
mongoose.connect(process.env.ONEPGR_MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  dbName: 'onepgr_apps'
});

// Connection error handling
mongoose.connection
  .on('error', err => console.error('[slackEvents]MongoDB error', err))
  .once('open', () => console.log('[slackEvents] MongoDB connected'));

// Define visitor schema
const VisitorSchema = new mongoose.Schema({
  name: String,
  title: String,
  company: String,
  email: { type: String, unique: true },
  linkedin: String,
  location: String,
  pageCount: Number,
  firstSeen: Date,
  lastSeen: Date,
});

// Ensure indexes are created
VisitorSchema.index({ email: 1 }, { unique: true });

// Create Visitor model using 'slack_ri_events' collection
const Visitor = mongoose.model('Visitor', VisitorSchema, 'slack_ri_events');

/**
 * Post visitor information to Slack using a bot user
 * This ensures Events API will trigger with message.channels events
 * that our webhook handler can process
 * 
 * @param {Object} visitor - Visitor data object
 * @returns {Promise<Object>} - Result from Slack API
 */
async function postVisitorToSlack(visitor) {
  const text = [
    `Name: ${visitor.name || 'Unknown'}`,
    `Title: ${visitor.title || ''}`,
    `Company: ${visitor.company || ''}`,
    `Email: ${visitor.email || ''}`,
    `LinkedIn: ${visitor.linkedin || ''}`,
    `Location: ${visitor.location || ''}`,
    visitor.pageCount ? `Has visited ${visitor.pageCount} pages` : 'Has visited your website'
  ].join('\n');

  try {
    const result = await slack.chat.postMessage({
      channel: process.env.SLACK_TARGET_CHANNEL_ID,
      text,
      unfurl_links: false,
      unfurl_media: false
    });

    console.log('[slackEvents] Posted visitor to Slack:', visitor.email);
    return result;
  } catch (error) {
    console.error('[slackEvents] Error posting to Slack:', error);
    throw error;
  }
}

// Helper function to parse visitor information from message text
function parseVisitorText(text) {
  const lines = text.split('\n');
  const v = {};
  for (let line of lines) {
    const [key, ...rest] = line.split(':');
    const val = rest.join(':').trim();
    switch (key.trim()) {
      case 'Name': v.name = val; break;
      case 'Title': v.title = val; break;
      case 'Company': v.company = val; break;
      case 'Email': v.email = val; break;
      case 'LinkedIn': v.linkedin = val; break;
      case 'Location': v.location = val; break;
      default:
        const m = line.match(/visited\s+(\d+)\s+pages/);
        if (m) v.pageCount = Number(m[1]);
    }
  }
  return v;
}

const router = express.Router();
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const CHANNEL_ID = process.env.SLACK_TARGET_CHANNEL_ID;
const RB2B_BOT_ID = process.env.RB2B_BOT_ID;

// Health-check
router.get('/slack/rb2b-ri-visitors', (_req, res) => {
  console.log('[slackEvents] GET /slack/rb2b-ri-visitors hit');
  res.send('OK_test');
});

router.post('/slack/rb2b-ri-visitors', async (req, res) => {
  console.log('[slackEvents] POST hit', {
    isBuffer: Buffer.isBuffer(req.body),
    headers: req.headers
  });

  const ts = req.headers['x-slack-request-timestamp'];
  const sig = req.headers['x-slack-signature'];
  const raw = req.body;         // <-- Buffer now

  if (!raw || !Buffer.isBuffer(raw)) {
    console.error('[slackEvents] Missing raw body buffer');
    return res.status(400).send('Bad request: Missing raw body');
  }

  // Reject old requests
  const age = Math.floor(Date.now() / 1000) - Number(ts);
  if (Math.abs(age) > 300) return res.status(400).send('Stale request');

  // Recompute HMAC
  const base = `v0:${ts}:${raw.toString('utf8')}`;
  const myHash = 'v0=' + crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(base)
    .digest('hex');

  // Constant-time compare
  try {
    if (!crypto.timingSafeEqual(
      Buffer.from(myHash, 'utf8'),
      Buffer.from(sig, 'utf8')
    )) {
      return res.status(401).send('Invalid signature');
    }
  } catch (err) {
    return res.status(401).send('Signature verification error');
  }

  // Parse JSON from raw buffer
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
    console.log('[slackEvents] Full payload:', JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error('[slackEvents] JSON parse error:', err);
    return res.sendStatus(400);
  }

  // URL verification handshake
  if (payload.type === 'url_verification') {
    // Slack wants the raw challenge back
    res.set('Content-Type', 'text/plain');
    return res.status(200).send(payload.challenge);
  }

  // Acknowledge to Slack immediately
  res.sendStatus(200);

  // Process the event
  const { event } = payload;
  if (!event) return;

  console.log('[slackEvents] GOT BOT_ID:', {
    bot_id: event.bot_id,
    subtype: event.subtype,
    channel: event.channel,
    text: event.text?.slice(0, 50)
  });

  // Filter to target channel only
  if (event.channel !== CHANNEL_ID) return;

  // Only process bot posts from RB2B scraper
  if (
    event.type !== 'message' ||
    event.subtype !== 'bot_message' ||
    event.bot_id !== RB2B_BOT_ID
  ) {
    return;
  }

  try {
    // Parse the visitor fields out of event.text
    const visitor = parseVisitorText(event.text);

    // Skip if no email (our unique key)
    if (!visitor.email) {
      console.warn('[slackEvents] Missing email in visitor data, skipping');
      return;
    }

    // Upsert by email (unique visitor key)
    await Visitor.findOneAndUpdate(
      { email: visitor.email },
      {
        $setOnInsert: {
          firstSeen: new Date(),
        },
        $set: {
          name: visitor.name,
          title: visitor.title,
          company: visitor.company,
          linkedin: visitor.linkedin,
          location: visitor.location,
          lastSeen: new Date(),
          pageCount: visitor.pageCount || 1
        }
      },
      { upsert: true, new: true }
    );

    console.log('[slackEvents] Visitor saved:', visitor.email);
  } catch (err) {
    console.error('[slackEvents]Error saving visitor:', err);
  }
});

// Export both the router and the postVisitorToSlack function
module.exports = {
  router,
  postVisitorToSlack
};
