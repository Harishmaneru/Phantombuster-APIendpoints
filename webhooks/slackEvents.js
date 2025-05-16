// webhooks/slackEvents.js

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');
const { parse, isValid } = require('date-fns');

// ─── Environment & Constants ────────────────────────────────────────────────
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

// Defensive JSON parsing for environment variables
function parseEnvJson(jsonString) {
  try {
    // First try direct parse
    return JSON.parse(jsonString);
  } catch (e) {
    try {
      // If that fails, try to fix common JSON formatting issues
      return JSON.parse(jsonString.replace(/(\w+):/g, '"$1":'));
    } catch (e2) {
      console.error('[slackEvents] Failed to parse JSON from env:', jsonString);
      console.error('[slackEvents] Parse error:', e2.message);
      return {};
    }
  }
}

const RB2B_CHANNEL_BOT_MAP = parseEnvJson(process.env.RB2B_CHANNEL_BOT_MAP || '{}');
const RB2B_CHANNEL_NAME_MAP = parseEnvJson(process.env.RB2B_CHANNEL_NAME_MAP || '{}');

// Log the parsed maps for debugging
// console.log('[slackEvents] Parsed channel bot map:', RB2B_CHANNEL_BOT_MAP);
// console.log('[slackEvents] Parsed channel name map:', RB2B_CHANNEL_NAME_MAP);

const ONEPGR_URL = process.env.ONEPGR_LEADS_URL + '?xhr_flag=1';
const PAGE_ID = process.env.ONEPGR_PAGE_ID;
const CAMPAIGN_ID = process.env.ONEPGR_CAMPAIGN_ID;
const QUEUE_TOKEN = process.env.ONEPGR_QUEUE_TOKEN;
const GATEWAY_TYPE = process.env.ONEPGR_GATEWAY_TYPE;
const OWNER_TOKEN = process.env.ONEPGR_OWNER_TOKEN;
const DEST_TOKEN = process.env.ONEPGR_DEST_TOKEN;
const ORG_NAME = process.env.SLACK_ORG_NAME;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Parse everything out of Slack's Blocks payload */
function parseFromBlocks(blocks) {
  const v = {};

  // 1) Header → "Name from Company"
  const header = blocks.find(b => b.type === 'header');
  if (header) {
    const m = header.text.text.match(/^(.*) from (.*)$/);
    if (m) { v.name = m[1]; v.company = m[2]; }
  }

  // 2) Main info section (Name, Title, Company, Email, LinkedIn, Location)
  const info = blocks.find(b =>
    b.type === 'section' && b.text?.text.includes('*Name*')
  );
  if (info) {
    info.text.text
      .replace(/\*/g, '')
      .split('\n')
      .map(l => l.trim()).filter(Boolean)
      .forEach(line => {
        const [rk, ...r] = line.split(/\s*:\s*/);
        const key = rk.toLowerCase(), val = r.join(':').trim();
        switch (key) {
          case 'name': v.name = val; break;
          case 'title': v.title = val; break;
          case 'company': v.company = val; break;
          case 'email':
            if (!/^\*+@+\*+$/.test(line)) v.email = val;
            break;
          case 'linkedin': v.linkedin = val; break;
          case 'location': v.location = val; break;
        }
      });
  }

  // 3) About section → website, employees, industry, revenue
  const about = blocks.find(b => b.type === 'section' && Array.isArray(b.fields));
  if (about) {
    about.fields.forEach(f => {
      const text = f.text.replace(/\*/g, '').trim();
      const [rk, ...r] = text.split(/\s*:\s*/);
      const key = rk.toLowerCase(), val = r.join(':').trim();
      if (key.startsWith('website')) v.website = val;
      else if (key.includes('employee')) v.employees = val;
      else if (key.includes('industry')) v.industry = val;
      else if (key.includes('revenue')) v.revenue = val;
    });
  }

  // 4) Context → firstSeen & pageCount
  const ctx = blocks.find(b => b.type === 'context');
  if (ctx) {
    const raw = ctx.elements.map(e => e.text).join(' ').replace(/\*/g, '');
    const m = raw.match(/(?:First identified|has visited).*?(?:on|since)\s+(.+?)(?:\s|$)/i);
    if (m?.[1]) {
      // parse exactly "May 01, 2025 at 08:04AM EST"
      const dt = parse(m[1].trim(),
        "MMMM dd, yyyy 'at' hh:mma 'EST'",
        new Date());
      if (isValid(dt)) v.firstSeen = dt;
      else console.warn('[slackEvents] Date parse failed on', m[1]);
    }
    const pc = raw.match(/visited\s+(\d+)\s+pages/i);
    if (pc) v.pageCount = Number(pc[1]);
  }

  return v;
}

/** POST to your OnePgr leads endpoint */
async function sendToLeadsAPI(visitor, rawMessage, friendlyChannel) {
  console.log('[slackEvents] Starting sendToLeadsAPI with visitor:', visitor);
  const params = {
    onepgr_apicall: '1',
    name: visitor.name,
    title: visitor.title,
    company: visitor.company,
    email: visitor.email,
    Linkedin: visitor.linkedin,
    location: visitor.location,
    aboutName: visitor.aboutName,
    website: visitor.website,
    employees: visitor.employees,
    industry: visitor.industry,
    revenue: visitor.revenue,
    page_id: PAGE_ID,
    phone: visitor.phone,
    comment: rawMessage || visitor.comment || '',
    campaign_id: CAMPAIGN_ID,
    queue_token: QUEUE_TOKEN,
    appt_event: (visitor.firstSeen || new Date()).toISOString(),
    source_type: 'slack',
    source_name: friendlyChannel,
    slack_org_name: ORG_NAME
  };

  console.log('[slackEvents] ⏵ OnePgr lead payload:', params);
  console.log('[slackEvents] ONEPGR_URL:', ONEPGR_URL);
  const form = new FormData();
  Object.entries(params).forEach(([k, v]) => form.append(k, v || ''));

  const headers = {
    ...form.getHeaders(),
    'Accept': 'application/json',
    'gateway_type': GATEWAY_TYPE,
    'gateway_owner_token': OWNER_TOKEN,
    'gateway_destination_token': DEST_TOKEN,
    'Cookie': 'visits=3'
  };
  console.log('[slackEvents] Making API request to Create leads API...');
  try {
    const { data } = await axios.post(ONEPGR_URL, form, { headers });
    console.log('[slackEvents] Lead API response:', data);
  } catch (err) {
    console.error('[slackEvents] Lead API error:', err.response?.data || err.message);
    console.error('[slackEvents] Full error:', err);
  }
}

// ─── Router ─────────────────────────────────────────────────────────────────
const router = express.Router();

// Health check
router.get('/', (_req, res) => res.send('OK'));

// Slack Events endpoint
router.post(
  '/',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    // ─── 1) Signature & replay check ─────────────────────────────
    const ts = req.headers['x-slack-request-timestamp'];
    const sig = req.headers['x-slack-signature'];
    if (!ts || !sig || Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
      return res.status(400).send('Bad request');
    }
    const base = `v0:${ts}:${req.body.toString('utf8')}`;
    const myH = 'v0=' + crypto
      .createHmac('sha256', SIGNING_SECRET)
      .update(base).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(myH), Buffer.from(sig))) {
      return res.status(401).send('Invalid signature');
    }

    // ─── 2) Parse JSON ────────────────────────────────────────────
    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch (e) {
      return res.status(400).send('Invalid JSON');
    }

    // ─── 3) URL verification ──────────────────────────────────────
    if (payload.type === 'url_verification') {
      res.set('Content-Type', 'text/plain');
      return res.send(payload.challenge);
    }

    // ─── 4) Acknowledge Slack immediately ────────────────────────
    res.sendStatus(200);

    // ─── 5) Logging raw payload & headers ────────────────────────
    console.log('────────────────────────────────────────');
    console.log('[slackEvents] Full incoming Slack payload:\n',
      JSON.stringify(payload, null, 2));
    console.log('[slackEvents] Request headers:\n',
      JSON.stringify(req.headers, null, 2));
    console.log('────────────────────────────────────────');

    // ─── 6) Filter to the one channel / bot_message ──────────────
    // Debug: log channel and bot information before filtering
    console.log(
      `[slackEvents] channel=${payload.event.channel}, bot_id=${payload.event.bot_id}, ` +
      `channel_bot_map=${JSON.stringify(RB2B_CHANNEL_BOT_MAP)}`
    );
    const { event } = payload;
    if (!event || event.type !== 'message' || event.subtype !== 'bot_message')
      return;

    const expectedBotId = RB2B_CHANNEL_BOT_MAP[event.channel];
    const friendlyChannel = RB2B_CHANNEL_NAME_MAP[event.channel];

    if (!expectedBotId || event.bot_id !== expectedBotId) {
      console.log(`[slackEvents] Skipping - channel ${event.channel} bot ${event.bot_id} not in map`);
      return;
    }

    if (!friendlyChannel) {
      console.log(`[slackEvents] Warning - no friendly name for channel ${event.channel}`);
    }

    // ─── 7) Parse & forward ──────────────────────────────────────
    try {
      // Get the raw text or blocks JSON as a fallback
      const rawMessage = event.text || (event.blocks ? JSON.stringify(event.blocks) : '');
      console.log('[slackEvents] Raw message content:', rawMessage.substring(0, 150) + '...');

      // Still try to parse critical fields while keeping raw data
      const visitor = parseFromBlocks(event.blocks || []);
      if (!visitor.name && !visitor.company) {
        console.warn('[slackEvents] no visitor fields found, but forwarding raw message');
      }
      console.log('[slackEvents] visitor parsed:', visitor);

      // Send both parsed fields AND raw message with friendly channel name
      await sendToLeadsAPI(visitor, rawMessage, friendlyChannel);
    } catch (err) {
      console.error('[slackEvents] handler error:', err);
    }
  }
);

console.log('[slackEvents] Server started with environment:', {
  hasOnepgrUrl: !!process.env.ONEPGR_LEADS_URL,
  hasPageId: !!process.env.ONEPGR_PAGE_ID,
  hasCampaignId: !!process.env.ONEPGR_CAMPAIGN_ID,
  hasQueueToken: !!process.env.ONEPGR_QUEUE_TOKEN
});

module.exports = { router };
