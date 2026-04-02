const express = require("express");
const axios = require("axios");
const router = express.Router();

const RAPID_API_HOST = "fresh-linkedin-profile-data.p.rapidapi.com";
const RAPID_API_KEY = "9844a765dbmsh2921a4931f5e3acp19930bjsneb132c95f806";

const salesNavLogger = require("../loggingSystem/salesNavLogger");

// async function fetchSalesNavURL(salesNavUrl, limit = 25) {
//     console.log('Starting LinkedIn Sales Navigator search with URL:', salesNavUrl, 'Limit:', limit);

//     try {
//         const payload = { url: salesNavUrl, limit: limit };
//         console.log('Initiating search request with payload:', payload);

//         // Step 1: Initiate search request
//         const initialResponse = await axios.post(
//             `https://${RAPID_API_HOST}/search-employees-by-sales-nav-url`,
//             payload,
//             {
//                 headers: {
//                     'Content-Type': 'application/json',
//                     'x-rapidapi-host': RAPID_API_HOST,
//                     'x-rapidapi-key': RAPID_API_KEY
//                 }
//             }
//         );

//         const requestId = initialResponse.data.request_id;
//         if (!requestId) {
//             throw new Error('No request ID generated from API.');
//         }
//         console.log('Search request initiated successfully. Request ID:', requestId);

//         // Step 2: Poll for status
//         let retries = 0;
//         const maxRetries = 10;
//         const retryDelay = 2000;
//         let status;

//         while (retries < maxRetries) {
//             const statusResponse = await axios.get(
//                 `https://${RAPID_API_HOST}/check-search-status?request_id=${requestId}`,
//                 {
//                     headers: {
//                         'x-rapidapi-host': RAPID_API_HOST,
//                         'x-rapidapi-key': RAPID_API_KEY
//                     }
//                 }
//             );

//             status = statusResponse.data.status;
//             console.log(`Status check attempt ${retries + 1}: ${status}`);

//             if (status === 'done') break;

//             const isProcessingStatus = ['pending', 'processing', 'in-progress', 'in_progress', 'queued'].includes(status);
//             if (isProcessingStatus) {
//                 retries++;
//                 await new Promise(resolve => setTimeout(resolve, retryDelay));
//                 continue;
//             }

//             throw new Error(`Unexpected search status: ${status}`);
//         }

//         const finalIsProcessing = ['pending', 'processing', 'in-progress', 'in_progress', 'queued'].includes(status);
//         if (retries === maxRetries && finalIsProcessing) {
//             return {
//                 status: 0,
//                 salesNavigatorQueueMessage: {
//                     request_id: requestId,
//                     search_status: status,
//                     message: `Your search is currently taking longer to resolve and is in '${status}' state in the background. Please wait and try checking the status later using your request_id.`
//                 }
//             };
//         }

//         // Step 3: Fetch results if done
//         const resultResponse = await axios.get(
//             `https://${RAPID_API_HOST}/get-search-results?request_id=${requestId}&page=1`,
//             {
//                 headers: {
//                     'x-rapidapi-host': RAPID_API_HOST,
//                     'x-rapidapi-key': RAPID_API_KEY
//                 }
//             }
//         );

//         return resultResponse.data;

//     } catch (error) {
//         console.error('Error in fetchSalesNavURL:', {
//             message: error.message,
//             apiResponse: error.response?.data || 'No API response available'
//         });
//         throw error;
//     }
// }
async function fetchSalesNavURL(salesNavUrl, limit = 25) {
  console.log("Starting LinkedIn Sales Navigator search...");

  try {
    const payload = { url: salesNavUrl, limit: limit };
    // --- Step 1: Initiate ---
    const initialResponse = await axios.post(
      `https://${RAPID_API_HOST}/search-employees-by-sales-nav-url`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "x-rapidapi-host": RAPID_API_HOST,
          "x-rapidapi-key": RAPID_API_KEY,
        },
      },
    );

    // LOG INITIAL CREDITS
    console.log(
      `[Step 1] Credits Remaining: ${initialResponse.headers["x-ratelimit-credits-remaining"]}`,
    );

    const requestId = initialResponse.data.request_id;
    if (!requestId) {
      salesNavLogger.logError(null, "No request ID generated.", { url: salesNavUrl });
      throw new Error("No request ID generated.");
    }

    // Log initiation
    salesNavLogger.logInitiation(requestId, salesNavUrl, limit);

    // --- Step 2: Polling ---
    let retries = 0;
    const maxRetries = 10;
    const retryDelay = 5000; // RECOMMENDATION: Increase to 5s to save Request Quota
    let status;
    let lastStatusHeaders = {};

    while (retries < maxRetries) {
      const statusResponse = await axios.get(
        `https://${RAPID_API_HOST}/check-search-status?request_id=${requestId}`,
        {
          headers: {
            "x-rapidapi-host": RAPID_API_HOST,
            "x-rapidapi-key": RAPID_API_KEY,
          },
        },
      );

      status = statusResponse.data.status;
      lastStatusHeaders = statusResponse.headers;

      console.log(
        `[Status Check] Status: ${status} | Requests Left: ${lastStatusHeaders["x-ratelimit-requests-remaining"]}`,
      );

      // Log polling
      salesNavLogger.logPolling(
        requestId,
        status,
        lastStatusHeaders["x-ratelimit-requests-remaining"],
      );

      if (status === "done") break;

      retries++;
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }

    // --- Step 3: Fetch Results ---
    const resultResponse = await axios.get(
      `https://${RAPID_API_HOST}/get-search-results?request_id=${requestId}&page=1`,
      {
        headers: {
          "x-rapidapi-host": RAPID_API_HOST,
          "x-rapidapi-key": RAPID_API_KEY,
        },
      },
    );

    // FINAL USAGE DATA
    const finalCredits =
      resultResponse.headers["x-ratelimit-credits-remaining"];
    const finalRequests =
      resultResponse.headers["x-ratelimit-requests-remaining"];

    console.log(`--- FINAL QUOTA REPORT ---`);
    console.log(`Credits Left: ${finalCredits}`);
    console.log(`Requests Left: ${finalRequests}`);

    // Log completion
    salesNavLogger.logCompletion(requestId, "completed", {
      creditsRemaining: finalCredits,
      requestsRemaining: finalRequests,
    });

    // Return the data PLUS the usage info and requestId
    return {
      requestId: requestId,
      data: resultResponse.data,
      usage: {
        creditsRemaining: finalCredits,
        requestsRemaining: finalRequests,
      },
    };
  } catch (error) {
    console.error("Error in fetchSalesNavURL:", error.message);
    salesNavLogger.logError(null, error.message, {
      apiResponse: error.response?.data || null,
    });
    throw error;
  }
}
async function getSearchResults(requestId) {
  try {
    const statusResponse = await axios.get(
      `https://${RAPID_API_HOST}/check-search-status?request_id=${requestId}`,
      {
        headers: {
          "x-rapidapi-host": RAPID_API_HOST,
          "x-rapidapi-key": RAPID_API_KEY,
        },
      },
    );

    if (statusResponse.data.status !== "done") {
      return {
        requestId,
        status: statusResponse.data.status,
        message: statusResponse.data.message || "Search still in progress",
      };
    }

    const resultsResponse = await axios.get(
      `https://${RAPID_API_HOST}/get-search-results?request_id=${requestId}&page=1`,
      {
        headers: {
          "x-rapidapi-host": RAPID_API_HOST,
          "x-rapidapi-key": RAPID_API_KEY,
        },
      },
    );

    return { status: "completed", requestId, data: resultsResponse.data };
  } catch (error) {
    console.error("Error in getSearchResults:", {
      message: error.message,
      apiResponse: error.response?.data || "No API response available",
    });
    salesNavLogger.logError(requestId, error.message, {
      apiResponse: error.response?.data || "No API response available",
    });
    throw error;
  }
}

// Route 1: Find employees by Sales Navigator URL
router.post("/find-employees", async (req, res) => {
  try {
    const { salesNavUrl, limit } = req.body;

    if (!salesNavUrl) {
      return res.status(400).json({
        status: -1,
        salesNavigatorDataError: {
          message: "Sales Navigator URL is required",
        },
      });
    }

    // Validate limit if provided
    if (limit !== undefined && (isNaN(limit) || limit < 1 || limit > 100)) {
      return res.status(400).json({
        status: -1,
        salesNavigatorDataError: {
          message: "Limit must be a number between 1 and 100",
        },
      });
    }

    const result = await fetchSalesNavURL(salesNavUrl, limit);

    // If the result already contains a salesNavigatorQueueMessage, return it directly
    if (result.salesNavigatorQueueMessage) {
      return res.status(202).json(result);
    }

    res.status(200).json({
      status: 1,
      salesNavigatorData: result,
    });
  } catch (error) {
    console.error("Error in /find-employees route:", {
      message: error.message,
      apiResponse: error.response?.data || "No API response available",
    });
    salesNavLogger.logError(null, error.message, {
      apiResponse: error.response?.data || null,
    });

    res.status(503).json({
      status: -1,
      salesNavigatorDataError: {
        message: "Error processing request",
        error: error.message,
        apiResponse: error.response?.data || null,
      },
    });
  }
});

// Route 2: Check status and get results by request_id
router.get("/search-results/:requestId", async (req, res) => {
  try {
    const { requestId } = req.params;

    if (!requestId) {
      return res.status(400).json({
        status: -1,
        salesNavigatorDataError: {
          message: "Request ID is required",
        },
      });
    }

    const result = await getSearchResults(requestId);

    if (result.status !== "completed") {
      return res.status(202).json({
        status: 0,
        salesNavigatorQueueMessage: {
          requestId: result.requestId,
          message: result.message,
          search_status: result.status,
        },
      });
    }

    res.status(200).json({
      status: 1,
      salesNavigatorData: {
        requestId: result.requestId,
        data: result.data,
      },
    });
  } catch (error) {
    console.error("Error in /search-results route:", {
      message: error.message,
      apiResponse: error.response?.data || "No API response available",
    });

    res.status(503).json({
      status: -1,
      salesNavigatorDataError: {
        message: "Error retrieving search results",
        error: error.message,
        apiResponse: error.response?.data || null,
      },
    });
  }
});

module.exports = { router, fetchSalesNavURL, getSearchResults };
