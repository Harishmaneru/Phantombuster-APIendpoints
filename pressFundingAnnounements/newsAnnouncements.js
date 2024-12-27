const express = require("express");
const axios = require("axios");

const router = express.Router();


const NEWSAPI_KEY = "e23d779b043249d4a47e58ecd217b9ea";


router.post("/fetchNews", async (req, res) => {
    const response = await fetchCompanyNews(req.body);
    res.status(200).send(response);
});

const fetchCompanyNews = async (body) => {

    const { companyName } = body;

    console.log('Validating company name:', companyName);

    if (!companyName) {
        console.log(' Error: Company name is missing');
        return {
            status: "-1",
            message: "Company name parameter is required",
            data: {}
        }
    }

    try {
        // Log API request
        const apiUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(companyName)}&apiKey=${NEWSAPI_KEY}`;
        console.log('Fetching news from NewsAPI.org');
        console.log('Request URL:', apiUrl.replace(NEWSAPI_KEY, 'HIDDEN_API_KEY'));

        const response = await axios.get(apiUrl);

        // Log API response
        console.log('NewsAPI response received');
        console.log('Total articles received:', response.data.articles?.length || 0);

        const articles = response.data.articles;

        if (!articles || articles.length === 0) {
            console.log(' No articles found in API response');
            return {
                status: "-1",
                message: "No news found for the given company name.",
                data: {}
            }
        }



        // Filter articles where the title contains the company name (case insensitive)
        const filteredArticles = articles.filter((article) => {
            const hasCompanyInTitle = article.title &&
                article.title.toLowerCase().includes(companyName.toLowerCase());

            // Log individual article filtering
            // console.log('Article title:', article.title);
            // console.log('Contains company name:', hasCompanyInTitle);

            return hasCompanyInTitle;
        });

        console.log('Filtered articles count:', filteredArticles.length);

        if (filteredArticles.length === 0) {
            console.log(' No articles remained after filtering');
            return {
                status: "-1",
                message: "No relevant news found containing the company name in the title.",
                data: {}
            }
        }

        // Log formatting process
        console.log('Formatting filtered articles');

        // Format the filtered articles
        const formattedResults = filteredArticles.map((article) => {
            const formattedArticle = {
                title: article.title,
                description: article.description,
                source: article.source.name,
                link: article.url,
                published_date: article.publishedAt,
            };

            // Log individual article formatting
            // console.log('Formatted article:', formattedArticle);

            return formattedArticle;
        });

        // console.log(' Successfully processed news articles');
        console.log('Total results being sent:', formattedResults.length);

        return {
            status: "1",
            message: "success",
            data: formattedResults
        }
    } catch (error) {
        console.error("Error fetching news from NewsData API:", error.message);
        return {
            status: "-1",
            message: "Failed to fetch news. Please try again later.",
            data: {}
        }
    }
}

module.exports = {
    router,
    fetchCompanyNews
}

 

