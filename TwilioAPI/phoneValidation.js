// Endpoint: POST /add-caller-id
// Client sends: { phoneNumber: '+15550001234' }
const express = require("express");
const axios = require("axios");

const router = express.Router();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = require("twilio")(accountSid, authToken);

router.post("/validate-phone", async (req, res) => {
  const { phoneNumber, name } = req.body;

  try {
    const callerId = await client.outgoingCallerIds.create({
      phoneNumber: phoneNumber,
      friendlyName: name || "Anonymous User",
    });

    // CRITICAL: This returns a 'validationCode'.
    // You must display this code to your user on the UI.
    res.json({
      success: true,
      validationCode: callerId.validationCode,
      message:
        "Twilio is calling you. Please enter the verification code displayed.",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
