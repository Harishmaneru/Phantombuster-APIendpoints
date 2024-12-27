const express = require("express");
const axios = require("axios");
require("dotenv").config();

const router = express.Router();

// Finnhub API Key
const FINNHUB_API_KEY =  "ctmk1m9r01qvk0t4gctgctmk1m9r01qvk0t4gcu0"; 

// Helper function to fetch news for the company symbol
const fetchCompanyNews = async (symbol, fromDate, toDate) => {
  try {
    console.log(`Fetching news for symbol: ${symbol} from ${fromDate} to ${toDate}`);
    const response = await axios.get(
      `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${fromDate}&to=${toDate}&token=${FINNHUB_API_KEY}`
    );
    console.log("News API Response:", response.data);

    if (response.data && response.data.length > 0) {
      return response.data;
    } else {
      throw new Error("No news articles found");
    }
  } catch (error) {
    console.error("Error fetching company news:", error.message);
    throw error;
  }
};

// Helper function to calculate the date range (last two months)
const getLastTwoMonths = () => {
  const today = new Date();
  const toDate = today.toISOString().split("T")[0];

  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(today.getMonth() - 2);
  const fromDate = twoMonthsAgo.toISOString().split("T")[0];

  return { fromDate, toDate };
};

// Endpoint to fetch company insights
router.post("/company-insights", async (req, res) => {
  const { symbol } = req.body;

  if (!symbol) {
    return res.status(400).json({ error: "Symbol is required" });
  }

  try {
    // Get date range for the last two months
    const { fromDate, toDate } = getLastTwoMonths();

    // Fetch news articles
    const news = await fetchCompanyNews(symbol, fromDate, toDate);

    // Filter relevant news (press announcements, funding, product launches)
    const relevantKeywords = ["funding", "launch", "product", "announcement", "raise", "investment"];
    const filteredNews = news.filter((article) =>
      relevantKeywords.some((keyword) =>
        article.headline.toLowerCase().includes(keyword) ||
        (article.summary && article.summary.toLowerCase().includes(keyword))
      )
    );

    res.json({
      status: "success",
      symbol,
      news: filteredNews,
    });
  } catch (error) {
    console.error("Error in /company-insights endpoint:", error.message);
    res.status(500).json({ error: "Failed to fetch company insights" });
  }
});

module.exports = router;


// const express = require("express");
// const axios = require("axios");

// const router = express.Router();


// const NEWS_API_KEY = 'e23d779b043249d4a47e58ecd217b9ea';

// // POST endpoint to fetch news data
// router.post("/fetchNews", async (req, res) => {
//     const { query, language } = req.body;

//     console.log("Received request to fetch news with query:", query, "and language:", language);

//     if (!query) {
//         console.error("Error: Query parameter is missing");
//         return res.status(400).json({ error: "Query parameter is required" });
//     }

//     try {
//         // Fetch news from NewsAPI
//         console.log("Fetching news from NewsAPI...");
//         const response = await axios.get(
//             `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&apiKey=${NEWS_API_KEY}&language=${language || "en"}`
//         );

//         const newsData = response.data;

//         if (!newsData.articles || newsData.articles.length === 0) {
//             console.warn("No results found for the given query.");
//             return res.status(404).json({ message: "No news found for the given query." });
//         }

//         // Format the response
//         console.log("Formatting news data...");
//         const formattedResults = newsData.articles.map((article) => ({
//             title: article.title,
//             description: article.description,
//             source: article.source.name,
//             link: article.url,
//             published_date: article.publishedAt,
//         }));

//         console.log("News fetched successfully.");
//         res.json({
//             status: "success",
//             results: formattedResults,
//         });
//     } catch (error) {
//         console.error("Error fetching news from NewsAPI:", error.message);
//         res.status(500).json({ error: "Failed to fetch news. Please try again later." });
//     }
// });

// module.exports = router;
