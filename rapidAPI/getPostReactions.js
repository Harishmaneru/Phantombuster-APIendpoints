const express = require('express');
const axios = require('axios');
const router = express.Router();

const getLinkedInPostReactions = async (postUrl, page) => {
    try {
        const apiUrl = 'https://linkedin-data-api.p.rapidapi.com/get-post-reactions';

        console.log('Requesting LinkedIn post reactions for URL:', postUrl);

        const response = await axios.post(apiUrl, {
            url: postUrl,
            page: parseInt(page)
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-rapidapi-host': 'linkedin-data-api.p.rapidapi.com',
                'x-rapidapi-key': '989f4f415emsh61990bfbf21063fp14c1a4jsn58f1c4a73736'
            }
        });

        if (response.data.success === false) {
            console.error('API returned an error:', response.data.message);
            throw new Error(`API Error: ${response.data.message}`);
        }

        console.log('Response received:', response.data);
        return response.data;
    } catch (error) {
        console.error('Error fetching LinkedIn post reactions:', error);
        if (error.response) {
            console.error('Error details:', error.response.data);
            throw new Error(`API Error: ${error.response.data.message || 'Unknown error'}`);
        } else if (error.request) {
            console.error('No response received:', error.request);
            throw new Error('No response received from the API');
        } else {
            console.error('Error setting up the request:', error.message);
            throw new Error(`Request Setup Error: ${error.message}`);
        }
    }
};

router.post('/getPostReactions', async (req, res) => {
    const { url, page } = req.query;

    if (!url || !page) {
        return res.status(400).json({ error: 'Post URL and page number are required' });
    }

    try {
        const postReactions = await getLinkedInPostReactions(url, page);
        res.json({ success: true, data: postReactions });
    } catch (error) {
        console.error('Error handling API endpoint:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
