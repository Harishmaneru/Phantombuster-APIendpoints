// Twilio Phone Validation API
// All endpoints require userId for user-specific filtering
const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

// ============================================
// MONGODB CONNECTION
// ============================================
const connectToMongoDB = async () => {
  try {
    if (mongoose.connection.readyState === 1) {
      console.log("MongoDB already connected (Twilio API)");
      return;
    }

    await mongoose.connect(process.env.ONEPGR_MONGO_URI, {
      dbName: "onepgr_apps",
    });
    console.log("Connected to MongoDB for Twilio API (onepgr_apps database)");
  } catch (error) {
    console.error("MongoDB connection error (Twilio API):", error);
  }
};

// Connect to MongoDB when module loads
connectToMongoDB();

// ============================================
// CALL FORWARDING SCHEMA
// Collection: twilio_call_forwarding
// ============================================
const CallForwardingSchema = new mongoose.Schema(
  {
    twilioNumber: { type: String, required: true, unique: true },
    forwardTo: { type: String, required: true },
    userId: { type: String, required: true },
    name: { type: String, default: "User" },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: "twilio_call_forwarding",
  },
);

// Create or get model
let CallForwarding;
try {
  CallForwarding = mongoose.model("CallForwarding");
  console.log("Using existing CallForwarding model");
} catch (error) {
  CallForwarding = mongoose.model("CallForwarding", CallForwardingSchema);
  console.log("Created new CallForwarding model");
}

// ============================================
// TWILIO CLIENT SETUP
// ============================================
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

// Validate credentials before creating client
if (!accountSid || !authToken) {
  console.error("TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is not set");
}

const client = require("twilio")(accountSid, authToken);

// Helper: Create a unique friendlyName with userId
// Format: "userId::name" (allows filtering by userId later)
const createFriendlyName = (userId, name) => {
  return `${userId}::${name || "User"}`;
};

// Helper: Parse friendlyName to extract userId and name
const parseFriendlyName = (friendlyName) => {
  const parts = friendlyName?.split("::") || [];
  return {
    userId: parts[0] || null,
    name: parts[1] || friendlyName,
  };
};

// ============================================
// 1. INITIATE PHONE VALIDATION
// ============================================
router.post("/validate-phone", async (req, res) => {
  const { phoneNumber, name, userId } = req.body;

  // Validate required fields
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  if (!phoneNumber || !phoneNumber.startsWith("+")) {
    return res.status(400).json({
      error: "Phone number must be in E.164 format (e.g., +919391783193)",
    });
  }

  try {
    const validationRequest = await client.validationRequests.create({
      phoneNumber: phoneNumber,
      friendlyName: createFriendlyName(userId, name),
    });

    res.json({
      success: true,
      validationCode: validationRequest.validationCode,
      callSid: validationRequest.callSid,
      phoneNumber: validationRequest.phoneNumber,
      userId: userId,
      message:
        "Twilio is calling you. Please enter the verification code displayed.",
    });
  } catch (error) {
    console.error("Twilio validation error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 2. CHECK VERIFICATION STATUS (Poll this)
// ============================================
router.get("/check-status", async (req, res) => {
  const { phoneNumber, userId } = req.query;

  if (!phoneNumber) {
    return res.status(400).json({ error: "phoneNumber query param required" });
  }

  if (!userId) {
    return res.status(400).json({ error: "userId query param required" });
  }

  try {
    const callerIds = await client.outgoingCallerIds.list();

    // Find the phone number that belongs to this user
    const verified = callerIds.find((id) => {
      const parsed = parseFriendlyName(id.friendlyName);
      return id.phoneNumber === phoneNumber && parsed.userId === userId;
    });

    if (verified) {
      const parsed = parseFriendlyName(verified.friendlyName);
      res.json({
        verified: true,
        phoneNumber: verified.phoneNumber,
        name: parsed.name,
        userId: parsed.userId,
        dateCreated: verified.dateCreated,
        message: "Phone number verified successfully!",
      });
    } else {
      res.json({
        verified: false,
        phoneNumber: phoneNumber,
        userId: userId,
        message: "Verification pending or failed.",
      });
    }
  } catch (error) {
    console.error("Status check error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 3. LIST VERIFIED NUMBERS FOR A USER
// ============================================
router.get("/verified-numbers", async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: "userId query param required" });
  }

  try {
    const callerIds = await client.outgoingCallerIds.list();

    // Filter only numbers belonging to this user
    const userNumbers = callerIds.filter((id) => {
      const parsed = parseFriendlyName(id.friendlyName);
      return parsed.userId === userId;
    });

    res.json({
      success: true,
      userId: userId,
      count: userNumbers.length,
      numbers: userNumbers.map((id) => {
        const parsed = parseFriendlyName(id.friendlyName);
        return {
          phoneNumber: id.phoneNumber,
          name: parsed.name,
          dateCreated: id.dateCreated,
          sid: id.sid,
        };
      }),
    });
  } catch (error) {
    console.error("List verified numbers error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 4. DELETE A VERIFIED NUMBER
// ============================================
router.delete("/remove-number", async (req, res) => {
  const { phoneNumber, userId } = req.body;

  if (!phoneNumber || !userId) {
    return res
      .status(400)
      .json({ error: "phoneNumber and userId are required" });
  }

  try {
    const callerIds = await client.outgoingCallerIds.list();

    // Find the caller ID that matches both phone and userId
    const toDelete = callerIds.find((id) => {
      const parsed = parseFriendlyName(id.friendlyName);
      return id.phoneNumber === phoneNumber && parsed.userId === userId;
    });

    if (!toDelete) {
      return res.status(404).json({
        error: "Phone number not found for this user",
      });
    }

    await client.outgoingCallerIds(toDelete.sid).remove();

    res.json({
      success: true,
      message: "Phone number removed successfully",
      phoneNumber: phoneNumber,
    });
  } catch (error) {
    console.error("Remove number error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CALL FORWARDING SYSTEM (MongoDB-backed)
// ============================================

// ============================================
// 5. SET CALL FORWARDING CONFIG
// ============================================
router.post("/forwarding/set", async (req, res) => {
  const { twilioNumber, forwardTo, userId, name } = req.body;

  if (!twilioNumber || !forwardTo || !userId) {
    return res.status(400).json({
      error: "twilioNumber, forwardTo, and userId are required",
    });
  }

  try {
    // Validate forwardTo is a verified number
    const verifiedNumbers = await client.outgoingCallerIds.list({
      phoneNumber: forwardTo,
    });

    if (verifiedNumbers.length === 0) {
      return res.status(400).json({
        error: "forwardTo number is not verified. Please verify it first.",
      });
    }

    // Upsert (update if exists, otherwise insert) to MongoDB
    const config = await CallForwarding.findOneAndUpdate(
      { twilioNumber },
      {
        twilioNumber,
        forwardTo,
        userId,
        name: name || "User",
        isActive: true,
      },
      { upsert: true, new: true, runValidators: true },
    );

    // Update the Twilio number's Voice URL to point to our webhook
    try {
      const numbers = await client.incomingPhoneNumbers.list({
        phoneNumber: twilioNumber,
      });

      if (numbers.length > 0) {
        const numberSid = numbers[0].sid;
        const webhookUrl = `https://${req.get("host")}/api/twilio/forward-call`;

        await client.incomingPhoneNumbers(numberSid).update({
          voiceUrl: webhookUrl,
          voiceMethod: "POST",
        });

        console.log(
          `✅ Updated Voice URL for ${twilioNumber} to ${webhookUrl}`,
        );
      }
    } catch (updateError) {
      console.warn("Could not auto-update Voice URL:", updateError.message);
    }

    res.json({
      success: true,
      message: "Call forwarding configured successfully",
      config: config,
    });
  } catch (error) {
    console.error("Set forwarding error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 6. GET CALL FORWARDING CONFIG
// ============================================
router.get("/forwarding/get", async (req, res) => {
  const { twilioNumber, userId } = req.query;

  try {
    if (twilioNumber) {
      // Get config for specific Twilio number
      const config = await CallForwarding.findOne({ twilioNumber });
      if (config) {
        res.json({ success: true, config });
      } else {
        res.json({
          success: false,
          message: "No forwarding configured for this number",
        });
      }
    } else if (userId) {
      // Get all configs for a user
      const configs = await CallForwarding.find({ userId });
      res.json({
        success: true,
        count: configs.length,
        configs,
      });
    } else {
      res
        .status(400)
        .json({ error: "twilioNumber or userId query param required" });
    }
  } catch (error) {
    console.error("Get forwarding error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 7. DELETE CALL FORWARDING CONFIG
// ============================================
router.delete("/forwarding/delete", async (req, res) => {
  const { twilioNumber, userId } = req.body;

  if (!twilioNumber || !userId) {
    return res
      .status(400)
      .json({ error: "twilioNumber and userId are required" });
  }

  try {
    const config = await CallForwarding.findOne({ twilioNumber });

    if (!config) {
      return res
        .status(404)
        .json({ error: "No forwarding config found for this number" });
    }

    if (config.userId !== userId) {
      return res
        .status(403)
        .json({ error: "You don't have permission to delete this config" });
    }

    await CallForwarding.deleteOne({ twilioNumber });

    res.json({
      success: true,
      message: "Call forwarding removed successfully",
      twilioNumber,
    });
  } catch (error) {
    console.error("Delete forwarding error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 8. DYNAMIC CALL FORWARDING WEBHOOK
// Twilio calls this when someone dials a purchased number
// ============================================
router.post("/forward-call", async (req, res) => {
  const { To, From, CallSid } = req.body;

  console.log(`📞 Incoming call to ${To} from ${From} (CallSid: ${CallSid})`);

  res.type("text/xml");

  try {
    // Look up forwarding config from MongoDB
    const config = await CallForwarding.findOne({
      twilioNumber: To,
      isActive: true,
    });

    if (!config || !config.forwardTo) {
      console.log(`❌ No forwarding configured for ${To}`);
      return res.send(`
        <Response>
          <Say voice="alice">Sorry, call forwarding is not configured for this number.</Say>
          <Hangup/>
        </Response>
      `);
    }

    console.log(`➡️ Forwarding call from ${From} to ${config.forwardTo}`);

    res.send(`
      <Response>
        <Say voice="alice">Please wait while we connect your call.</Say>
        <Dial callerId="${To}" timeout="30">
          <Number>${config.forwardTo}</Number>
        </Dial>
      </Response>
    `);
  } catch (error) {
    console.error("Forward call error:", error);
    res.send(`
      <Response>
        <Say voice="alice">An error occurred. Please try again later.</Say>
        <Hangup/>
      </Response>
    `);
  }
});

module.exports = router;
