const express = require('express');
const axios = require('axios');
const router = express.Router();

const ADZUNA_APP_ID = 'eb7bd0b4';   
const ADZUNA_APP_KEY = 'ece2b22a1999da408461f76e7e8560b4';  

// Function to fetch job listings from Adzuna based on jobType and location, with country hardcoded to 'us'
async function fetchAdzunaJobListings(jobType, location) {
    const baseUrl = 'https://api.adzuna.com/v1/api/jobs';
    const country = 'us';   
    const url = `${baseUrl}/${country}/search/1`;

    const params = {
        app_id: ADZUNA_APP_ID,
        app_key: ADZUNA_APP_KEY,
        what: jobType,
        where: location,
        results_per_page: 5
    };

    try {
        const response = await axios.get(url, { params });
        console.log(`Total Jobs Count: ${response.data.results.length}`);
        return response.data.results;
    } catch (error) {
        console.error('Error fetching job listings from Adzuna:', error.message);
        throw new Error('Failed to fetch job listings from Adzuna.');
    }
}

// Define the API endpoint for fetching job listings
router.post('/apigetadzunajobs', async (req, res) => {
    const { jobType, location } = req.body;
    console.log('request body:', req.body)
    // Validate jobType and location
    if (!jobType || !location) {
        return res.status(400).json({
            success: false,
            message: 'Job type and location are required',
        });
    }

    try {
        const jobListings = await fetchAdzunaJobListings(jobType, location);

        // If no job listings found
        if (jobListings.length === 0) {
            return res.status(404).json({
                success: false,
                message: `No job listings found for the given criteria.`,
            });
        }

        // Return the original Adzuna response directly without formatting
       
        res.json({
            success: true,
            count: jobListings.length,
            jobs: jobListings,   
        });
    } catch (error) {
        console.error('Error occurred:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch job listings from Adzuna.',
            error: error.message,
        });
    }
});

module.exports = router;

