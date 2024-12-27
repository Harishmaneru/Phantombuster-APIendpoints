const express = require("express");
const axios = require("axios");

const router = express.Router();

// RapidAPI details
const RAPIDAPI_HOST = "get-twitter-mentions.p.rapidapi.com";
const RAPIDAPI_KEY = "9dd9bb5522msh37997afd8f8bad0p1b1ef6jsn477fea6c5f2c";

// Endpoint to fetch Twitter mentions
router.post("/twitter-mentions", async (req, res) => {
  const { companyName } = req.body;

  if (!companyName) {
    return res.status(400).json({ error: "Company name is required" });
  }

  try {
    console.log(`Fetching Twitter mentions for: ${companyName}`);

    const response = await axios.get(
      `https://${RAPIDAPI_HOST}/`,
      {
        params: {
          keyword: companyName,
          period: 7, 
        },
        headers: {
          "x-rapidapi-host": RAPIDAPI_HOST,
          "x-rapidapi-key": RAPIDAPI_KEY,
        },
      }
    );

    console.log("Response received from RapidAPI:");
    console.log('Response status:', response.status);
    console.log('Total items received:', response.data.items?.length || 0);

    const mentions = response.data; // Assuming the API directly returns mentions
    res.json({
      status: "success",
      companyName,
      period: 7,
      mentions,
    });
  } catch (error) {
    console.error("Error fetching Twitter mentions:", error.message);
    res.status(500).json({ error: "Failed to fetch Twitter mentions" });
  }
});

module.exports = router;
