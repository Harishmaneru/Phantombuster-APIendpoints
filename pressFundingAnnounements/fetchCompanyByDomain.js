require('dotenv').config();
const express = require('express');
const axios = require('axios');
const router = express.Router();

const RAPIDAPI_HOST = 'fresh-linkedin-profile-data.p.rapidapi.com';
const RAPIDAPI_KEY = '7cc4e8cf11msh7c088d04e04b847p1f6f44jsnd42e7a941558';
const RAPIDAPI_URL = 'https://fresh-linkedin-profile-data.p.rapidapi.com/get-company-by-linkedinurl';


const fetchCompanyDetailsByLinkedInURL = async (linkedinUrl) => {
    if (!linkedinUrl) {
        console.log('Missing LinkedIn URL parameter.');
        return {
            status: "-1",
            message: "LinkedIn URL parameter is required.",
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

        console.log('Successfully fetched company details:', response.data);

        return {
            status: "1",
            message: "Successfully fetched company details.",
            data: response.data
        };
    } catch (error) {
        console.error('Error fetching company details:', error.message);
        return {
            status: "-1",
            message: "Failed to fetch company details.",
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
        console.log('LinkedIn URL parameter is missing in the request body.');
        return res.status(400).json({
            status: "-1",
            message: "LinkedIn URL parameter is required.",
            data: {}
        });
    }

    try {
        console.log(`Request received with LinkedIn URL: ${linkedinUrl}`);
        const response = await fetchCompanyDetailsByLinkedInURL(linkedinUrl);
        res.status(200).send(response);
    } catch (error) {
        console.error('Error occurred in /getCompanyDetailsByLinkedInURL:', error.message);
        res.status(500).json({
            status: "-1",
            message: "An error occurred while fetching company details.",
            data: {},
            error: error.message
        });
    }
});

module.exports = {
    router,
    fetchCompanyDetailsByLinkedInURL
};
