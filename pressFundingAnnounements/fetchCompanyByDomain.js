
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const router = express.Router();

const RAPIDAPI_HOST = 'fresh-linkedin-profile-data.p.rapidapi.com';
const RAPIDAPI_KEY = '9844a765dbmsh2921a4931f5e3acp19930bjsneb132c95f806'; //rajiv paid account key
const RAPIDAPI_URL = 'https://fresh-linkedin-profile-data.p.rapidapi.com/get-company-by-linkedinurl';

const fetchCompanyDetailsByLinkedInURL = async (linkedinUrl) => {
    if (!linkedinUrl) {
        return {
            status: "-1",
            message: "LinkedIn URL is required. Please provide a valid LinkedIn company profile URL.",
            data: {}
        };
    }

    try {
        console.log(`Fetching company details for LinkedIn URL: ${linkedinUrl}`);
        
        const response = await axios.get(RAPIDAPI_URL, {
            headers: {
                'x-rapidapi-host': RAPIDAPI_HOST,
                'x-rapidapi-key': RAPIDAPI_KEY
            },
            params: {
                linkedin_url: linkedinUrl
            }
        });

        console.log('Successfully fetched company details:', response.data.data.company_name);

        return {
            status: "1",
            message: "Successfully fetched company details.",
            data: response.data
        };
    } catch (error) {
        console.error('Error fetching company details:', error.message);

        let apiMessage = "An unexpected error occurred.";
        let apiStatus = "-1";

        // Extract message and status from RapidAPI response, if available
        if (error.response && error.response.data) {
            apiMessage = error.response.data.message || apiMessage;
            apiStatus = error.response.data.status || apiStatus;
        }

        // Handle specific known cases like 429 rate limit
        if (error.response && error.response.status === 429) {
            apiMessage = error.response.data.message || "Too many requests. Please wait or upgrade your plan.";
        }

        return {
            status: apiStatus,
            message: apiMessage,
            error: error.message,
            data: {}
        };
    }
};

/**
 * API Endpoint to Fetch Company Details using LinkedIn URL
 */
router.post('/getCompanyDetails', async (req, res) => {
    const { linkedinUrl } = req.body;

    if (!linkedinUrl) {
        return res.status(400).json({
            status: "-1",
            message: "LinkedIn URL parameter is required. Please provide a valid LinkedIn company profile URL.",
            data: {}
        });
    }

    try {
        const response = await fetchCompanyDetailsByLinkedInURL(linkedinUrl);

        // If API indicates an error status, return an appropriate HTTP error code
        if (response.status === "-1") {
            return res.status(400).json(response);
        }

        // Otherwise, return successful response
        res.status(200).json(response);
    } catch (error) {
        res.status(500).json({
            status: "-1",
            message: "An internal server error occurred while fetching company details.",
            data: {},
            error: error.message
        });
    }
});

module.exports = {
    router,
    fetchCompanyDetailsByLinkedInURL
};
