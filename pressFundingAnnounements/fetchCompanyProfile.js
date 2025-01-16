require('dotenv').config();
const express = require('express');
const axios = require('axios');
const router = express.Router();

const RAPIDAPI_HOST = 'fresh-linkedin-profile-data.p.rapidapi.com';
const RAPIDAPI_KEY = '9dd9bb5522msh37997afd8f8bad0p1b1ef6jsn477fea6c5f2c';
const RAPIDAPI_URL = 'https://fresh-linkedin-profile-data.p.rapidapi.com/get-company-posts';

const fetchCompanyPosts = async (linkedinUrl) => {
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
                linkedin_url: linkedinUrl,
                start: 0,
                sort_by: 'top'
            }
        });

        console.log('Successfully fetched company posts:', response.data.message);

        if (response.data.data && response.data.data.length > 0) {
            // Limit to last 3 posts
            const limitedPosts = {
                ...response.data,
                data: response.data.data.slice(0, 3)  // Take only first 3 posts
            };

            return {
                status: "1",
                message: "Successfully fetched last 3 company posts.",
                data: limitedPosts
            };
        } else {
            console.log('No posts found for the given LinkedIn URL.');
            return {
                status: "0",
                message: "No posts found for the provided company.",
                data: {}
            };
        }
    } catch (error) {
        console.error('Error fetching company posts:', error.message);
        return {
            status: "-1",
            message: "Failed to fetch company posts.",
            error: error.message,
            data: {}
        };
    }
};

router.post('/getCompanyPosts', async (req, res) => {
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
        const finalLinkedinUrl = linkedinUrl;
        const response = await fetchCompanyPosts(finalLinkedinUrl);
        res.status(200).send(response);
    } catch (error) {
        res.status(500).json({
            status: "-1",
            message: "An error occurred while fetching company posts.",
            data: {},
            error: error.message
        });
    }
});

module.exports = {
    router,
    fetchCompanyPosts
};
