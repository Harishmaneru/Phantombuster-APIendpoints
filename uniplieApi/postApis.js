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



// router.post("/api/unipile/linkedin/post-engagement", async (req, res) => {
//   try {
//     const { user_id, post_url } = req.body;

//     // 1. Validate input
//     if (!user_id || !post_url) {
//       return res.status(400).json({
//         success: false,
//         error: "user_id and post_url are required",
//       });
//     }

//     // 2. Get account_id from DB
//     const dbResult = await getLinkedInAccountStatus(user_id);
//     if (!dbResult.success || !dbResult.account_id) {
//       return res.status(400).json({
//         success: false,
//         error: "LinkedIn account not connected",
//       });
//     }

//     const account_id = dbResult.account_id;

//     // 3. Extract post ID (robust)
//     function extractLinkedInPostId(url) {
//       try {
//         const cleanUrl = url.split("?")[0].replace(/\/$/, "");
        
//         const activityMatch = cleanUrl.match(/activity-(\d+)/);
//         if (activityMatch) return activityMatch[1];
        
//         const ugcMatch = cleanUrl.match(/ugcPost-(\d+)/);
//         if (ugcMatch) return ugcMatch[1];
        
//         const shareMatch = cleanUrl.match(/\/posts\/(?:view\/)?(\d+)/);
//         if (shareMatch) return shareMatch[1];
        
//         const numericMatch = cleanUrl.match(/(\d{10,})/);
//         if (numericMatch) return numericMatch[1];
        
//         return null;
//       } catch {
//         return null;
//       }
//     }

//     const postId = extractLinkedInPostId(post_url);

//     if (!postId) {
//       return res.status(400).json({
//         success: false,
//         error: "Invalid LinkedIn post URL",
//       });
//     }

//     console.log(`📝 Extracted post ID: ${postId}`);

//     // 4. Try different URN formats
//     const possibleURNs = [
//       `urn:li:activity:${postId}`,
//       `urn:li:ugcPost:${postId}`,
//       `urn:li:share:${postId}`,
//       postId
//     ];

//     let finalURN = null;

//     // 5. Detect correct URN
//     for (const urn of possibleURNs) {
//       try {
//         await axios.get(
//           `${getBaseUrl()}/posts/${encodeURIComponent(urn)}?account_id=${account_id}`,
//           { headers: getHeaders() }
//         );
//         finalURN = urn;
//         console.log(`✅ Found working URN: ${urn}`);
//         break;
//       } catch (error) {
//         console.log(`⚠️ URN ${urn} failed:`, error.response?.status);
//         continue;
//       }
//     }

//     if (!finalURN) {
//       return res.status(400).json({
//         success: false,
//         error: "Could not access post. It may be private or invalid.",
//       });
//     }

//     // 6. Fetch engagement (parallel)
//     const [commentsRes, reactionsRes] = await Promise.allSettled([
//       axios.get(
//         `${getBaseUrl()}/posts/${encodeURIComponent(finalURN)}/comments?account_id=${account_id}`,
//         { headers: getHeaders() }
//       ),
//       axios.get(
//         `${getBaseUrl()}/posts/${encodeURIComponent(finalURN)}/reactions?account_id=${account_id}`,
//         { headers: getHeaders() }
//       ),
//     ]);

//     // 7. Safe extraction
//     const commentsData = commentsRes.status === "fulfilled" ? commentsRes.value.data : null;
//     const reactionsData = reactionsRes.status === "fulfilled" ? reactionsRes.value.data : null;

//     // 8. Response
//     return res.json({
//       success: true,
//       post: {
//         url: post_url,
//         post_id: postId,
//         urn: finalURN,
//       },
//       engagement: {
//         comments: commentsData?.items || [],
//         commenters_count: commentsData?.items?.length || 0,
//         reactions: reactionsData?.items || [],
//         likers_count: reactionsData?.items?.length || 0,
//       },
//       meta: {
//         comments_api_status: commentsRes.status,
//         reactions_api_status: reactionsRes.status,
//       },
//     });
//   } catch (err) {
//     console.error("Post engagement error:", {
//       status: err.response?.status,
//       error: err.response?.data,
//       message: err.message,
//     });

//     return res.status(err.response?.status || 500).json({
//       success: false,
//       error: err.response?.data || err.message,
//     });
//   }
// });
// v2_______________________________
// router.post("/api/unipile/linkedin/post-engagement", async (req, res) => {
//   try {
//     const { user_id, post_url } = req.body;

//     // 1. Validate input
//     if (!user_id || !post_url) {
//       return res.status(400).json({
//         success: false,
//         error: "user_id and post_url are required",
//       });
//     }

//     // 2. Get account_id from DB
//     const dbResult = await getLinkedInAccountStatus(user_id);
//     if (!dbResult.success || !dbResult.account_id) {
//       return res.status(400).json({
//         success: false,
//         error: "LinkedIn account not connected",
//       });
//     }

//     const account_id = dbResult.account_id;

//     // 3. Extract post ID and type directly from URL
//     function extractLinkedInPostInfo(url) {
//       try {
//         const cleanUrl = url.split("?")[0].replace(/\/$/, "");
        
//         console.log("🔍 Analyzing URL:", cleanUrl);
        
//         // Check for explicit type indicators in URL
//         if (cleanUrl.includes('-activity-')) {
//           const match = cleanUrl.match(/-activity-(\d+)/);
//           if (match) {
//             console.log("✅ Detected ACTIVITY type from URL pattern '-activity-'");
//             return { id: match[1], type: 'activity' };
//           }
//         }
        
//         if (cleanUrl.includes('-ugcPost-')) {
//           const match = cleanUrl.match(/-ugcPost-(\d+)/);
//           if (match) {
//             console.log("✅ Detected UGC POST type from URL pattern '-ugcPost-'");
//             return { id: match[1], type: 'ugcPost' };
//           }
//         }
        
//         if (cleanUrl.includes('-share-')) {
//           const match = cleanUrl.match(/-share-(\d+)/);
//           if (match) {
//             console.log("✅ Detected SHARE type from URL pattern '-share-'");
//             return { id: match[1], type: 'share' };
//           }
//         }
        
//         // Check for URN in URL
//         if (cleanUrl.includes('urn:li:activity:')) {
//           const match = cleanUrl.match(/urn:li:activity:(\d+)/);
//           if (match) {
//             console.log("✅ Detected ACTIVITY type from URN");
//             return { id: match[1], type: 'activity' };
//           }
//         }
        
//         if (cleanUrl.includes('urn:li:ugcPost:')) {
//           const match = cleanUrl.match(/urn:li:ugcPost:(\d+)/);
//           if (match) {
//             console.log("✅ Detected UGC POST type from URN");
//             return { id: match[1], type: 'ugcPost' };
//           }
//         }
        
//         if (cleanUrl.includes('urn:li:share:')) {
//           const match = cleanUrl.match(/urn:li:share:(\d+)/);
//           if (match) {
//             console.log("✅ Detected SHARE type from URN");
//             return { id: match[1], type: 'share' };
//           }
//         }
        
//         // Fallback: Extract any numeric ID and try to determine type
//         const patterns = [
//           { regex: /activity-(\d+)/, type: 'activity' },
//           { regex: /ugcPost-(\d+)/, type: 'ugcPost' },
//           { regex: /\/posts\/(?:view\/)?(\d+)/, type: 'share' }, // Most likely share
//           { regex: /(\d{10,})/, type: 'activity' } // Default to activity for long numbers
//         ];
        
//         for (const pattern of patterns) {
//           const match = cleanUrl.match(pattern.regex);
//           if (match) {
//             console.log(`⚠️ Using fallback detection: ${pattern.type} from pattern`);
//             return { id: match[1], type: pattern.type };
//           }
//         }
        
//         console.log("❌ No ID found in URL");
//         return null;
//       } catch (error) {
//         console.error("❌ Error extracting post info:", error);
//         return null;
//       }
//     }

//     const postInfo = extractLinkedInPostInfo(post_url);

//     if (!postInfo) {
//       return res.status(400).json({
//         success: false,
//         error: "Invalid LinkedIn post URL - could not extract post ID",
//       });
//     }

//     const { id: postId, type: detectedType } = postInfo;
//     console.log(`📊 Extracted - ID: ${postId}, Type: ${detectedType}`);

//     // 4. Build URN based on detected type
//     let finalURN;
//     switch (detectedType) {
//       case 'activity':
//         finalURN = `urn:li:activity:${postId}`;
//         break;
//       case 'ugcPost':
//         finalURN = `urn:li:ugcPost:${postId}`;
//         break;
//       case 'share':
//         finalURN = `urn:li:share:${postId}`;
//         break;
//       default:
//         finalURN = `urn:li:activity:${postId}`;
//     }
    
//     console.log(`🎯 Using URN: ${finalURN} (based on detected type: ${detectedType})`);

//     // 5. Verify the post is accessible
//     try {
//       const verifyResponse = await axios.get(
//         `${getBaseUrl()}/posts/${encodeURIComponent(finalURN)}?account_id=${account_id}`,
//         { headers: getHeaders() }
//       );
//       console.log("✅ Post verified and accessible");
//     } catch (error) {
//       console.log(`⚠️ Initial URN failed (${error.response?.status}), trying alternatives...`);
      
//       // Fallback: Try other URN formats if the detected one fails
//       const alternativeURNs = [
//         `urn:li:activity:${postId}`,
//         `urn:li:ugcPost:${postId}`,
//         `urn:li:share:${postId}`,
//         postId
//       ].filter(urn => urn !== finalURN);
      
//       let found = false;
//       for (const altURN of alternativeURNs) {
//         try {
//           await axios.get(
//             `${getBaseUrl()}/posts/${encodeURIComponent(altURN)}?account_id=${account_id}`,
//             { headers: getHeaders() }
//           );
//           finalURN = altURN;
//           console.log(`✅ Found working alternative URN: ${altURN}`);
//           found = true;
//           break;
//         } catch (altError) {
//           console.log(`⚠️ Alternative URN ${altURN} failed: ${altError.response?.status}`);
//         }
//       }
      
//       if (!found) {
//         return res.status(400).json({
//           success: false,
//           error: "Could not access post with any URN format. Post may be private or deleted.",
//         });
//       }
//     }

//     // 6. Fetch all comments with pagination
//     async function fetchAllComments(baseUrl, urn, accountId, headers) {
//       let allComments = [];
//       let offset = 0;
//       const limit = 100;
//       let hasMore = true;
//       let pageCount = 0;
      
//       console.log("📥 Starting to fetch comments...");
      
//       while (hasMore) {
//         try {
//           pageCount++;
//           console.log(`📄 Fetching comments page ${pageCount} (offset: ${offset}, limit: ${limit})`);
          
//           const response = await axios.get(
//             `${baseUrl}/posts/${encodeURIComponent(urn)}/comments?account_id=${accountId}&limit=${limit}&offset=${offset}`,
//             { headers }
//           );
          
//           const data = response.data;
//           const items = data.items || [];
          
//           console.log(`📝 Comments page ${pageCount}: received ${items.length} items`);
          
//           if (items.length > 0) {
//             allComments = allComments.concat(items);
//             offset += items.length;
            
//             // Check if there are more items
//             hasMore = data.has_more || data.hasMore || (data.paging && data.paging.next) || items.length === limit;
            
//             if (data.total_count || data.total) {
//               console.log(`📊 Total comments available: ${data.total_count || data.total}`);
//             }
//           } else {
//             hasMore = false;
//           }
          
//           // Safety limit to prevent infinite loops
//           if (pageCount > 50) {
//             console.log("⚠️ Reached maximum page limit (50) for comments");
//             hasMore = false;
//           }
          
//         } catch (error) {
//           console.log(`❌ Error fetching comments page ${pageCount}:`, error.response?.status, error.response?.data);
//           hasMore = false;
//         }
//       }
      
//       console.log(`✅ Finished fetching comments. Total collected: ${allComments.length}`);
//       return allComments;
//     }

//     // 7. Fetch all reactions with pagination
//     async function fetchAllReactions(baseUrl, urn, accountId, headers) {
//       let allReactions = [];
//       let offset = 0;
//       const limit = 100;
//       let hasMore = true;
//       let pageCount = 0;
      
//       console.log("📥 Starting to fetch reactions...");
      
//       while (hasMore) {
//         try {
//           pageCount++;
//           console.log(`📄 Fetching reactions page ${pageCount} (offset: ${offset}, limit: ${limit})`);
          
//           const response = await axios.get(
//             `${baseUrl}/posts/${encodeURIComponent(urn)}/reactions?account_id=${accountId}&limit=${limit}&offset=${offset}`,
//             { headers }
//           );
          
//           const data = response.data;
//           const items = data.items || [];
          
//           console.log(`👍 Reactions page ${pageCount}: received ${items.length} items`);
          
//           if (items.length > 0) {
//             allReactions = allReactions.concat(items);
//             offset += items.length;
            
//             // Check if there are more items
//             hasMore = data.has_more || data.hasMore || (data.paging && data.paging.next) || items.length === limit;
            
//             if (data.total_count || data.total) {
//               console.log(`📊 Total reactions available: ${data.total_count || data.total}`);
//             }
//           } else {
//             hasMore = false;
//           }
          
//           // Safety limit
//           if (pageCount > 50) {
//             console.log("⚠️ Reached maximum page limit (50) for reactions");
//             hasMore = false;
//           }
          
//         } catch (error) {
//           console.log(`❌ Error fetching reactions page ${pageCount}:`, error.response?.status, error.response?.data);
//           hasMore = false;
//         }
//       }
      
//       console.log(`✅ Finished fetching reactions. Total collected: ${allReactions.length}`);
//       return allReactions;
//     }

//     // 8. Fetch engagement data in parallel
//     console.log("🚀 Starting parallel fetch of comments and reactions...");
//     const [comments, reactions] = await Promise.all([
//       fetchAllComments(getBaseUrl(), finalURN, account_id, getHeaders()),
//       fetchAllReactions(getBaseUrl(), finalURN, account_id, getHeaders())
//     ]);

//     // 9. Log summary
//     console.log("📈 Final Results:", {
//       postId,
//       detectedType,
//       finalURN,
//       totalComments: comments.length,
//       totalReactions: reactions.length
//     });

//     // 10. Response
//     return res.json({
//       success: true,
//       post: {
//         url: post_url,
//         post_id: postId,
//         detected_type: detectedType,
//         urn: finalURN,
//       },
//       engagement: {
//         comments: comments,
//         commenters_count: comments.length,
//         reactions: reactions,
//         likers_count: reactions.length,
//       },
//       meta: {
//         comments_pages_fetched: Math.ceil(comments.length / 100),
//         reactions_pages_fetched: Math.ceil(reactions.length / 100),
//       },
//     });
    
//   } catch (err) {
//     console.error("❌ Post engagement error:", {
//       status: err.response?.status,
//       error: err.response?.data,
//       message: err.message,
//       stack: err.stack
//     });

//     return res.status(err.response?.status || 500).json({
//       success: false,
//       error: err.response?.data || err.message,
//     });
//   }
// });
//v3______________________________________
router.post("/api/unipile/linkedin/post-engagement", async (req, res) => {
  try {
    const { user_id, post_url, comments_cursor, reactions_cursor, limit = 50 } = req.body;

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

    // 3. Extract post ID and type directly from URL
    function extractLinkedInPostInfo(url) {
      try {
        const cleanUrl = url.split("?")[0].replace(/\/$/, "");
        
        console.log("🔍 Analyzing URL:", cleanUrl);
        
        // Check for explicit type indicators in URL
        if (cleanUrl.includes('-activity-')) {
          const match = cleanUrl.match(/-activity-(\d+)/);
          if (match) {
            console.log("✅ Detected ACTIVITY type from URL pattern '-activity-'");
            return { id: match[1], type: 'activity' };
          }
        }
        
        if (cleanUrl.includes('-ugcPost-')) {
          const match = cleanUrl.match(/-ugcPost-(\d+)/);
          if (match) {
            console.log("✅ Detected UGC POST type from URL pattern '-ugcPost-'");
            return { id: match[1], type: 'ugcPost' };
          }
        }
        
        if (cleanUrl.includes('-share-')) {
          const match = cleanUrl.match(/-share-(\d+)/);
          if (match) {
            console.log("✅ Detected SHARE type from URL pattern '-share-'");
            return { id: match[1], type: 'share' };
          }
        }
        
        // Check for URN in URL
        if (cleanUrl.includes('urn:li:activity:')) {
          const match = cleanUrl.match(/urn:li:activity:(\d+)/);
          if (match) {
            console.log("✅ Detected ACTIVITY type from URN");
            return { id: match[1], type: 'activity' };
          }
        }
        
        if (cleanUrl.includes('urn:li:ugcPost:')) {
          const match = cleanUrl.match(/urn:li:ugcPost:(\d+)/);
          if (match) {
            console.log("✅ Detected UGC POST type from URN");
            return { id: match[1], type: 'ugcPost' };
          }
        }
        
        if (cleanUrl.includes('urn:li:share:')) {
          const match = cleanUrl.match(/urn:li:share:(\d+)/);
          if (match) {
            console.log("✅ Detected SHARE type from URN");
            return { id: match[1], type: 'share' };
          }
        }
        
        // Fallback: Extract any numeric ID and try to determine type
        const patterns = [
          { regex: /activity-(\d+)/, type: 'activity' },
          { regex: /ugcPost-(\d+)/, type: 'ugcPost' },
          { regex: /\/posts\/(?:view\/)?(\d+)/, type: 'share' },
          { regex: /(\d{10,})/, type: 'activity' }
        ];
        
        for (const pattern of patterns) {
          const match = cleanUrl.match(pattern.regex);
          if (match) {
            console.log(`⚠️ Using fallback detection: ${pattern.type} from pattern`);
            return { id: match[1], type: pattern.type };
          }
        }
        
        console.log("❌ No ID found in URL");
        return null;
      } catch (error) {
        console.error("❌ Error extracting post info:", error);
        return null;
      }
    }

    const postInfo = extractLinkedInPostInfo(post_url);

    if (!postInfo) {
      return res.status(400).json({
        success: false,
        error: "Invalid LinkedIn post URL - could not extract post ID",
      });
    }

    const { id: postId, type: detectedType } = postInfo;
    console.log(`📊 Extracted - ID: ${postId}, Type: ${detectedType}`);

    // 4. Build URN based on detected type
    let finalURN;
    switch (detectedType) {
      case 'activity':
        finalURN = `urn:li:activity:${postId}`;
        break;
      case 'ugcPost':
        finalURN = `urn:li:ugcPost:${postId}`;
        break;
      case 'share':
        finalURN = `urn:li:share:${postId}`;
        break;
      default:
        finalURN = `urn:li:activity:${postId}`;
    }
    
    console.log(`🎯 Using URN: ${finalURN} (based on detected type: ${detectedType})`);

    // 5. Verify the post is accessible (only on first request without cursors)
    if (!comments_cursor && !reactions_cursor) {
      try {
        const verifyResponse = await axios.get(
          `${getBaseUrl()}/posts/${encodeURIComponent(finalURN)}?account_id=${account_id}`,
          { headers: getHeaders() }
        );
        console.log("✅ Post verified and accessible");
        
        // Store post metadata in response
        var postMetadata = {
          id: verifyResponse.data.id,
          text: verifyResponse.data.text?.substring(0, 200) + "...",
          author: verifyResponse.data.author?.name,
          comment_count: verifyResponse.data.comment_counter || 0,
          reaction_count: verifyResponse.data.reaction_counter || 0
        };
      } catch (error) {
        console.log(`⚠️ Initial URN failed (${error.response?.status}), trying alternatives...`);
        
        // Fallback: Try other URN formats
        const alternativeURNs = [
          `urn:li:activity:${postId}`,
          `urn:li:ugcPost:${postId}`,
          `urn:li:share:${postId}`,
          postId
        ].filter(urn => urn !== finalURN);
        
        let found = false;
        for (const altURN of alternativeURNs) {
          try {
            const altResponse = await axios.get(
              `${getBaseUrl()}/posts/${encodeURIComponent(altURN)}?account_id=${account_id}`,
              { headers: getHeaders() }
            );
            finalURN = altURN;
            console.log(`✅ Found working alternative URN: ${altURN}`);
            postMetadata = {
              id: altResponse.data.id,
              text: altResponse.data.text?.substring(0, 200) + "...",
              author: altResponse.data.author?.name,
              comment_count: altResponse.data.comment_counter || 0,
              reaction_count: altResponse.data.reaction_counter || 0
            };
            found = true;
            break;
          } catch (altError) {
            console.log(`⚠️ Alternative URN ${altURN} failed: ${altError.response?.status}`);
          }
        }
        
        if (!found) {
          return res.status(400).json({
            success: false,
            error: "Could not access post with any URN format. Post may be private or deleted.",
          });
        }
      }
    }

    // 6. Fetch comments with cursor-based pagination
    async function fetchCommentsPage(urn, accountId, cursor = null, limitSize = 50) {
      try {
        console.log(`📄 Fetching comments page (cursor: ${cursor || 'initial'}, limit: ${limitSize})`);
        
        let url = `${getBaseUrl()}/posts/${encodeURIComponent(urn)}/comments?account_id=${accountId}&limit=${limitSize}`;
        if (cursor) {
          url += `&cursor=${encodeURIComponent(cursor)}`;
        }
        
        const response = await axios.get(url, { headers: getHeaders() });
        const data = response.data;
        
        const items = data.items || [];
        const nextCursor = data.cursor || data.next_cursor || data.paging?.cursors?.after || null;
        const hasMore = !!(nextCursor && items.length === limitSize);
        const total = data.total_count || data.total || null;
        
        console.log(`📝 Comments page: received ${items.length} items, hasMore: ${hasMore}, total: ${total}`);
        
        return {
          items,
          next_cursor: nextCursor,
          has_more: hasMore,
          total_count: total
        };
      } catch (error) {
        console.log(`❌ Error fetching comments:`, error.response?.status, error.response?.data);
        return {
          items: [],
          next_cursor: null,
          has_more: false,
          total_count: 0,
          error: error.response?.data || error.message
        };
      }
    }

    // 7. Fetch reactions with cursor-based pagination
    async function fetchReactionsPage(urn, accountId, cursor = null, limitSize = 50) {
      try {
        console.log(`📄 Fetching reactions page (cursor: ${cursor || 'initial'}, limit: ${limitSize})`);
        
        let url = `${getBaseUrl()}/posts/${encodeURIComponent(urn)}/reactions?account_id=${accountId}&limit=${limitSize}`;
        if (cursor) {
          url += `&cursor=${encodeURIComponent(cursor)}`;
        }
        
        const response = await axios.get(url, { headers: getHeaders() });
        const data = response.data;
        
        const items = data.items || [];
        const nextCursor = data.cursor || data.next_cursor || data.paging?.cursors?.after || null;
        const hasMore = !!(nextCursor && items.length === limitSize);
        const total = data.total_count || data.total || null;
        
        console.log(`👍 Reactions page: received ${items.length} items, hasMore: ${hasMore}, total: ${total}`);
        
        return {
          items,
          next_cursor: nextCursor,
          has_more: hasMore,
          total_count: total
        };
      } catch (error) {
        console.log(`❌ Error fetching reactions:`, error.response?.status, error.response?.data);
        return {
          items: [],
          next_cursor: null,
          has_more: false,
          total_count: 0,
          error: error.response?.data || error.message
        };
      }
    }

    // 8. Fetch data based on request
    console.log("🚀 Fetching engagement data...");
    
    const validLimit = Math.min(parseInt(limit) || 50, 100); // Cap at 100 items per request
    
    const [commentsResult, reactionsResult] = await Promise.all([
      fetchCommentsPage(finalURN, account_id, comments_cursor, validLimit),
      fetchReactionsPage(finalURN, account_id, reactions_cursor, validLimit)
    ]);

    // 9. Log summary
    console.log("📈 Page Results:", {
      postId,
      detectedType,
      finalURN,
      commentsCount: commentsResult.items.length,
      commentsHasMore: commentsResult.has_more,
      reactionsCount: reactionsResult.items.length,
      reactionsHasMore: reactionsResult.has_more
    });

    // 10. Response with cursor-based pagination
    const response = {
      success: true,
      post: {
        url: post_url,
        post_id: postId,
        detected_type: detectedType,
        urn: finalURN,
        ...(postMetadata && { metadata: postMetadata })
      },
      engagement: {
        comments: {
          data: commentsResult.items,
          pagination: {
            has_more: commentsResult.has_more,
            next_cursor: commentsResult.next_cursor,
            total_count: commentsResult.total_count,
            current_count: commentsResult.items.length
          }
        },
        reactions: {
          data: reactionsResult.items,
          pagination: {
            has_more: reactionsResult.has_more,
            next_cursor: reactionsResult.next_cursor,
            total_count: reactionsResult.total_count,
            current_count: reactionsResult.items.length
          }
        }
      },
      // Include next cursors at top level for easy access
      next_cursors: {
        comments: commentsResult.next_cursor,
        reactions: reactionsResult.next_cursor
      }
    };

    return res.json(response);
    
  } catch (err) {
    console.error("❌ Post engagement error:", {
      status: err.response?.status,
      error: err.response?.data,
      message: err.message,
      stack: err.stack
    });

    return res.status(err.response?.status || 500).json({
      success: false,
      error: err.response?.data || err.message,
    });
  }
});

module.exports = router;
