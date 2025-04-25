const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');

// MongoDB connection
mongoose.connect(process.env.ONEPGR_MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  dbName: 'onepgr_apps'
});

// Define visitor schema
const VisitorSchema = new mongoose.Schema({
  slackId: { type: String, unique: true },
  name: String,
  title: String,
  company: String,
  email: String,
  linkedin: String,
  location: String,
  pageCount: Number,
  firstSeen: Date,
  lastSeen: Date,
});

// Create Visitor model using 'slack_ri_events' collection
const Visitor = mongoose.model('Visitor', VisitorSchema, 'slack_ri_events');

const router = express.Router();
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const CHANNEL_ID = process.env.SLACK_TARGET_CHANNEL_ID;

// Health-check
router.get('/slack/rb2b-ri-visitors', (_req, res) => {
  res.send('OK');
});

router.post('/slack/rb2b-ri-visitors', (req, res, next) => {
  const ts = req.headers['x-slack-request-timestamp'];
  const sig = req.headers['x-slack-signature'];
  const raw = req.body;         // <-- Buffer now

  if (!raw || !Buffer.isBuffer(raw)) {
    console.error('❌ Missing raw body buffer');
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
  } catch (err) {
    console.error('❌ JSON parse error:', err);
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

  // …and then handle your events…
  const { event } = payload;
  if (!event) return;
  if (event.channel !== CHANNEL_ID) return;

  // Store event in database
  try {
    if (event.type === 'message' && event.user) {
      // Update or create visitor record
      Visitor.findOneAndUpdate(
        { slackId: event.user },
        {
          $set: {
            lastSeen: new Date()
          },
          $setOnInsert: {
            slackId: event.user,
            firstSeen: new Date(),
            pageCount: 1
          },
          $inc: {
            pageCount: 0  // Only increment on first creation due to $setOnInsert
          }
        },
        { upsert: true, new: true }
      ).catch(err => console.error('Error storing visitor event:', err));
    }
  } catch (dbError) {
    console.error('Database error:', dbError);
  }

  switch (event.type) {
    case 'message':
      console.log('[SlackEvent] Message:', event.text);
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
