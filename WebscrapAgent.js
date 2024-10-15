const express = require('express');
const axios = require('axios');
const router = express.Router();



// Endpoint: /webscraper
router.post('/webscraper', async (req, res) => {
    const query = req.body.query;
    let data = JSON.stringify({
        "q": query
    });
    let config = {
        method: 'post',
        url: 'https://google.serper.dev/search',
        headers: {
            'X-API-KEY': '2befb18f5d1c0a86d2a9df863e2f9742a8820fc2',
            'Content-Type': 'application/json'
        },
        data: data
    };

    try {
        const response = await axios(config);
        const results = response.data;
        if (results && results.organic) {
            res.json({
                success: true,
                data: results.organic
            });
        } else {
            res.status(404).json({ success: false, message: 'No organic results found.' });
        }
    } catch (error) {
        console.error('Error fetching search results:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching search results.',
            error: error.response ? error.response.data : error.message
        });
    }
});

module.exports = router;