const express = require('express');
const axios = require('axios');
const router = express.Router();

const SCRAPINGDOG_API_KEY = '671f2c901b4b4c5fb20d34bf'; 


async function fetchIndeedJobListings(jobTitle, location) {
    const baseUrl = `https://api.scrapingdog.com/indeed`;
    const url = `${baseUrl}?api_key=${SCRAPINGDOG_API_KEY}&url=https://www.indeed.com/jobs?q=${encodeURIComponent(jobTitle)}&l=${encodeURIComponent(location)}`;

    try {
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error('Error fetching job listings from ScrapingDog Indeed API:', error.message);
        throw new Error('Failed to fetch job listings from ScrapingDog.');
    }
}

router.post('/getIndeedJobs', async (req, res) => {
    const { jobTitle, location } = req.body;

    if (!jobTitle || !location) {
        return res.status(400).json({
            success: false,
            message: 'Job title and location are required',
        });
    }

    try {
        const jobListings = await fetchIndeedJobListings(jobTitle, location);

        if (!jobListings || jobListings.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No job listings found for the given criteria.',
            });
        }

        res.json({
            success: true,
            jobs: jobListings,
        });
    } catch (error) {
        console.error('Error occurred:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch job listings from Indeed.',
            error: error.message,
        });
    }
});

module.exports = router;
