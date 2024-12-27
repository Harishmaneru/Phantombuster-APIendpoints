const express = require("express");
const axios = require("axios");

const router = express.Router();

 
const NEWSDATA_API_KEY = "pub_63365473876f8b6d85ef5a524580a985ef0c0";

 
router.post("/fetchNews", async (req, res) => {
    const { query, language } = req.body;

    console.log("Received request to fetch news with query:", query, "and language:", language);

    if (!query) {
        console.error("Error: Query parameter is missing");
        return res.status(400).json({ error: "Query parameter is required" });
    }

    try {
        // Fetch news from NewsData.io API
        console.log("Fetching news from NewsData API...");
        const response = await axios.get(
            `https://newsdata.io/api/1/news?apikey=${NEWSDATA_API_KEY}&q=${query}&language=${language || "en"}`
        );

        const newsData = response.data;

        if (!newsData.results || newsData.results.length === 0) {
            console.warn("No results found for the given query.");
            return res.status(404).json({ message: "No news found for the given query." });
        }

        // Format the response
        console.log("Formatting news data...");
        const formattedResults = newsData.results.map((article) => ({
            title: article.title,
            description: article.description,
            source: article.source_id,
            link: article.link,
            published_date: article.pubDate,
        }));

        console.log("News fetched successfully.");
        res.json({
            status: "success",
            results: formattedResults,
        });
    } catch (error) {
        console.error("Error fetching news from NewsData API:", error.message);
        res.status(500).json({ error: "Failed to fetch news. Please try again later." });
    }
});

module.exports = router;

