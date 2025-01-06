require('dotenv').config();
const express = require('express');
const axios = require('axios');
const router = express.Router();

const RAPIDAPI_HOST = 'linkedin-data-api.p.rapidapi.com';
const RAPIDAPI_KEY = '7cc4e8cf11msh7c088d04e04b847p1f6f44jsnd42e7a941558';
const RAPIDAPI_URL = 'https://linkedin-data-api.p.rapidapi.com/get-user-articles';


const fetchCompanyArticles = async (linkedinUrl, username) => {
    if (!linkedinUrl || !username) {
        console.log('Missing LinkedIn URL or username.');
        return {
            status: "-1",
            message: "LinkedIn URL and username are required.",
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
                url: linkedinUrl,
                username: username
            }
        });

        console.log('Successfully fetched articles:', response.data);

        return {
            status: "1",
            // message: "Successfully fetched articles.",
            data: response.data
        };
    } catch (error) {
        console.error('Error fetching articles:', error.message);
        return {
            status: "-1",
            message: "Failed to fetch articles.",
            error: error.message,
            data: {}
        };
    }
};


 // API Endpoint to fetch articles for a company

router.post('/getCompanyArticles', async (req, res) => {
    const { companyName } = req.body;
    console.log('Request received with body:', req.body);
    if (!companyName) {
        return res.status(400).json({
            status: "-1",
            message: "Company name is required.",
            data: {}
        });
    }

    try {
        // Construct LinkedIn profile URL and username dynamically
        const linkedinUrl = `https://www.linkedin.com/company/${companyName}/`;
        const username = "Fetch" 

        // Fetch articles using the constructed parameters
        const response = await fetchCompanyArticles(linkedinUrl, username);
        res.status(200).send(response);
    } catch (error) {
        res.status(500).json({
            status: "-1",
            message: "An error occurred while fetching articles.",
            data: {},
            error: error.message
        });
    }
});

module.exports = {
    router,
    fetchCompanyArticles
};
