// slackEvents.js
const express = require('express');
const crypto = require('crypto');

const router = express.Router();

// ─── Config ───────────────────────────────────────────────────────────────
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const TARGET_CHANNEL = process.env.SLACK_TARGET_CHANNEL_ID;
if (!SIGNING_SECRET) console.error('⚠️ Missing SLACK_SIGNING_SECRET');
if (!TARGET_CHANNEL) console.error('⚠️ Missing SLACK_TARGET_CHANNEL_ID');

// ─── Body + Raw capture ────────────────────────────────────────────────────
router.use(express.json({
  verify(req, res, buf) { req.rawBody = buf; }
}));

// ─── Verify Slack signature & timestamp ────────────────────────────────────
router.use((req, res, next) => {
  const sig = req.headers['x-slack-signature'];
  const ts = req.headers['x-slack-request-timestamp'];
  if (!sig || !ts) {
    console.warn('Missing Slack headers');
    return res.status(400).send('Bad request');
  }

  // replay protection
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > 300) {
    console.warn('Stale Slack request');
    return res.status(400).send('Stale request');
  }

  // recreate signature
  const base = `v0:${ts}:${req.rawBody.toString('utf8')}`;
  const myHash = 'v0='
    + crypto.createHmac('sha256', SIGNING_SECRET)
      .update(base)
      .digest('hex');

  if (!crypto.timingSafeEqual(
    Buffer.from(myHash, 'utf8'),
    Buffer.from(sig, 'utf8')
  )) {
    console.warn('Invalid Slack signature');
    return res.status(401).send('Invalid signature');
  }
  next();
});

// ─── Main handler ──────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const { type, challenge, event } = req.body;
    console.info('[SlackEvent] type=', type);

    // 1) URL verification
    if (type === 'url_verification') {
      console.info('[SlackEvent] responding to URL verification');
      // **IMPORTANT**: echo the raw challenge string
      return res.send(challenge);
    }

    // 2) Acknowledge callback
    res.sendStatus(200);

    // 3) Validate event object
    if (!event) {
      console.warn('[SlackEvent] no event object');
      return;
    }

    // 4) Only handle our target channel
    if (event.channel !== TARGET_CHANNEL) {
      console.info(`[SlackEvent] skipping channel ${event.channel}`);
      return;
    }

    // 5) Dispatch on event.type
    console.info(`[SlackEvent] event.type=${event.type}`);
    switch (event.type) {
      case 'message':
        console.info('[SlackEvent] message:', event.text);
        // ← parse & persist your visitor here
        break;

      case 'reaction_added':
        console.info('[SlackEvent] reaction:', event.reaction);
        break;

      case 'app_mention':
        console.info('[SlackEvent] mention:', event.text);
        break;

      default:
        console.info('[SlackEvent] unhandled type:', event.type);
    }
  } catch (err) {
    console.error('[SlackEvent] handler error:', err);
  }
});

module.exports = router;
