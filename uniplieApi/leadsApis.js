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

// Helper: parse comma-separated filter string into keyword array
const parseKeywords = (value) =>
  value
    ? String(value)
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean)
    : [];

// Helper: check if text matches ANY keyword (OR logic within a filter)
const matchesAny = (text, keywords) => {
  if (keywords.length === 0) return true; // no filter = pass
  const lc = (text || "").toLowerCase();
  return keywords.some((kw) => {
    // Direct substring match
    if (lc.includes(kw)) return true;
    // Word-boundary match: all words in the keyword appear in text
    const kwWords = kw.split(/\s+/).filter(Boolean);
    if (kwWords.length > 1 && kwWords.every((w) => lc.includes(w))) return true;
    return false;
  });
};

// Helper: check if a relation passes ALL active filters (AND between filter types)
const matchesFilters = (relation, { titleKw, locationKw, industryKw }) => {
  const headline = (relation.headline || "").toLowerCase();
  const firstName = (relation.first_name || "").toLowerCase();
  const lastName = (relation.last_name || "").toLowerCase();
  const fullName = `${firstName} ${lastName}`;
  const location = (relation.location || "").toLowerCase();
  const industry = (relation.industry || "").toLowerCase();

  // --- Title filter (checks headline + name) ---
  if (titleKw.length > 0) {
    const searchable = `${headline} | ${fullName}`;
    const titleMatch = titleKw.some((kw) => {
      if (headline.includes(kw)) return true;
      const kwWords = kw.split(/\s+/).filter(Boolean);
      if (kwWords.length > 1 && kwWords.every((w) => searchable.includes(w)))
        return true;
      if (fullName.includes(kw)) return true;
      return false;
    });
    if (!titleMatch) return false;
  }

  // --- Location filter (checks location field) ---
  if (locationKw.length > 0) {
    if (!matchesAny(location, locationKw)) return false;
  }

  // --- Industry filter (checks industry field + headline as fallback) ---
  if (industryKw.length > 0) {
    const industryText = `${industry} | ${headline}`;
    if (!matchesAny(industryText, industryKw)) return false;
  }

  return true;
};

router.get("/api/unipile/:userId/linkedin/relations", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 100, cursor, title, location, industry } = req.query;

    // 1️⃣ Resolve userId → Unipile account_id
    const dbResult = await getLinkedInAccountStatus(userId);
    if (!dbResult.success || !dbResult.account_id) {
      return res
        .status(404)
        .json({ success: false, error: "No LinkedIn account found" });
    }
    const accountId = dbResult.account_id;

    // 2️⃣ Parse all filters
    const titleKw = parseKeywords(title);
    const locationKw = parseKeywords(location);
    const industryKw = parseKeywords(industry);
    const hasFilters =
      titleKw.length > 0 || locationKw.length > 0 || industryKw.length > 0;

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

      if (!hasFilters) {
        // No filter — return raw results (single page, respect original behavior)
        matchedItems = items;
        nextCursor = apiResp.data.cursor || null;
        break;
      }

      // Filter this page and accumulate matches
      const pageMatches = items.filter((r) =>
        matchesFilters(r, { titleKw, locationKw, industryKw }),
      );
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
      filters_applied: {
        title: title || null,
        location: location || null,
        industry: industry || null,
      },
      keywords_used: {
        title: titleKw.length > 0 ? titleKw : null,
        location: locationKw.length > 0 ? locationKw : null,
        industry: industryKw.length > 0 ? industryKw : null,
      },
    });
  } catch (err) {
    handleError(err, res);
  }
});

//____________________Post API__________________

module.exports = router;
