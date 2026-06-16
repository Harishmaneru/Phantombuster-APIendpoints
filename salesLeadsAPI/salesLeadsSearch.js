const express = require("express");
const axios = require("axios");
const router = express.Router();

const { getLinkedInAccountStatus } = require("../uniplieApi/linkedinAccountService");

const getBaseUrl = () => {
  return `https://${process.env.UNIPILE_SUBDOMAIN}.unipile.com:${process.env.UNIPILE_PORT}/api/v1`;
};

const getHeaders = (contentType = "application/json") => ({
  "X-API-KEY": process.env.UNIPILE_API_KEY,
  Accept: "application/json",
  ...(contentType && { "Content-Type": contentType }),
});

router.post("/api/sales-leads/fetch/saved-leads", async (req, res) => {
  try {
    const { userId, salesNavUrl, limit = 25 } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "userId is required",
      });
    }

    if (!salesNavUrl) {
      return res.status(400).json({
        success: false,
        error: "salesNavUrl is required",
      });
    }

    if (isNaN(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({
        success: false,
        error: "limit must be a number between 1 and 100",
      });
    }

    const accountResult = await getLinkedInAccountStatus(userId);
    if (!accountResult.success || !accountResult.account_id) {
      return res.status(404).json({
        success: false,
        error: accountResult.message || "No LinkedIn account found for this user",
      });
    }

    const accountId = accountResult.account_id;

    const params = new URLSearchParams();
    params.append("account_id", accountId);
    params.append("limit", limit);

    console.log(`Sales Leads Search: accountId=${accountId}, url=${salesNavUrl}, limit=${limit}`);

    const searchResponse = await axios.post(
      `${getBaseUrl()}/linkedin/search?${params}`,
      { url: salesNavUrl },
      { headers: getHeaders() },
    );

    return res.json({
      success: true,
      account_id: accountId,
      results_count: searchResponse.data?.items?.length || 0,
      leads: searchResponse.data?.items || [],
      cursor: searchResponse.data?.cursor || null,
    });
  } catch (error) {
    console.error("Sales leads search error:", {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });

    return res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data || error.message || "Failed to search sales leads",
    });
  }
});

module.exports = router;
