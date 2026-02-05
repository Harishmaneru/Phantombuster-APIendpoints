// Endpoint: POST /validate-phone
// Client sends: { phoneNumber: '+15550001234', name: 'User Name' }
const express = require("express");

const router = express.Router();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

// Validate credentials before creating client
if (!accountSid || !authToken) {
  console.error("TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is not set");
}

const client = require("twilio")(accountSid, authToken);

router.post("/validate-phone", async (req, res) => {
  const { phoneNumber, name } = req.body;

  // Validate phone number format
  if (!phoneNumber || !phoneNumber.startsWith("+")) {
    return res.status(400).json({
      error: "Phone number must be in E.164 format (e.g., +919391783193)",
    });
  }

  try {
    // Use validationRequests.create() - the correct method for caller ID verification
    const validationRequest = await client.validationRequests.create({
      phoneNumber: phoneNumber,
      friendlyName: name || "Anonymous User",
    });

    // This returns the validation code and call SID
    res.json({
      success: true,
      validationCode: validationRequest.validationCode,
      callSid: validationRequest.callSid,
      phoneNumber: validationRequest.phoneNumber,
      message:
        "Twilio is calling you. Please enter the verification code displayed.",
    });
  } catch (error) {
    console.error("Twilio validation error:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
