// webhooks/slackEvents.js
const express = require('express');
const crypto = require('crypto');

const router = express.Router();

// ─── Config ───────────────────────────────────────────────────────────────
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const CHANNEL_ID = process.env.SLACK_TARGET_CHANNEL_ID;

if (!SIGNING_SECRET) {
  console.error('⚠️  Missing SLACK_SIGNING_SECRET');
}
if (!CHANNEL_ID) {
  console.error('⚠️  Missing SLACK_TARGET_CHANNEL_ID');
}

// Log environment variables for debugging
console.info('[SlackEvent] Environment:', {
  SIGNING_SECRET: SIGNING_SECRET ? 'present' : 'missing',
  CHANNEL_ID: CHANNEL_ID || 'missing'
});

// Define raw body middleware separately for better control
const rawBodyMiddleware = express.raw({ 
  type: 'application/json',
  verify: (req, _res, buf, encoding) => {
    if (buf && buf.length) {
      req.rawBody = buf.toString(encoding || 'utf8');
    }
  }
});

// ─── Health-check GET ──────────────────────────────────────────────────────
router.get('/slack/rb2b-ri-visitors', (_req, res) => {
  console.info('[SlackEvent] GET /webhooks/rb2b-ri-visitors → OK');
  res.send('OK');
});

// ─── Main POST: raw → verify → handle ───────────────────────────────────────
router.post(
  '/slack/rb2b-ri-visitors',

  // A) Capture raw body for HMAC - apply as first middleware
  rawBodyMiddleware,

  // B) Signature & timestamp validation
  (req, res, next) => {
    const ts = req.headers['x-slack-request-timestamp'];
    const sig = req.headers['x-slack-signature'];
    
    // Ensure we have the raw body
    if (!req.rawBody) {
      console.error('❌ Missing rawBody');
      console.debug('[DEBUG] Headers:', req.headers);
      console.debug('[DEBUG] Body type:', typeof req.body);
      return res.status(400).send('Bad request: Missing raw body');
    }
    
    // Debug logging
    console.info('[SlackEvent] Incoming POST:', { 
      ts, 
      sig, 
      rawBodyLength: req.rawBody?.length,
      rawBodyPreview: req.rawBody?.substring(0, 100) 
    });

    if (!ts || !sig) {
      console.warn('⚠️  Missing Slack headers');
      return res.status(400).send('Bad request');
    }

    // 5-minute replay window
    const age = Math.floor(Date.now() / 1000) - Number(ts);
    if (Math.abs(age) > 300) {
      console.warn(`⚠️  Stale request (${age}s old)`);
      return res.status(400).send('Stale request');
    }

    // Recompute signature using the raw body
    const base = `v0:${ts}:${req.rawBody}`;
    const myHash = 'v0=' + crypto
      .createHmac('sha256', SIGNING_SECRET)
      .update(base)
      .digest('hex');

    console.info('[SlackEvent] Received signature:', sig);
    console.info('[SlackEvent] Computed signature:', myHash);

    // Use Buffer comparison for consistent length comparison
    try {
      if (!crypto.timingSafeEqual(
        Buffer.from(myHash, 'utf8'),
        Buffer.from(sig, 'utf8')
      )) {
        console.warn('⚠️  Invalid signature');
        return res.status(401).send('Invalid signature');
      }
    } catch (error) {
      console.error('❌ Error comparing signatures:', error.message);
      return res.status(401).send('Signature verification error');
    }

    next();
  },

  // C) Parse & dispatch
  (req, res) => {
    let payload;
    try {
      payload = JSON.parse(req.rawBody);
    } catch (e) {
      console.error('❌  JSON parse error:', e);
      return res.sendStatus(400);
    }

    const { type, challenge, event } = payload;
    console.info('[SlackEvent] payload type =', type);

    // 1) URL verification
    if (type === 'url_verification') {
      console.info('[SlackEvent] Received URL verification challenge:', challenge);
      // Respond with plain text
      res.setHeader('Content-Type', 'text/plain');
      return res.send(challenge);
    }

    // 2) Acknowledge real events so Slack stops retrying
    res.sendStatus(200);

    // 3) Guard: ensure event object present
    if (!event) {
      console.warn('[SlackEvent] No event in payload');
      return;
    }

    // 4) Only process messages from our RB2B channel
    if (event.channel !== CHANNEL_ID) {
      console.info(`[SlackEvent] Ignoring channel ${event.channel}`);
      return;
    }

    // 5) Dispatch by event type
    switch (event.type) {
      case 'message':
        console.info('[SlackEvent] Message:', event.text);
        // …persist visitor-profile here…
        break;
      case 'reaction_added':
        console.info('[SlackEvent] Reaction added:', event.reaction);
        break;
      case 'app_mention':
        console.info('[SlackEvent] App mentioned with:', event.text);
        break;
      default:
        console.info('[SlackEvent] Unhandled event type:', event.type);
    }
  }
);

module.exports = router;
