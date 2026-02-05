// Endpoint: POST /add-caller-id
// Client sends: { phoneNumber: '+15550001234' }
const express = require("express");
const axios = require("axios");

const router = express.Router();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = require("twilio")(accountSid, authToken);

router.post("/validate-phone", async (req, res) => {
  const { phoneNumber } = req.body;

  try {
    const callerId = await client.outgoingCallerIds.create({
      phoneNumber: phoneNumber,
      // You can optionally add a friendlyName to track who this belongs to
      friendlyName: `User-${req.user.id}`,
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
