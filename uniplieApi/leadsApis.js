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

// Helper: check if a relation matches ANY of the keywords
const matchesTitle = (relation, keywords) => {
  const headline = (relation.headline || "").toLowerCase();
  const firstName = (relation.first_name || "").toLowerCase();
  const lastName = (relation.last_name || "").toLowerCase();
  const fullName = `${firstName} ${lastName}`;
  const searchableText = `${headline} | ${fullName}`;

  return keywords.some((kw) => {
    // 1) Direct substring match on headline  (e.g. "ceo" inside "CEO & Founder")
    if (headline.includes(kw)) return true;

    // 2) Word-boundary match: every word in the keyword appears in the headline
    //    e.g. keyword "vp sales" matches headline "VP of Sales at Acme"
    const kwWords = kw.split(/\s+/).filter(Boolean);
    if (kwWords.length > 1) {
      const allWordsMatch = kwWords.every((w) => searchableText.includes(w));
      if (allWordsMatch) return true;
    }

    // 3) Name match (in case someone searches by person name)
    if (fullName.includes(kw)) return true;

    return false;
  });
};

router.get("/api/unipile/:userId/linkedin/relations", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 100, cursor, title } = req.query;

    // 1️⃣ Resolve userId → Unipile account_id
    const dbResult = await getLinkedInAccountStatus(userId);
    if (!dbResult.success || !dbResult.account_id) {
      return res
        .status(404)
        .json({ success: false, error: "No LinkedIn account found" });
    }
    const accountId = dbResult.account_id;

    // 2️⃣ Parse keywords: split by comma, trim & lowercase each
    const keywords = title
      ? String(title)
          .split(",")
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean)
      : [];

    const maxResults = Math.min(Number(limit) || 100, 500); // cap at 500
    const PAGE_SIZE = 100; // fetch 100 per Unipile page
    const MAX_PAGES = 20; // safety: never fetch more than 20 pages

    let matchedItems = [];
    let nextCursor = cursor || null;
    let pagesFetched = 0;
    let totalScanned = 0;

    // 3️⃣ Paginate through Unipile until we have enough matches or run out
    do {
      const params = new URLSearchParams();
      params.append("account_id", accountId);
      params.append("limit", PAGE_SIZE);
      if (nextCursor) params.append("cursor", nextCursor);

      const apiResp = await axios.get(
        `${getBaseUrl()}/users/relations?${params}`,
        { headers: getHeaders() },
      );

      const items = apiResp.data.items || [];
      totalScanned += items.length;
      pagesFetched++;

      if (keywords.length === 0) {
        // No filter — return raw results (single page, respect original behavior)
        matchedItems = items;
        nextCursor = apiResp.data.cursor || null;
        break;
      }

      // Filter this page and accumulate matches
      const pageMatches = items.filter((r) => matchesTitle(r, keywords));
      matchedItems.push(...pageMatches);

      nextCursor = apiResp.data.cursor || null;

      // Stop if we have enough results, no more pages, or hit safety limit
      if (
        matchedItems.length >= maxResults ||
        !nextCursor ||
        items.length < PAGE_SIZE ||
        pagesFetched >= MAX_PAGES
      ) {
        break;
      }
    } while (true);

    // Trim to requested limit
    const finalItems = matchedItems.slice(0, maxResults);

    return res.json({
      success: true,
      data: finalItems,
      next_cursor: nextCursor,
      results_count: finalItems.length,
      total_scanned: totalScanned,
      pages_fetched: pagesFetched,
      filtered_by_title: title || null,
      keywords_used: keywords.length > 0 ? keywords : null,
    });
  } catch (err) {
    handleError(err, res);
  }
});
//____________________Post API__________________

module.exports = router;
