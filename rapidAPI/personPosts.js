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
                'x-rapidapi-key': '9844a765dbmsh2921a4931f5e3acp19930bjsneb132c95f806' //Rajiv Account  ()
            },
        });

        // Return API response as is
        return {
            status: response.status,
            data: response.data,
            message: 'Posts fetched successfully',
        };
    } catch (error) {
        return {
            status: error.response?.status || 500,
            data: error.response?.data || {},
            message: error.message || 'An unexpected error occurred',
        };
    }
}

// POST route to get person posts
router.post('/getPersonPosts', async (req, res) => {
    const { linkedinUrl } = req.body;

    if (!linkedinUrl) {
        return res.status(400).json({
            message: 'LinkedIn URL is required.',
        });
    }

    // Call reusable method
    const result = await fetchPersonPosts(linkedinUrl);

    // Return dynamic response
    res.status(result.status).json({
        message: result.message,
        data: result.data,
    });
});

module.exports = { router, fetchPersonPosts };
