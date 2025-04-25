// webhooks/slackEvents.js

const express = require('express');
const crypto  = require('crypto');

const router = express.Router();

router.get('/slack/rb2b-ri-visitors', (_req, res) => res.send('OK'));

router.post(
  '/slack/rb2b-ri-visitors',

  // ⬅ raw body as Buffer
  express.raw({ type: 'application/json' }),

  // signature & timestamp check
  (req, res, next) => {
    const ts  = req.headers['x-slack-request-timestamp'];
    const sig = req.headers['x-slack-signature'];
    if (!ts || !sig) return res.status(400).send('Bad request');

    // prevent replay
    if (Math.abs(Math.floor(Date.now()/1000) - Number(ts)) > 300) {
      return res.status(400).send('Stale request');
    }

    const text = req.body.toString('utf8');
    const base = `v0:${ts}:${text}`;
    const myHash = 'v0=' + crypto
      .createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
      .update(base)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(myHash), Buffer.from(sig))) {
      return res.status(401).send('Invalid signature');
    }
    next();
  },

  // parse & handle
  (req, res) => {
    const body = JSON.parse(req.body.toString('utf8'));
    const { type, challenge, event } = body;

    if (type === 'url_verification') {
      return res.send(challenge);
    }
    res.sendStatus(200);

    if (event.channel !== process.env.SLACK_TARGET_CHANNEL_ID) return;

    if (event.type === 'message') {
      console.log('Visitor payload:', event.text);
      // …persist your visitor…
    }
  }
);

module.exports = router;
