const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { WebClient } = require('@slack/web-api');

// Initialize Slack Web API client
const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

// MongoDB connection
mongoose.connect(process.env.ONEPGR_MONGO_URI, {
  // useNewUrlParser: true,
  // useUnifiedTopology: true,
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
  email: String,
  linkedin: String,
  location: String,
  pageCount: Number,
  firstSeen: Date,
  lastSeen: Date,
  visitorId: String,

  // new fields
  aboutName: String,
  website: String,
  employees: String,
  industry: String,
  revenue: String
});

// Add indexes
VisitorSchema.index({ email: 1 }, { unique: true, sparse: true });
VisitorSchema.index({ visitorId: 1 }, { unique: true, sparse: true });

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
  if (!text) {
    console.warn('[slackEvents] No text provided to parseVisitorText');
    return null;
  }

  const lines = text.split('\n');
  const v = {};

  let inAboutSection = false;

  console.log('[slackEvents] Parsing visitor text:', text);

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // detect About heading
    if (line.startsWith('About ')) {
      inAboutSection = true;
      v.aboutName = line.slice('About '.length).trim();
      continue;
    }

    // once in About, parse its 4 properties
    if (inAboutSection) {
      const [key, ...rest] = line.split(':');
      const val = rest.join(':').trim();
      switch (key.trim().replace(/^[*>]\s*/, '')) { // Handle formatting chars
        case 'Website': v.website = val; break;
        case 'Est. Employees': v.employees = val; break;
        case 'Industry': v.industry = val; break;
        case 'Est. Revenue': v.revenue = val; break;
      }
      continue;
    }

    // Handle lines that don't have a colon but might contain email info
    if (!line.includes(':')) {
      // Check if line contains email pattern
      const emailMatch = line.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
      if (emailMatch) {
        v.email = emailMatch[0];
      }
      continue;
    }

    // Handle lines with key-value pairs
    const colonIndex = line.indexOf(':');
    const rawKey = line.substring(0, colonIndex).trim();
    const key = rawKey.replace(/^[*>]\s*/, ''); // Strip leading "*", ">", or other format chars
    let val = line.substring(colonIndex + 1).trim();

    // If Slack wrapped this in <...>, grab the part after the pipe or the URL itself
    if (val.startsWith('<') && val.endsWith('>')) {
      const inner = val.slice(1, -1);
      const parts = inner.split('|');
      val = parts[1] || parts[0];
    }

    // Handle special formatting in keys (e.g., "*Name:" becomes "Name:")
    switch (key) {
      case 'Name': v.name = val; break;
      case 'Title': v.title = val; break;
      case 'Company': v.company = val; break;
      case 'Email': v.email = val; break;
      case 'LinkedIn': v.linkedin = val; break;
      case 'Location': v.location = val; break;
      default:
        const m = line.match(/visited\s+(\d+)\s+pages/i);
        if (m) v.pageCount = Number(m[1]);
    }
  }

  // Generate fallback ID if email is missing - using only name and company for deduplication
  if (!v.email) {
    const namePart = v.name ? v.name.replace(/\s+/g, '_').toLowerCase() : 'unknown';
    const companyPart = v.company ? v.company.replace(/\s+/g, '_').toLowerCase() : 'unknown';
    v.visitorId = `${namePart}_${companyPart}`;
    console.log('[slackEvents] Generated fallback visitor ID:', v.visitorId);
  }

  // Additional debug logging
  console.log('[slackEvents] Parsed visitor data:', v);
  return v;
}

const router = express.Router();
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const CHANNEL_ID = process.env.SLACK_TARGET_CHANNEL_ID;
const RB2B_BOT_ID = process.env.RB2B_BOT_ID;

// Health-check
router.get('/', (_req, res) => {

  res.send('OK_test');
});

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  // Parse JSON from raw buffer
  const raw = req.body;

  if (!raw || !Buffer.isBuffer(raw)) {
    console.error('[slackEvents] Missing raw body buffer');
    return res.status(400).send('Bad request: Missing raw body');
  }

  const ts = req.headers['x-slack-request-timestamp'];
  const sig = req.headers['x-slack-signature'];

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

  console.log('────────────────────────────────────────');
  console.log('[slackEvents] Full incoming Slack payload:\n', JSON.stringify(payload, null, 2));
  console.log('[slackEvents] Request headers:\n', JSON.stringify(req.headers, null, 2));
  console.log('────────────────────────────────────────');

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

  console.log('[slackEvents] Incoming event.bot_id =', event.bot_id);
  console.log('[slackEvents] POST hit', {
    isBuffer: Buffer.isBuffer(req.body),
    headers: req.headers
  });

  console.log('[slackEvents] GOT BOT_ID:', {
    bot_id: event.bot_id,
    subtype: event.subtype,
    channel: event.channel,
    text: event.text?.slice(0, 50)
  });

  // Filter to target channel only
  if (event.channel !== CHANNEL_ID) return;

  // 1a) Must be a message
  if (event.type !== 'message') return;

  // 1b) We *only* care about bot-posted messages (so skip edits/deletes, etc.)
  if (event.subtype && event.subtype !== 'bot_message') return;

  // 1c) And only from our RB2B bot
  if (event.bot_id !== RB2B_BOT_ID) {
    console.log('[slackEvents] Skipping message from non-RB2B bot:', event.bot_id);
    return;
  }

  // Guard against missing text
  if (!event.text) {
    console.warn('[slackEvents] No text on event, skipping');
    return;
  }

  try {
    // Parse the visitor fields out of event.text
    const visitor = parseVisitorText(event.text);
    if (!visitor) {
      console.warn('[slackEvents] Failed to parse visitor from text');
      return;
    }

    // Create query condition based on whether email exists
    const query = visitor.email ? { email: visitor.email } : { visitorId: visitor.visitorId };

    // Upsert by email or visitorId
    await Visitor.findOneAndUpdate(
      query,
      {
        $setOnInsert: {
          firstSeen: new Date(),
          visitorId: visitor.visitorId // Ensure visitorId is set on insert
        },
        $set: {
          name: visitor.name || '',
          title: visitor.title || '',
          company: visitor.company || '',
          email: visitor.email || '',
          linkedin: visitor.linkedin || '',
          location: visitor.location || '',
          lastSeen: new Date(),
          pageCount: visitor.pageCount || 1,

          // new about section fields
          aboutName: visitor.aboutName || '',
          website: visitor.website || '',
          employees: visitor.employees || '',
          industry: visitor.industry || '',
          revenue: visitor.revenue || ''
        }
      },
      { upsert: true, new: true }
    );

    console.log('[slackEvents] Visitor saved:', visitor.email || visitor.visitorId);
  } catch (err) {
    console.error('[slackEvents] Error saving visitor:', err);
  }
});

module.exports = {
  router,
  postVisitorToSlack
};
