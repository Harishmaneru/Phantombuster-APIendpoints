const express = require("express");
const axios = require("axios");
const router = express.Router();

// Import LinkedIn account service
const { getLinkedInAccountStatus } = require("./linkedinAccountService");

// ==================== HELPERS ====================

// Build base URL from environment
const getBaseUrl = () => {
  return `https://${process.env.UNIPILE_SUBDOMAIN}.unipile.com:${process.env.UNIPILE_PORT}/api/v1`;
};

// Standard headers for all requests
const getHeaders = (contentType = "application/json") => ({
  "X-API-KEY": process.env.UNIPILE_API_KEY,
  Accept: "application/json",
  ...(contentType && { "Content-Type": contentType }),
});

// Unified error handler
const handleError = (err, res) => {
  console.error("Leads API Error:", {
    status: err.response?.status,
    message: err.message,
    data: err.response?.data,
    url: err.config?.url,
  });

  const status = err.response?.status || 500;

  // Forward full error details from Unipile if available
  if (err.response?.data) {
    return res.status(status).json({
      success: false,
      error: err.response.data,
      message: err.message,
    });
  }

  const message = err.message || "Internal server error";

  res.status(status).json({
    success: false,
    error: message,
  });
};

// ==================== FOLLOWERS ENDPOINT ====================

// Get all followers for a user
// Unipile API: GET /api/v1/users/followers
// Query params: account_id (required), limit, cursor
router.get("/api/unipile/:userId/followers", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, cursor } = req.query;

    // Resolve userId to Unipile accountId
    const dbResult = await getLinkedInAccountStatus(userId);

    if (!dbResult.success || !dbResult.account_id) {
      return res
        .status(404)
        .json({ success: false, error: "No LinkedIn account found" });
    }

    const accountId = dbResult.account_id;

    // Build query parameters
    const params = new URLSearchParams();
    params.append("account_id", accountId);
    params.append("limit", limit);
    if (cursor) params.append("cursor", cursor);

    const response = await axios.get(
      `${getBaseUrl()}/users/followers?${params}`,
      {
        headers: getHeaders(),
      },
    );

    res.json({
      success: true,
      data: response.data,
      account_id: accountId,
      user_id: userId,
    });
  } catch (err) {
    handleError(err, res);
  }
});

router.get("/api/unipile/:userId/linkedin/relations", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 100, cursor, title } = req.query; // `title` is your optional filter

    // 1️⃣ Grab the LinkedIn account_id you already resolve elsewhere
    const dbResult = await getLinkedInAccountStatus(userId);
    if (!dbResult.success || !dbResult.account_id) {
      return res
        .status(404)
        .json({ success: false, error: "No LinkedIn account found" });
    }
    const accountId = dbResult.account_id;

    // 2️⃣ Call Unipile
    const params = new URLSearchParams();
    params.append("account_id", accountId);
    params.append("limit", limit);
    if (cursor) params.append("cursor", cursor);

    const apiResp = await axios.get(
      `${getBaseUrl()}/users/relations?${params}`,
      { headers: getHeaders() },
    );

    // 3️⃣ Optional title filtering (case-insensitive substring match)
    let items = apiResp.data.items || [];
    if (title) {
      const kw = String(title).toLowerCase();
      items = items.filter((r) => r.headline?.toLowerCase().includes(kw));
    }

    return res.json({
      success: true,
      data: items,
      next_cursor: apiResp.data.cursor || null,
      results_count: items.length,
      filtered_by_title: title || null,
    });
  } catch (err) {
    handleError(err, res);
  }
});

module.exports = router;
