

const express    = require('express');
const bodyParser = require('body-parser');
const crypto     = require('crypto');

const router = express.Router();

// ─── Configuration ─────────────────────────────────────────────────────────
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const CHANNEL_ID     = process.env.SLACK_TARGET_CHANNEL_ID; 
// e.g. C0123456789 for #rb2b-hp-recorded-int

if (!SIGNING_SECRET) {
  console.log('  Missing required env var SLACK_SIGNING_SECRET');
}
if (!CHANNEL_ID) {
  console.log('  Missing required env var SLACK_TARGET_CHANNEL_ID');
}

// ─── 1) Health‐check (Slack’s UI “Retry” does a GET) ─────────────────────────
router.get('/slack/rb2b-ri-visitors', (_req, res) => {
  res.send('OK');
});

// ─── 2) Main Events POST ────────────────────────────────────────────────────
router.post(
  '/slack/rb2b-ri-visitors',

  // A) grab raw body for signature verification
  bodyParser.raw({ type: 'application/json' }),

  // B) verify Slack signature & timestamp
  (req, res, next) => {
    const slackSig = req.headers['x-slack-signature'];
    const slackTs  = req.headers['x-slack-request-timestamp'];
    if (!slackSig || !slackTs) {
      console.warn('⚠️  Missing Slack signature headers on POST');
      return res.status(400).send('Bad request');
    }

    // prevent replay attacks (5-minute window)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(slackTs)) > 300) {
      console.warn('⚠️  Stale Slack request:', now - Number(slackTs), 'seconds old');
      return res.status(400).send('Stale request');
    }

    // reconstruct Slack’s signing base string
    const base = `v0:${slackTs}:${req.body.toString('utf8')}`;
    const myHash = 'v0=' + crypto
      .createHmac('sha256', SIGNING_SECRET)
      .update(base)
      .digest('hex');

    if (!crypto.timingSafeEqual(
      Buffer.from(myHash, 'utf8'),
      Buffer.from(slackSig, 'utf8')
    )) {
      console.warn('⚠️  Invalid Slack signature');
      return res.status(401).send('Invalid signature');
    }

    // signature verified
    next();
  },

  // C) handle the event
  (req, res) => {
    let body;
    try {
      body = JSON.parse(req.body.toString('utf8'));
    } catch (err) {
      console.error('❌ Failed to parse Slack JSON body', err);
      return res.sendStatus(400);
    }

    const { type, challenge, event } = body;
    console.info('[SlackEvent] payload type=', type);

    // 1) URL verification handshake
    if (type === 'url_verification') {
      console.info('[SlackEvent] responding to challenge');
      // echo the raw challenge string **exactly**
      return res.send(challenge);
    }

    // 2) Acknowledge receipt so Slack stops retrying
    res.sendStatus(200);

    // 3) guard: must have an event
    if (!event) {
      console.warn('[SlackEvent] no event object');
      return;
    }

    // 4) only process our RB2B channel
    if (event.channel !== CHANNEL_ID) {
      console.info(`[SlackEvent] ignoring channel ${event.channel}`);
      return;
    }

    // 5) dispatch by type
    switch (event.type) {
      case 'message':
        console.info('[SlackEvent] message text:', event.text);
        // ► parse & persist your visitor-profile here
        break;

      case 'reaction_added':
        console.info('[SlackEvent] reaction added:', event.reaction);
        break;

      case 'app_mention':
        console.info('[SlackEvent] app mentioned:', event.text);
        break;

      default:
        console.info('[SlackEvent] unhandled event type:', event.type);
    }
  }
);

module.exports = router;
