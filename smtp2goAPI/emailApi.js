const express = require("express");
const axios = require("axios");
require("dotenv").config();

const router = express.Router();

const SMTP2GO_API_BASE_URL = "https://api.smtp2go.com/v3";

/**
 * Search Sent Email Events
 * POST /api/smtp2go/activity/search
 * 
 * Searches email activity logs including events like processed, delivered,
 * soft bounce, hard bounce, opened, clicked, etc.
 * 
 * Headers or Request body (required):
 * - api_key: "your-smtp2go-api-key" (can be in header X-Smtp2go-Api-Key or body)
 * 
 * Request body (all optional):
 * - start_date: "YYYY-MM-DD"
 * - end_date: "YYYY-MM-DD"
 * - search_sender: "sender@example.com"
 * - search_recipient: "recipient@example.com"
 * - event_types: ["delivered", "opened", "clicked", "bounced", etc.]
 * - limit: number (default: 100)
 * - continue_token: string (for pagination)
 */
router.post("/activity/search", async (req, res) => {
  try {
    // Get API key from header or body
    const apiKey = req.headers["x-smtp2go-api-key"] || req.body.api_key;

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: "API key is required. Provide it in header 'X-Smtp2go-Api-Key' or in request body as 'api_key'",
      });
    }

    const {
      start_date,
      end_date,
      search_sender,
      search_recipient,
      event_types,
      limit = 100,
      continue_token,
      api_key, // Remove from request body before sending to SMTP2GO
    } = req.body;

    const requestBody = {};

    if (start_date) requestBody.start_date = start_date;
    if (end_date) requestBody.end_date = end_date;
    if (search_sender) requestBody.search_sender = search_sender;
    if (search_recipient) requestBody.search_recipient = search_recipient;
    if (event_types && Array.isArray(event_types)) {
      requestBody.event_types = event_types;
    }
    if (limit) requestBody.limit = limit;
    if (continue_token) requestBody.continue_token = continue_token;

    const response = await axios.post(
      `${SMTP2GO_API_BASE_URL}/activity/search`,
      requestBody,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Smtp2go-Api-Key": apiKey,
        },
      }
    );

    res.json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    console.error("Error searching email activity:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data?.error || error.message || "Failed to search email activity",
      details: error.response?.data,
    });
  }
});

/**
 * Bounce Report & Statistics
 * POST /api/smtp2go/stats/bounces
 * 
 * Returns bounce statistics (total sent, soft bounces, hard bounces, bounce rate)
 * for the last ~30 days.
 * 
 * Headers or Request body (required):
 * - api_key: "your-smtp2go-api-key" (can be in header X-Smtp2go-Api-Key or body)
 * 
 * Request body (optional):
 * - start_date: "YYYY-MM-DD"
 * - end_date: "YYYY-MM-DD"
 * - search_sender: "sender@example.com"
 */
router.post("/stats/bounces", async (req, res) => {
  try {
    // Get API key from header or body
    const apiKey = req.headers["x-smtp2go-api-key"] || req.body.api_key;

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: "API key is required. Provide it in header 'X-Smtp2go-Api-Key' or in request body as 'api_key'",
      });
    }

    const { start_date, end_date, search_sender, api_key } = req.body;

    const requestBody = {};

    if (start_date) requestBody.start_date = start_date;
    if (end_date) requestBody.end_date = end_date;
    if (search_sender) requestBody.search_sender = search_sender;

    const response = await axios.post(
      `${SMTP2GO_API_BASE_URL}/stats/email_bounces`,
      Object.keys(requestBody).length > 0 ? requestBody : {},
      {
        headers: {
          "Content-Type": "application/json",
          "X-Smtp2go-Api-Key": apiKey,
        },
      }
    );

    res.json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    console.error("Error fetching bounce statistics:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data?.error || error.message || "Failed to fetch bounce statistics",
      details: error.response?.data,
    });
  }
});

module.exports = router;
