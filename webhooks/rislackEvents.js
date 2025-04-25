// slackEvents.js
const express = require('express');
const crypto  = require('crypto');

const router = express.Router();

// ─── Config ────────────────────────────────────────────────────────────────
const SLACK_SIGNING_SECRET   = process.env.SLACK_SIGNING_SECRET;
const TARGET_CHANNEL_ID      = process.env.SLACK_TARGET_CHANNEL_ID; 
// e.g. C0123456789 for #rb2b-hp-recorded-int

if (!SLACK_SIGNING_SECRET) {
  console.error('Missing SLACK_SIGNING_SECRET');
}
if (!TARGET_CHANNEL_ID) {
  console.error('Missing SLACK_TARGET_CHANNEL_ID');
}

// ─── Middleware: raw body + JSON parse ──────────────────────────────────────
router.use(express.json({
  verify(req, res, buf) { req.rawBody = buf; }
}));

// ─── Middleware: verify Slack signature & timestamp ─────────────────────────
router.use((req, res, next) => {
  try {
    const sig    = req.headers['x-slack-signature'];
    const ts     = req.headers['x-slack-request-timestamp'];
    if (!sig || !ts) {
      console.warn('Slack headers missing');
      return res.status(400).send('Bad request');
    }

    // replay protection (5 min window)
    const now = Math.floor(Date.now()/1000);
    if (Math.abs(now - Number(ts)) > 300) {
      console.warn('Stale Slack request:', now - Number(ts), 'seconds old');
      return res.status(400).send('Stale request');
    }

    // build signature
    const base   = `v0:${ts}:${req.rawBody.toString('utf8')}`;
    const myHash = `v0=${crypto.createHmac('sha256', SLACK_SIGNING_SECRET)
                         .update(base)
                         .digest('hex')}`;

    if (!crypto.timingSafeEqual(
      Buffer.from(myHash, 'utf8'),
      Buffer.from(sig,    'utf8')
    )) {
      console.warn(' Invalid Slack signature');
      return res.status(401).send('Invalid signature');
    }

    next();
  } catch (err) {
    console.error(' Error verifying Slack request:', err);
    return res.status(500).send('Internal error');
  }
});

// ─── Main handler ───────────────────────────────────────────────────────────
router.post('/webhooks/rb2b-ri-visitors', (req, res) => {
  try {
    const { type, challenge, event } = req.body;
    console.info('  Received Slack payload of type:', type);

    // 1) URL verification handshake
    if (type === 'url_verification') {
      console.info(' Replying to URL verification challenge');
      return res.json({ challenge });
    }

    // 2) Acknowledge all other events immediately so Slack stops retrying
    res.sendStatus(200);

    // 3) Make sure we have an event
    if (!event) {
      console.warn('  No event object in payload');
      return;
    }

    // 4) Only process events from our RB2B channel
    if (event.channel !== TARGET_CHANNEL_ID) {
      console.info(`Ignoring event from channel ${event.channel}`);
      return;
    }

    // 5) Dispatch by event.type
    console.info(` Handling event.type = ${event.type}`);
    switch (event.type) {
      case 'message':
        console.info(' New message text:', event.text);
        // ► your visitor-profile parsing & persistence here  
        break;

      case 'reaction_added':
        console.info(' Reaction added:', event.reaction);
        // ► maybe track engagement  
        break;

      case 'app_mention':
        console.info(' App mentioned with text:', event.text);
        // ► handle direct pings  
        break;

      default:
        console.info(' Unhandled event type:', event.type);
    }

  } catch (err) {
    // catch everything so the process never crashes
    console.error(' Error in Slack events handler:', err);
  }
});

module.exports = router;
