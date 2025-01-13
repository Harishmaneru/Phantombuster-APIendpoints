const express = require('express');
const axios = require('axios');
const router = express.Router();

router.post('/getLinkedInCompanyData', async (req, res) => {
    console.log('Received request to fetch LinkedIn company data');
    const companyUrl = req.query.url;
    if (!companyUrl) {
        console.log('Company URL missing in request');
        return res.status(400).json({ error: 'Company URL is required as a query parameter' });
    }

    const options = {
        method: 'GET',
        url: 'https://linkedin-data-scraper4.p.rapidapi.com/company.php',
        params: { url: companyUrl },
        headers: {
            'x-rapidapi-host': 'linkedin-data-scraper4.p.rapidapi.com',
            'x-rapidapi-key': '989f4f415emsh61990bfbf21063fp14c1a4jsn58f1c4a73736'
        }
    };

    try {
        console.log('Sending request to RapidAPI endpoint');
        const response = await axios.request(options);
        if (response.data && Object.keys(response.data).length > 0) {
            console.log('Received valid response from API');
            res.status(200).json(response.data);
        } else {
            console.log('API returned an empty response');
            res.status(404).json({ error: 'No data found for the provided URL' });
        }
    } catch (error) {
        console.error('Error fetching company data:', error.message);
        if (error.response) {
            console.error('API response error:', error.response.data);
            res.status(error.response.status).json({ error: error.response.data });
        } else {
            res.status(500).json({ error: 'Failed to fetch company data', details: error.message });
        }
    }
});

module.exports = router;
