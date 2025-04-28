/**
 * Example file showing how to use the postVisitorToSlack function
 * 
 * This approach uses the Bot User method that ensures Events API callbacks are triggered
 * Rather than using Incoming Webhooks which don't trigger Events API events.
 */

// Import the postVisitorToSlack function
const { postVisitorToSlack } = require('../webhooks/slackEvents');

// Example visitor data
const exampleVisitor = {
  name: "John Doe",
  title: "CTO",
  company: "Example Corp",
  email: "john@example.com",
  linkedin: "https://linkedin.com/in/johndoe",
  location: "San Francisco, CA",
  pageCount: 5
};

/**
 * Example function that would be called by your RB2B integration
 * 
 * @param {Object} visitorData - Visitor data from RB2B or Phantombuster
 * @returns {Promise<void>}
 */
async function processNewVisitor(visitorData) {
  try {
    // Instead of sending to a webhook URL with fetch:
    // OLD: await fetch(process.env.SLACK_WEBHOOK_URL, { method: 'POST', body: JSON.stringify({...}) });
    
    // Use the Bot User implementation that will trigger Events API:
    await postVisitorToSlack(visitorData);
    
    console.log('Visitor data posted to Slack successfully');
  } catch (error) {
    console.error('Error posting visitor data to Slack:', error);
  }
}

// Example usage (comment out in production)
// processNewVisitor(exampleVisitor).catch(console.error);

module.exports = { processNewVisitor }; 