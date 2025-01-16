


require('dotenv').config();
const express = require('express');
const axios = require('axios');
const router = express.Router();

const RAPIDAPI_HOST = 'linkedin-data-api.p.rapidapi.com';
const RAPIDAPI_KEY = '7cc4e8cf11msh7c088d04e04b847p1f6f44jsnd42e7a941558';
const RAPIDAPI_URL = 'https://linkedin-data-api.p.rapidapi.com/get-user-articles';

// Fetch company articles function
const fetchCompanyArticles = async (linkedinUrl) => {
    if (!linkedinUrl) {
        console.log('Missing LinkedIn URL.');
        return {
            status: "-1",
            message: "LinkedIn URL is required.",
            data: {}
        };
    }

    try {
        const response = await axios.get(RAPIDAPI_URL, {
            headers: {
                'x-rapidapi-host': RAPIDAPI_HOST,
                'x-rapidapi-key': RAPIDAPI_KEY
            },
            params: {
                url: linkedinUrl
            }
        });

        console.log('Successfully fetched articles:', response.data);

        if (response.data && Array.isArray(response.data.articles) && response.data.articles.length > 0) {
            return {
                status: "1",
                message: "Successfully fetched articles.",
                data: response.data.articles
            };
        } else {
            console.log('No articles found for the given LinkedIn URL.');
            return {
                status: "0",
                message: "No articles found for the provided LinkedIn URL.",
                data: {}
            };
        }
    } catch (error) {
        console.error('Error fetching articles:', error);

        // Return the raw response from the API if available
        return {
            status: "-1",
            message: "Failed to fetch articles.",
            errorDetails: error.response?.data || error.message,
            data: {}
        };
    }
};

// API Endpoint to fetch articles for a company
router.post('/getCompanyArticles', async (req, res) => {
    const { linkedinUrl } = req.body;
    console.log('Request received with body:', req.body);

    if (!linkedinUrl) {
        return res.status(400).json({
            status: "-1",
            message: "LinkedIn URL is required.",
            data: {}
        });
    }

    try {
        // Fetch articles using the provided LinkedIn URL
        const response = await fetchCompanyArticles(linkedinUrl);
        res.status(200).send(response);
    } catch (error) {
        console.error('Error in endpoint:', error);

        // Send the raw error details to the client
        res.status(500).json({
            status: "-1",
            message: "An error occurred while processing your request.",
            errorDetails: error.response?.data || error.message,
            data: {}
        });
    }
});

module.exports = {
    router,
    fetchCompanyArticles
};
