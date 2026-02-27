const express = require("express");
const axios = require("axios");
const router = express.Router();
const DNC_LOOKUP_URL =
  "https://api.realvalidation.com/rpvWebService/DNCLookup.php";

// Rate limit: API recommends max 10 requests per second
const RATE_LIMIT_DELAY_MS = 120; // ~8 requests/sec to stay safely under limit

/**
 * Helper to delay execution
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Lookup a single phone number against the DNC registry
 */
async function lookupSinglePhone(phone, token) {
  const response = await axios.get(DNC_LOOKUP_URL, {
    params: {
      phone: phone,
      token: token,
      output: "json",
    },
    headers: {
      Accept: "application/json",
    },
  });
  return response.data;
}

/**
 * POST /dnc-lookup
 * Single DNC lookup for one phone number
 *
 * Body: { phone: "7275555555" }
 * API key is read from env variable REAL_PHONE_VALIDATION_API_KEY
 */
router.post("/dnc-lookup", async (req, res) => {
  const { phone } = req.body;
  const apiKey = process.env.REAL_PHONE_VALIDATION_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error:
        "API key not configured. Please set REAL_PHONE_VALIDATION_API_KEY in environment variables.",
    });
  }

  if (!phone) {
    return res.status(400).json({
      error: "Phone number is required.",
    });
  }

  try {
    console.log("[DNC Lookup] Looking up phone:", phone);
    const result = await lookupSinglePhone(phone, apiKey);
    console.log("[DNC Lookup] Result:", result);
    res.status(200).json(result);
  } catch (error) {
    console.error("[DNC Lookup] Error:", error.message);
    if (error.response) {
      res.status(error.response.status).json({
        error: "Error from RealPhoneValidation API.",
        details: error.response.data,
      });
    } else {
      res.status(500).json({
        error: "An error occurred while processing the DNC lookup.",
        message: error.message,
      });
    }
  }
});

/**
 * POST /dnc-lookup/bulk
 * Bulk DNC lookup for multiple phone numbers
 *
 * Body: { phones: ["7275555555", "8135555555", ...] }
 * API key is read from env variable REAL_PHONE_VALIDATION_API_KEY
 *
 * Returns an array of results, one per phone number.
 * Rate-limited to stay under the API's 10 req/sec recommendation.
 */
router.post("/dnc-lookup/bulk", async (req, res) => {
  const { phones } = req.body;
  const apiKey = process.env.REAL_PHONE_VALIDATION_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error:
        "API key not configured. Please set REAL_PHONE_VALIDATION_API_KEY in environment variables.",
    });
  }

  if (!phones || !Array.isArray(phones) || phones.length === 0) {
    return res.status(400).json({
      error:
        'An array of phone numbers is required. Provide { phones: ["7275555555", ...] }',
    });
  }

  console.log(`[DNC Bulk Lookup] Processing ${phones.length} phone numbers...`);

  const results = [];

  for (let i = 0; i < phones.length; i++) {
    const phone = phones[i];

    try {
      const result = await lookupSinglePhone(phone, apiKey);
      results.push({
        phone: phone,
        status: "success",
        data: result,
      });
      console.log(
        `[DNC Bulk Lookup] (${i + 1}/${phones.length}) ${phone} -> ${result.RESPONSECODE}`,
      );
    } catch (error) {
      console.error(
        `[DNC Bulk Lookup] (${i + 1}/${phones.length}) ${phone} -> ERROR: ${error.message}`,
      );
      results.push({
        phone: phone,
        status: "error",
        error: error.response ? error.response.data : error.message,
      });
    }

    // Rate limiting: wait between requests (skip delay after the last one)
    if (i < phones.length - 1) {
      await delay(RATE_LIMIT_DELAY_MS);
    }
  }

  const successCount = results.filter((r) => r.status === "success").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  console.log(
    `[DNC Bulk Lookup] Complete. Success: ${successCount}, Errors: ${errorCount}`,
  );

  res.status(200).json({
    total: phones.length,
    successCount,
    errorCount,
    results,
  });
});

module.exports = router;
