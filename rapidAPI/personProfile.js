const express = require('express');
const axios = require('axios');
const router = express.Router();

const getLinkedInProfileData = async (profileUrl) => {
    try {
        const apiUrl = 'https://linkedin-data-api.p.rapidapi.com/get-profile-data-by-url';

        console.log('Requesting LinkedIn profile data for URL:', profileUrl);

        const response = await axios.get(apiUrl, {
            params: { url: profileUrl },
            headers: {
                'x-rapidapi-host': 'linkedin-data-api.p.rapidapi.com',
                'x-rapidapi-key': '9844a765dbmsh2921a4931f5e3acp19930bjsneb132c95f806' //Rajiv Account (pro plan)
            }
        });

        console.log('Response received:', response.data.username);
        return response.data;
    } catch (error) {
        console.error('Error fetching LinkedIn profile data:', error);
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

router.post('/getProfileData', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'Profile URL is required' });
    }

    try {
        const profileData = await getLinkedInProfileData(url);
        res.json({ success: true, data: profileData });
    } catch (error) {
        console.error('Error handling API endpoint:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
