# Slack Visitor Integration

## Fixing the Events API Issues

The application has been updated to fix an issue where visitor events posted to Slack were not being processed by the Events API webhook. The problem was that the visitor data was being posted using Incoming Webhooks, which don't trigger Events API callbacks.

## Solution: Using Bot User Instead of Webhooks

The solution is to use the Slack Bot User to post messages via the Web API instead of using Incoming Webhooks. This ensures that:

1. Messages appear in the Slack channel as expected
2. Slack properly triggers Events API callbacks for these messages
3. Our webhook handler can then process and store these events in MongoDB

## Key Files

- **webhooks/slackEvents.js**: Combined module that provides both:
  - `postVisitorToSlack(visitor)` function to post visitor data to Slack
  - Express router for handling Events API callbacks

- **examples/postVisitorExample.js**: Example showing how to use the new approach

## Implementation

To use this in your integration:

```javascript
const { postVisitorToSlack } = require('./webhooks/slackEvents');

// When you have visitor data to post
await postVisitorToSlack({
  name: "John Doe",
  title: "CTO",
  company: "Example Corp",
  email: "john@example.com",
  linkedin: "https://linkedin.com/in/johndoe",
  location: "San Francisco, CA",
  pageCount: 5
});
```

## Required Environment Variables

Make sure these are set in your .env file:

```
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_TARGET_CHANNEL_ID=C12345678
RB2B_BOT_ID=B12345678
```

## Important Notes

1. You need to invite your Bot User to the target Slack channel
2. The Bot User needs `chat:write` permission
3. Keep your Slack app subscribed to the `message.channels` event 