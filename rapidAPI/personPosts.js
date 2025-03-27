

const express = require('express');
const router = express.Router();
const axios = require('axios');

// Reusable method to fetch LinkedIn profile posts
async function fetchPersonPosts(linkedinUrl) {
    const apiUrl = `https://fresh-linkedin-profile-data.p.rapidapi.com/get-profile-posts?linkedin_url=${encodeURIComponent(linkedinUrl)}&type=posts`;

    try {
        const response = await axios.get(apiUrl, {
            headers: {
                'x-rapidapi-host': 'fresh-linkedin-profile-data.p.rapidapi.com',
                // 'x-rapidapi-key': '9844a765dbmsh2921a4931f5e3acp19930bjsneb132c95f806' // Rajiv Account (pro plan)
                'x-rapidapi-key': '7b5216ff04mshcb5e0e42435bc24p19037djsn131b9d42a1ee'  //temparary  key
            },
        });

        // Check if posts were found
        if (response.data && response.data.data && response.data.data.length > 0) {
            return {
                status: "1",
                message: "Successfully fetched profile posts.",
                data: response.data.data.slice(0, 6), // Limit to the latest 6 posts
            };
        } else {
            return {
                status: "0",
                message: "No posts found for the provided LinkedIn URL.",
                data: {},
            };
        }
    } catch (error) {
        console.error('API Request Error:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data,
        });

        return {
            status: "-1",
            message: error.response?.data?.message || error.message || "Failed to fetch profile posts.",
            error: error.response?.data || {},
            data: {},
        };
    }
}

// POST route to get person posts
router.post('/getPersonPosts', async (req, res) => {
    const { linkedinUrl } = req.body;

    if (!linkedinUrl) {
        return res.status(400).json({
            status: "-1",
            message: "LinkedIn URL is required.",
            data: {},
        });
    }

    try {
        const result = await fetchPersonPosts(linkedinUrl);

        // Determine HTTP status based on response status
        console.log('Sending response:', {
            status: result.status,
            message: result.message,
            dataPresent: !!result.data
        });

        res.json(result);
    } catch (error) {
        console.error('Route Handler Error:', {
            message: error.message,
            stack: error.stack,
        });

        res.status(500).json({
            status: "-1",
            message: error.message || "An error occurred while fetching profile posts.",
            data: {},
            error: error.message,
        });
    }
});

module.exports = { router, fetchPersonPosts };
