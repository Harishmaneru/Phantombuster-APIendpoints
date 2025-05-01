const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const axios = require('axios');
const FormData = require('form-data');
const { WebClient } = require('@slack/web-api');
const { parse, isValid } = require('date-fns');

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

/**
 * More robust RB2B message parser.
 * Prioritizes parsing structured blocks if available.
 * Uses flexible matching for text parsing.
 * Attempts multiple date formats.
 *
 * @param {Object} event - The Slack message event object (containing text and/or blocks)
 * @returns {Object|null} - Parsed visitor data or null if essential info (like name/company) is missing
 */
function parseRB2BMessageEnhanced(event) {
  if (!event) {
    console.warn('[slackEvents] No event provided to parseRB2BMessageEnhanced');
    return null;
  }

  let visitor = {};

  // --- Strategy 1: Parse from Blocks (if available) ---
  if (event.blocks && event.blocks.length > 0) {
    console.log('[slackEvents] Attempting to parse from Slack Blocks structure.');
    try {
      visitor = parseFromBlocks(event.blocks);
      console.log('[slackEvents] Parsed from blocks:', visitor);
    } catch (err) {
      console.warn('[slackEvents] Error parsing from blocks, falling back to text. Error:', err);
      visitor = {}; // Reset if block parsing failed partially
    }
  }

  // --- Strategy 2: Parse from Text (Fallback or primary if no blocks) ---
  if (!visitor.name && event.text) {
    console.log('[slackEvents] Parsing from text content.');
    try {
      const textVisitor = parseFromText(event.text);
      visitor = { ...visitor, ...textVisitor };
      console.log('[slackEvents] Parsed from text:', textVisitor);
    } catch (err) {
      console.error('[slackEvents] Error parsing from text:', err);
    }
  }

  // --- Final Validation & ID Generation ---
  if (!visitor.name && !visitor.company) {
    console.warn('[slackEvents] Parsing failed to find essential fields (Name/Company) in event:', event.ts);
    return null;
  }

  // Generate ID
  visitor.visitorId = visitor.email
    ? `email-${visitor.email.split('@')[0]}`
    : `name-${(visitor.name || 'unknown').toLowerCase().replace(/\s+/g, '-')}-company-${(visitor.company || 'unknown').toLowerCase().replace(/\s+/g, '-')}`;

  // Ensure lastSeen is always set/updated
  visitor.lastSeen = new Date();

  // Default firstSeen if not parsed
  if (!visitor.firstSeen) {
    visitor.firstSeen = visitor.lastSeen;
  }

  return visitor;
}

// --- Helper Function: Parse from Blocks ---
function parseFromBlocks(blocks) {
  const visitor = {};
  const fieldMappings = {
    [/^name$/i]: 'name',
    [/^title|job title$/i]: 'title',
    [/^company$/i]: 'company',
    [/^email$/i]: 'email',
    [/^linkedin$/i]: 'linkedin',
    [/^location|loc$/i]: 'location',
    [/^website$/i]: 'website',
    [/^industry$/i]: 'industry',
    [/^employees|est\.?\s+employees|employee count$/i]: 'employees',
    [/^revenue|est\.?\s+revenue|estimated revenue$/i]: 'revenue'
  };

  for (const block of blocks) {
    if (block.type === 'section' && block.fields) {
      for (const field of block.fields) {
        const text = field.text || '';
        const match = text.match(/^\*?(.+?)\*?:\s*\n?([\s\S]+)/);
        if (match) {
          const keyText = match[1].trim();
          let valueText = match[2].trim();

          for (const [regex, visitorKey] of Object.entries(fieldMappings)) {
            if (regex.test(keyText)) {
              if (visitorKey === 'linkedin') {
                const urlMatch = valueText.match(/https?:\/\/[^\s]+/);
                visitor[visitorKey] = urlMatch ? urlMatch[0] : valueText;
              } else if (visitorKey === 'email' && valueText.includes('---')) {
                // Skip placeholder emails
              } else {
                visitor[visitorKey] = valueText;
              }
              break;
            }
          }
        }
      }
    }
    // Handle context blocks for dates and page counts
    if (block.type === 'context' && block.elements) {
      const contextText = block.elements.map(el => el.text).join(' ');
      parseVisitInfo(contextText, visitor);
      parsePageCount(contextText, visitor);
    }
  }
  return visitor;
}

// --- Helper Function: Parse from Text ---
function parseFromText(text) {
  if (!text) return {};

  // Normalize line breaks and remove markdown emphasis
  text = text.replace(/\\n/g, '\n').replace(/\*\*/g, '');

  const visitor = {};
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

  const keyMappings = {
    name: /^\*?\s*name\s*$/i,
    title: /^\*?\s*title\s*$/i,
    company: /^\*?\s*company\s*$/i,
    email: /^\*?\s*email\s*$/i,
    linkedin: /^\*?\s*linkedin\s*$/i,
    location: /^\*?\s*location\s*$/i,
    website: /^\*?\s*website\s*$/i,
    industry: /^\*?\s*industry\s*$/i,
    employees: /^\*?\s*est\.?\s+employees\s*$/i,
    revenue: /^\*?\s*est\.?\s+revenue\s*$/i
  };

  let inAboutSection = false;
  let aboutCompanyName = null;

  lines.forEach(line => {
    // Check for "About CompanyName" section start
    const aboutMatch = line.match(/^About\s+(.+)/i);
    if (aboutMatch) {
      inAboutSection = true;
      aboutCompanyName = aboutMatch[1].trim();
      visitor.aboutName = aboutCompanyName;
      return;
    }

    // Basic Key-Value Regex
    const kvMatch = line.match(/^([\w\s.'-]+?)\s*:\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let value = kvMatch[2].trim();

      // Find corresponding visitor field key
      let targetField = null;
      for (const field in keyMappings) {
        if (keyMappings[field].test(key)) {
          targetField = field;
          break;
        }
      }

      if (targetField) {
        if (targetField === 'linkedin') {
          const urlMatch = value.match(/https?:\/\/[^\s>]+/);
          value = urlMatch ? urlMatch[0] : value;
        } else if (targetField === 'email' && value.includes('---')) {
          value = null;
        }

        if (value !== null) {
          visitor[targetField] = value;
        }
      } else if (!inAboutSection) {
        console.warn(`[slackEvents] Unmapped key found in text: "${key}"`);
      }
    } else {
      parseVisitInfo(line, visitor);
      parsePageCount(line, visitor);
    }
  });

  return visitor;
}

// --- Helper Function: Parse Visit Info (Date) ---
function parseVisitInfo(textLine, visitor) {
  if (visitor.firstSeen) return;

  const visitPatterns = [
    {
      regex: /(?:First identified|has visited).*?(?:on|since)\s+(.*?)(?:\s+View details|$)/i,
      formats: [
        "MMMM d, yyyy 'at' h:mma xxx",
        "MMMM d, yyyy h:mma xxx",
        "MMM d, yyyy h:mma xxx",
        "yyyy-MM-dd'T'HH:mm:ssxxx",
        "yyyy-MM-dd HH:mm:ss",
        "MM/dd/yyyy h:mma"
      ]
    }
  ];

  for (const pattern of visitPatterns) {
    const match = textLine.match(pattern.regex);
    if (match && match[1]) {
      const dateString = match[1].trim();
      for (const fmt of pattern.formats) {
        try {
          const parsedDate = parse(dateString, fmt, new Date());
          if (isValid(parsedDate)) {
            visitor.firstSeen = parsedDate;
            console.log(`[slackEvents] Parsed firstSeen date: ${parsedDate} using format "${fmt}" from string "${dateString}"`);
            return;
          }
        } catch (e) { /* Ignore parsing error for this format */ }
      }
      console.warn(`[slackEvents] Failed to parse date string "${dateString}" with known formats.`);
    }
  }
}

// --- Helper Function: Parse Page Count ---
function parsePageCount(textLine, visitor) {
  if (visitor.pageCount !== undefined) return;

  const pagesMatch = textLine.match(/has visited (\d+) pages/i);
  if (pagesMatch && pagesMatch[1]) {
    visitor.pageCount = parseInt(pagesMatch[1], 10);
  }
}

// Helper: Send to your OnePgr leads endpoint
async function sendToLeadsAPI(visitor) {
  const form = new FormData();
  form.append('onepgr_apicall',        '1');
  form.append('name',                  visitor.name);
  form.append('email',                 visitor.email);
  form.append('page_id',               process.env.ONEPGR_PAGE_ID);
  form.append('phone',                 visitor.phone || '');
  form.append('company',               visitor.company);
  form.append('comment',               visitor.comment || '');
  form.append('campaign_id',           process.env.ONEPGR_CAMPAIGN_ID);
  form.append('queue_token',           process.env.ONEPGR_QUEUE_TOKEN);
  form.append('appt_event',            (visitor.firstSeen || new Date()).toISOString());
  form.append('Linkedin',              visitor.linkedin);
  form.append('source_type',           'slack');
  form.append('source_name',           process.env.SLACK_TARGET_CHANNEL_ID);
  form.append('slack_org_name',        process.env.SLACK_ORG_NAME);

  const headers = {
    ...form.getHeaders(),
    'Accept':                   'application/json',
    'gateway_type':             process.env.ONEPGR_GATEWAY_TYPE,
    'gateway_owner_token':      process.env.ONEPGR_OWNER_TOKEN,
    'gateway_destination_token':process.env.ONEPGR_DEST_TOKEN,
    'Cookie':                   'visits=3',
  };

  const url = `${process.env.ONEPGR_LEADS_URL}?xhr_flag=1`;

  try {
    const resp = await axios.post(url, form, { headers });
    console.log('[slackEvents] Lead API response:', resp.data);
    return resp.data;
  } catch (err) {
    console.error('[slackEvents] Lead API error:', err.response?.data || err.message);
    // don't rethrow—failure to notify leads API shouldn't crash your Slack handler
  }
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
  if (event.channel !== CHANNEL_ID) {
    console.log('[slackEvents] Skipping message from different channel:', event.channel);
    return;
  }

  // Must be a message
  if (event.type !== 'message') {
    console.log('[slackEvents] Skipping non-message event:', event.type);
    return;
  }

  // Accept messages from RB2B (either via bot_id or username pattern)
  const isRB2BMessage =
    event.bot_id === RB2B_BOT_ID ||
    (event.username && event.username.toLowerCase().includes('rb2b')) ||
    /(REPEAT VISITOR SIGNAL|About \w+)/.test(event.text);

  if (!isRB2BMessage) {
    console.log('[slackEvents] Not an RB2B message:', {
      bot_id: event.bot_id,
      username: event.username,
      text: event.text?.substring(0, 50)
    });
    return;
  }

  // If RB2B uses blocks, reconstruct text for logging/fallback, but prioritize blocks for parsing
  if (event.blocks) {
    console.log('[slackEvents] RB2B Blocks Structure:', JSON.stringify(event.blocks, null, 2));
    // Reconstruct text from blocks *only if needed* as a fallback or for logging
    if (!event.text) {
      event.text = event.blocks
        .map(block => {
          if (block.type === 'section' && block.text) return block.text.text;
          if (block.type === 'context' && block.elements) return block.elements.map(el => el.text).join(' ');
          return '';
        })
        .join('\n');
    }
  }

  try {
    // Pass the whole event object to the enhanced parser
    const visitor = parseRB2BMessageEnhanced(event);

    // Check if parser returned a valid visitor object
    if (!visitor || !visitor.visitorId) {
      console.warn('[slackEvents] Skipping event - parser did not return a valid visitor object with ID. Event TS:', event.ts);
      return;
    }

    // Update database with parsed visitor data
    await Visitor.findOneAndUpdate(
      { visitorId: visitor.visitorId },
      {
        $set: visitor,
        $setOnInsert: { firstSeen: visitor.firstSeen }
      },
      { upsert: true, new: true }
    );

    console.log(`[slackEvents] Processed visitor: ${visitor.name || 'Unknown'} from ${visitor.company || 'Unknown'} (ID: ${visitor.visitorId})`);

    // Call the OnePgr leads endpoint
    await sendToLeadsAPI(visitor);

  } catch (err) {
    console.error('[slackEvents] Processing error for event TS:', event.ts, err);
  }
});

module.exports = {
  router,
  postVisitorToSlack
};
