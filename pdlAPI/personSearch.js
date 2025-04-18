const express = require('express');
const axios = require('axios');
const router = express.Router();

router.use(express.json());

// Person Search Endpoint
router.post('/personsearch', async (req, res) => {
    const { location, job_company_name, job_title } = req.body;
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        return res.status(400).json({
            error: "API key is required in headers as 'x-api-key'."
        });
    }

    if (!location && !job_company_name && !job_title) {
        return res.status(400).json({
            error: "Please provide at least one of the following fields: job_company_name, location, or job_title."
        });
    }

    if (
        (location && typeof location !== 'string') ||
        (job_company_name && typeof job_company_name !== 'string') ||
        (job_title && typeof job_title !== 'string')
    ) {
        return res.status(400).json({
            error: "All input fields must be of type string."
        });
    }

    const queryObject = {
        bool: {
            must: []
        }
    };

    if (job_title) queryObject.bool.must.push({ term: { job_title } });
    if (job_company_name) queryObject.bool.must.push({ term: { job_company_name } });
    if (location) queryObject.bool.must.push({ term: { location_country: location } });

    console.log('[peopledatalabs person search api]Query Object:', JSON.stringify(queryObject, null, 2));

    const url = `https://api.peopledatalabs.com/v5/person/search`;

    try {
        const response = await axios.post(
            url,
            {
                query: queryObject,
                size: 10,
                pretty: true
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Api-Key': apiKey
                }
            }
        );

        console.log(`[peopledatalabs person search api]Total persons received: ${response.data.data.length}`);
        res.json(response.data);
    } catch (error) {
        console.error('[peopledatalabs person search api]Error fetching data:', error.response ? error.response.data : error.message);
        res.status(500).json({
            error: error.response ? error.response.data : error.message
        });
    }
});

module.exports = router;