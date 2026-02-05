// Twilio Phone Validation API
// All endpoints require userId for user-specific filtering
const express = require("express");

const router = express.Router();

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

module.exports = router;
