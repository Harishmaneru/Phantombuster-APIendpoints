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
  console.error("Post API Error:", {
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

// Build LinkedIn profile URL from actor data
const buildLinkedInUrl = (actor) => {
  if (!actor || !actor.public_identifier) return null;
  return actor.is_company
    ? `https://www.linkedin.com/company/${actor.public_identifier}`
    : `https://www.linkedin.com/in/${actor.public_identifier}`;
};

// Batch-fetch actor details from Unipile contacts API
const fetchActors = async (ids) => {
  if (!ids || ids.size === 0) return {};
  try {
    const { data } = await axios.get(
      `${getBaseUrl()}/contacts?ids=${[...ids].join(",")}`,
      { headers: getHeaders() },
    );
    return Object.fromEntries((data.items || []).map((a) => [a.id, a]));
  } catch (err) {
    console.error("Failed to fetch actors:", err.message);
    return {};
  }
};

// ==================== COMMENT ENDPOINTS ====================

// Add a comment to a post
// Unipile API: POST /api/v1/posts/{post_id}/comments
// Body: { text } (required)
router.post("/api/unipile/:userId/posts/:postId/comments", async (req, res) => {
  try {
    const { userId, postId } = req.params;
    const { text } = req.body;

    if (!text) {
      return res
        .status(400)
        .json({ success: false, error: "Comment text is required" });
    }

    // Resolve userId to Unipile accountId
    const dbResult = await getLinkedInAccountStatus(userId);

    if (!dbResult.success || !dbResult.account_id) {
      return res
        .status(404)
        .json({ success: false, error: "No LinkedIn account found" });
    }

    const accountId = dbResult.account_id;

    const response = await axios.post(
      `${getBaseUrl()}/posts/${postId}/comments`,
      {
        account_id: accountId,
        text: text,
      },
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

// List comments from a post
// Unipile API: GET /api/v1/posts/{post_id}/comments
// Query params: account_id (required), limit, cursor, comment_id (optional, for replies)
router.get("/api/unipile/:userId/posts/:postId/comments", async (req, res) => {
  try {
    const { userId, postId } = req.params;
    const { limit = 50, cursor, comment_id } = req.query;

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
    if (comment_id) params.append("comment_id", comment_id);

    const response = await axios.get(
      `${getBaseUrl()}/posts/${postId}/comments?${params}`,
      {
        headers: getHeaders(),
      },
    );

    // Enrich comments with actor details and profile URLs
    const items = response.data.items || [];
    const actorIds = new Set(
      items.map((item) => item.actor_id).filter(Boolean),
    );
    const actorsById = await fetchActors(actorIds);

    const enrichedItems = items.map((item) => {
      const actor = actorsById[item.actor_id] || {};
      return {
        ...item,
        actor,
        profile_url: buildLinkedInUrl(actor),
      };
    });

    res.json({
      success: true,
      data: { ...response.data, items: enrichedItems },
      account_id: accountId,
      user_id: userId,
    });
  } catch (err) {
    handleError(err, res);
  }
});

// ==================== REACTION ENDPOINTS ====================

// Add a reaction to a post
// Unipile API: POST /api/v1/posts/reaction
// Body: { account_id, post_id, value }
// Supported values: LIKE, PRAISE, APPRECIATION, EMPATHY, INTEREST, ENTERTAINMENT
router.post("/api/unipile/:userId/posts/:postId/reaction", async (req, res) => {
  try {
    const { userId, postId } = req.params;
    const { value } = req.body;

    const validReactions = [
      "LIKE",
      "PRAISE",
      "APPRECIATION",
      "EMPATHY",
      "INTEREST",
      "ENTERTAINMENT",
    ];

    if (!value || !validReactions.includes(value.toUpperCase())) {
      return res.status(400).json({
        success: false,
        error: `Reaction value is required. Must be one of: ${validReactions.join(", ")}`,
      });
    }

    // Resolve userId to Unipile accountId
    const dbResult = await getLinkedInAccountStatus(userId);

    if (!dbResult.success || !dbResult.account_id) {
      return res
        .status(404)
        .json({ success: false, error: "No LinkedIn account found" });
    }

    const accountId = dbResult.account_id;

    const response = await axios.post(
      `${getBaseUrl()}/posts/reaction`,
      {
        account_id: accountId,
        post_id: postId,
        value: value.toUpperCase(),
      },
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

// List reactions from a post
// Unipile API: GET /api/v1/posts/{post_id}/reactions
// Query params: account_id (required), limit, cursor, comment_id (optional)
router.get("/api/unipile/:userId/posts/:postId/reactions", async (req, res) => {
  try {
    const { userId, postId } = req.params;
    const { limit = 50, cursor, comment_id } = req.query;

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
    if (comment_id) params.append("comment_id", comment_id);

    const response = await axios.get(
      `${getBaseUrl()}/posts/${postId}/reactions?${params}`,
      {
        headers: getHeaders(),
      },
    );

    // Enrich reactions with actor details and profile URLs
    const items = response.data.items || [];
    const actorIds = new Set(
      items.map((item) => item.actor_id).filter(Boolean),
    );
    const actorsById = await fetchActors(actorIds);

    const enrichedItems = items.map((item) => {
      const actor = actorsById[item.actor_id] || {};
      return {
        ...item,
        actor,
        profile_url: buildLinkedInUrl(actor),
      };
    });

    res.json({
      success: true,
      data: { ...response.data, items: enrichedItems },
      account_id: accountId,
      user_id: userId,
    });
  } catch (err) {
    handleError(err, res);
  }
});



router.post("/api/unipile/linkedin/post-engagement", async (req, res) => {
  try {
    const { user_id, post_url } = req.body;

    // 1. Validate input
    if (!user_id || !post_url) {
      return res.status(400).json({
        success: false,
        error: "user_id and post_url are required",
      });
    }

    // 2. Get account_id from DB
    const dbResult = await getLinkedInAccountStatus(user_id);
    if (!dbResult.success || !dbResult.account_id) {
      return res.status(400).json({
        success: false,
        error: "LinkedIn account not connected",
      });
    }

    const account_id = dbResult.account_id;

    // 3. Extract post ID from LinkedIn URL
    const match = post_url.match(/activity-(\d+)/);
    if (!match) {
      return res.status(400).json({
        success: false,
        error: "Invalid LinkedIn post URL",
      });
    }

    const postId = match[1];

    // 4. Build both possible URNs
    const activityURN = `urn:li:activity:${postId}`;
    const ugcURN = `urn:li:ugcPost:${postId}`;

    let finalURN = activityURN;

    // 5. Try fetching post (to validate correct URN)
    try {
      await axios.get(
        `${getBaseUrl()}/posts/${encodeURIComponent(activityURN)}?account_id=${account_id}`,
        { headers: getHeaders() }
      );
    } catch (err) {
      // fallback to ugcPost
      finalURN = ugcURN;
    }

    // 6. Fetch comments + reactions in parallel
    const [commentsRes, reactionsRes] = await Promise.all([
      axios.get(
        `${getBaseUrl()}/posts/${encodeURIComponent(finalURN)}/comments?account_id=${account_id}`,
        { headers: getHeaders() }
      ),
      axios.get(
        `${getBaseUrl()}/posts/${encodeURIComponent(finalURN)}/reactions?account_id=${account_id}`,
        { headers: getHeaders() }
      ),
    ]);

    // 7. Format response (clean)
    res.json({
      success: true,
      post: {
        url: post_url,
        urn: finalURN,
      },
      engagement: {
        comments: commentsRes.data?.items || [],
        commenters_count: commentsRes.data?.items?.length || 0,

        reactions: reactionsRes.data?.items || [],
        likers_count: reactionsRes.data?.items?.length || 0,
      },
    });
  } catch (err) {
    console.error("Post engagement error:", {
      status: err.response?.status,
      error: err.response?.data,
      message: err.message,
    });

    return res.status(err.response?.status || 500).json({
      success: false,
      error: err.response?.data || err.message,
    });
  }
});
module.exports = router;
