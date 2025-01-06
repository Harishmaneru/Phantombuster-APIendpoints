const axios = require('axios');
const express = require('express');
const router = express.Router();

const RAPIDAPI_HOST = 'get-twitter-mentions.p.rapidapi.com';
const RAPIDAPI_KEY = '9dd9bb5522msh37997afd8f8bad0p1b1ef6jsn477fea6c5f2c';


const fetchTwitterMentions = async (body) => {
    console.log('Received request with body:', body);
    const { companyName, period = 7 } = body;

    if (!companyName) {
        console.log('Missing required parameter: companyName');
        return {
            status: "-1",
            message: "Company name is required.",
            data: {}
        };
    }

    console.log('Fetching Twitter mentions for:', { companyName, period });

    try {
        const response = await axios.get(`https://${RAPIDAPI_HOST}/`, {
            params: {
                keyword: companyName,
                period
            },
            headers: {
                'x-rapidapi-host': RAPIDAPI_HOST,
                'x-rapidapi-key': RAPIDAPI_KEY
            }
        });

        console.log('Received response from Twitter mentions API:', response.status, response.statusText);

        const mentions = response.data.items.map(item => ({
            username: item.username,
            tweet: item.tweet,
            postedAt: item.posted_at,
            link: `https://twitter.com/${item.username}/status/${item.id}`
        })).sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));

        console.log('Formatted Twitter mentions data:', mentions);

        if (mentions.length > 0) {
            return {
                status: "1",
                message: "Successfully fetched Twitter mentions.",
                data: mentions
            };
        } else {
            console.log('No mentions found for:', companyName);
            return {
                status: "-1",
                message: "No Twitter mentions found for the specified company.",
                data: {}
            };
        }
    } catch (error) {
        console.error('Error fetching Twitter mentions:', error.message);
        return {
            status: "-1",
            message: error.message,
            data: {}
        };
    }
};
 
router.post('/twitter-mentions', async (req, res) => {
    console.log('Received request for Twitter mentions:', req.body);

    const response = await fetchTwitterMentions(req.body);
    res.status(200).send(response);
});

module.exports = {
    router,
    fetchTwitterMentions
};
