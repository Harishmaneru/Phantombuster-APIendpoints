// webhooks/slackEvents.js
const express = require('express');
const crypto  = require('crypto');

const router = express.Router();

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const CHANNEL_ID     = process.env.SLACK_TARGET_CHANNEL_ID;

if (!SIGNING_SECRET)  console.error('⚠️ Missing SLACK_SIGNING_SECRET');
if (!CHANNEL_ID)      console.error('⚠️ Missing SLACK_TARGET_CHANNEL_ID');

// ─── 1) Health-check so Slack’s UI “Retry” (GET) passes ────────────────
router.get('/slack/rb2b-ri-visitors', (_req, res) => {
  res.send('OK');
});

// ─── 2) Raw body + debug logs + signature verification ─────────────────
router.post(
  '/slack/rb2b-ri-visitors',

  // A) Grab the raw body as a Buffer, for any Content-Type
  express.raw({ type: '*/*' }),

  // B) Debug & verify
  (req, res, next) => {
    const ts  = req.headers['x-slack-request-timestamp'];
    const sig = req.headers['x-slack-signature'];
    const bodyText = req.body.toString('utf8');

    console.info('[SlackEvent] headers:', {
      ts, sig
    });
    console.info('[SlackEvent] raw body:', bodyText);

    if (!ts || !sig) {
      console.warn('⚠️ Slack headers missing');
      return res.status(400).send('Bad request');
    }

    // Prevent replay (5-minute window)
    const age = Math.floor(Date.now()/1000) - Number(ts);
    if (Math.abs(age) > 300) {
      console.warn(`⚠️ Stale request (${age}s old)`);
      return res.status(400).send('Stale request');
    }

    // Recreate HMAC
    const base = `v0:${ts}:${bodyText}`;
    const mySig = 'v0=' + crypto
      .createHmac('sha256', SIGNING_SECRET)
      .update(base)
      .digest('hex');

    console.info('[SlackEvent] computed signature:', mySig);

    if (!crypto.timingSafeEqual(
      Buffer.from(mySig, 'utf8'),
      Buffer.from(sig,   'utf8')
    )) {
      console.warn('⚠️ Invalid Slack signature');
      return res.status(401).send('Invalid signature');
    }

    // Passed verification
    next();
  },

  // C) Parse JSON & handle the event
  (req, res) => {
    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch (err) {
      console.error('❌ JSON parse error:', err);
      return res.sendStatus(400);
    }

    const { type, challenge, event } = payload;
    console.info('[SlackEvent] payload type:', type);

    // 1) URL verification handshake
    if (type === 'url_verification') {
      console.info('[SlackEvent] replying to challenge');
      // Must echo *only* the raw challenge text
      return res.send(challenge);
    }

    // 2) Acknowledge so Slack stops retrying
    res.sendStatus(200);

    // 3) Guard: must have an event
    if (!event) {
      console.warn('[SlackEvent] no event object');
      return;
    }

    // 4) Only process YOUR channel
    if (event.channel !== CHANNEL_ID) {
      console.info(`[SlackEvent] ignoring channel ${event.channel}`);
      return;
    }

    // 5) Dispatch by event.type
    switch (event.type) {
      case 'message':
        console.info('[SlackEvent] message text:', event.text);
        // ← parse & persist visitor here
        break;
      case 'reaction_added':
        console.info('[SlackEvent] reaction:', event.reaction);
        break;
      case 'app_mention':
        console.info('[SlackEvent] app_mention:', event.text);
        break;
      default:
        console.info('[SlackEvent] unhandled type:', event.type);
    }
  }
);

module.exports = router;
