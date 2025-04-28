// examples/postVisitorExample.js
require('dotenv').config();
const { WebClient } = require('@slack/web-api');
const { router, postVisitorToSlack } = require('../webhooks/slackEvents');

// Note: we import postVisitorToSlack directly so this script can stand alone.
// The `router` isn’t used here but shows how you’d set it up in your main app.

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

(async () => {
  // build the same payload shape your RB2B cards have
  const text = [
    // ── Top block ────────────────────────────────────────────────
    `Name: Test User`,
    `Title: CTO`,
    `Company: Example Corp`,
    `Email: test@example.com`,
    `LinkedIn: https://linkedin.com/in/testuser`,
    `Location: San Francisco, CA`,
    `visited 5 pages`,
    ``,
    // ── About block ──────────────────────────────────────────────
    `About Example Corp`,
    `Website: https://www.example.com`,
    `Est. Employees: 100-500`,
    `Industry: Software`,
    `Est. Revenue: $10M - $50M`
  ].join('\n');

  try {
    // this will post as your Bot User into the target channel
    const res = await slack.chat.postMessage({
      channel: process.env.SLACK_TARGET_CHANNEL_ID,
      text,
      unfurl_links: false,
      unfurl_media: false
    });
    console.log(`✅ Test card posted (ts=${res.ts}).`);
    console.log(`→ Now watch your logs: pm2 logs phantombuster-app | grep slackEvents`);
  } catch (err) {
    console.error('❌ Error sending test card:', err);
  } finally {
    process.exit(0);
  }
})();
