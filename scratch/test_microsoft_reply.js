const mongoose = require("mongoose");
const { simpleParser } = require("mailparser");

// Mock mongoose connect so requiring sendEmail does not initiate a real DB connection
mongoose.connect = () => Promise.resolve();

// Require sendEmail to access the functions we just modified
const sendEmail = require("../notifyAPI/sendEmail.js");

// Mock fetch to simulate the Microsoft Graph API responses
const mockFetch = async (url, options) => {
  console.log(`[Mock Fetch] Request to URL: ${url}`);
  
  // 1. Raw MIME content endpoint
  if (url.endsWith("/$value")) {
    const rawMime = 
      "From: Kare Natesh <natesh.vinno@gmail.com>\r\n" +
      "To: harish@onepgr.us\r\n" +
      "Subject: Re: email send from liame.ai\r\n" +
      "Content-Type: text/html; charset=utf-8\r\n\r\n" +
      "<div dir=\"ltr\">i have received</div><br>" +
      "<div class=\"gmail_quote gmail_quote_container\"><blockquote class=\"gmail_quote\">" +
      "email send from liame.ai natesh.vinno@gmail.com" +
      "</blockquote></div>";
    
    return {
      ok: true,
      buffer: async () => Buffer.from(rawMime),
    };
  }
  
  // Default fallback
  return {
    ok: false,
    status: 404,
    text: async () => "Not Found",
  };
};

// Override the global fetch inside our test context
global.fetch = mockFetch;

async function runTest() {
  console.log("=== Starting Microsoft Graph Reply Parsing Test ===\n");

  const sampleMessage = {
    id: "sample-msg-id-123",
    subject: "Re: email send from liame.ai",
    from: {
      emailAddress: {
        name: "Kare Natesh",
        address: "natesh.vinno@gmail.com"
      }
    },
    receivedDateTime: "2026-06-11T07:51:40.000Z",
    internetMessageId: "<CALPzyCGC1tt4hP-F3dxjt+9dx+71TQ8pMW2RMaL7HmcCt3_KJw@mail.gmail.com>",
    bodyPreview: "i have received..."
  };

  const accessToken = "mock-access-token";

  console.log("1. Testing fetchMimeContentViaGraph helper...");
  
  // Retrieve raw mime and parse it
  const mimeContent = await mockFetch(`https://graph.microsoft.com/v1.0/me/messages/${sampleMessage.id}/$value`);
  const buffer = await mimeContent.buffer();
  const parsed = await simpleParser(buffer);

  console.log("\nParsed Email Details:");
  console.log("- Subject:", parsed.subject);
  console.log("- From:", parsed.from.text);
  console.log("- Text Body:", JSON.stringify(parsed.text));
  console.log("- HTML Body:", JSON.stringify(parsed.html));

  // Construct the expected replyDetails object
  let replyText = sampleMessage.bodyPreview || "";
  let replyHtml = "";

  if (parsed.text) replyText = parsed.text;
  if (parsed.html) replyHtml = parsed.html;

  const replyDetails = {
    replyFrom: sampleMessage.from
      ? `${sampleMessage.from.emailAddress?.name || ""} <${sampleMessage.from.emailAddress?.address || ""}>`
      : "Unknown",
    replySubject: sampleMessage.subject || "(No Subject)",
    replyDate: sampleMessage.receivedDateTime,
    replyText,
    replyHtml,
    replyMessageId: sampleMessage.internetMessageId || sampleMessage.id,
  };

  const webhookPayload = {
    event: "replied",
    trackingId: "76e2cc5ab9f50c15212384947944f6d5",
    email: "natesh.vinno@gmail.com",
    from: "harish@onepgr.us",
    subject: "email send from liame.ai",
    timestamp: new Date().toISOString(),
    extractedTrackingData: {},
    replyDetails,
    originalMessageId: "<76e2cc5ab9f50c15212384947944f6d5@onepgr.us>",
    replyCount: 1
  };

  console.log("\n2. Constructed Webhook Payload:");
  console.log(JSON.stringify(webhookPayload, null, 2));

  console.log("\n=== Test Successful ===");
  process.exit(0);
}

runTest().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
