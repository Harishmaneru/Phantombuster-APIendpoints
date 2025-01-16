const express = require("express");
const axios = require("axios");
const yahooFinance = require('yahoo-finance2').default;
require("dotenv").config();

const router = express.Router();

const FINNHUB_API_KEY = "ctmk1m9r01qvk0t4gctgctmk1m9r01qvk0t4gcu0";

const getSymbolFromCompanyName = async (companyName) => {
  try {
    const results = await yahooFinance.search(companyName);
    if (results.quotes && results.quotes.length > 0) {

      const bestMatch = results.quotes.find(quote =>
        quote.isYahooFinance &&
        (quote.shortname?.toLowerCase().includes(companyName.toLowerCase()) ||
          quote.longname?.toLowerCase().includes(companyName.toLowerCase()))
      );

      if (bestMatch) {
        return bestMatch.symbol;
      }
    }
    throw new Error("No matching symbol found for the company name");
  } catch (error) {
    console.error("Error converting company name to symbol:", error.message);
    throw error;
  }
};

// Helper function to fetch news for the company symbol
const fetchCompanyNews = async (symbol, fromDate, toDate) => {
  try {
    console.log(`Fetching news for symbol: ${symbol} from ${fromDate} to ${toDate}`);
    const response = await axios.get(
      `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${fromDate}&to=${toDate}&token=${FINNHUB_API_KEY}`
    );
    console.log("Full API Response:", response.status);
    console.log("News API Response:", response.data.length);

    if (response.data && response.data.length > 0) {
      return response.data;
    } else {
      return [];
    }
  } catch (error) {
    console.error("Error fetching company news:", error.message);
    throw error;
  }
};

// Helper function to calculate the date range (last twenty days)
const getLastTwentyDays = () => {
  const today = new Date();
  const toDate = today.toISOString().split("T")[0];

  const twentyDaysAgo = new Date();
  twentyDaysAgo.setDate(today.getDate() - 20);
  const fromDate = twentyDaysAgo.toISOString().split("T")[0];

  return { fromDate, toDate };
};

// Endpoint to fetch company insights
router.post("/company-insights", async (req, res) => {
  const { symbol, companyName } = req.body;
  let stockSymbol = symbol;

  // If no symbol provided but company name exists, convert company name to symbol
  if (!symbol && companyName) {
    try {
      stockSymbol = await getSymbolFromCompanyName(companyName);
      console.log(`Converted company name "${companyName}" to symbol: ${stockSymbol}`);
    } catch (error) {
      console.error(`Error converting company name "${companyName}" to symbol:`, error.message);
      return res.status(200).json({
        status: "0",
        message: `No insights found for the company: ${companyName}`,
        data: {},
      });
    }
  } else if (!symbol && !companyName) {
    return res.status(200).send({
      status: "-1",
      message: "Company Name or Symbol is required",
      data: {},
    });
  }

  try {
    const response = await getCompanyInsights(stockSymbol);
    res.status(200).send(response);
  } catch (error) {
    console.error("Error in /company-insights endpoint:", error.message);
    res.status(500).json({ error: "Failed to fetch company insights" });
  }
});

const getCompanyInsights = async (symbol) => {
  try {
    if (!symbol) {
      return {
        status: "-1",
        message: "Symbol is required",
        data: {},
      };
    }

    const { fromDate, toDate } = getLastTwentyDays();
    const news = await fetchCompanyNews(symbol, fromDate, toDate);

    if (news.length === 0) {
      return {
        status: "0",
        message: "No relevant news articles found for the company symbol.",
        data: {},
      };
    }

    const relevantKeywords = [
      "funding",
      "launch",
      "product",
      "announcement",
      "raise",
      "investment",
    ];

    const filteredNews = news.filter((article) =>
      relevantKeywords.some(
        (keyword) =>
          article.headline.toLowerCase().includes(keyword) ||
          (article.summary && article.summary.toLowerCase().includes(keyword))
      )
    );

    if (filteredNews.length === 0) {
      return {
        status: "0",
        message: "No relevant news articles found matching the criteria.",
        data: {},
      };
    }

    return {
      status: "1",
      message: "Success",
      data: filteredNews,
    };
  } catch (error) {
    console.error("Error fetching company insights:", error.message);
    return {
      status: "-1",
      message: error.message,
      data: {},
    };
  }
};

module.exports = {
  router,
  getCompanyInsights
};
