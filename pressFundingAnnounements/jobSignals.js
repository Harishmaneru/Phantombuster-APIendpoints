const axios = require('axios');
const express = require('express');
const router = express.Router();

const ADZUNA_APP_ID = 'eb7bd0b4';
const ADZUNA_APP_KEY = 'ece2b22a1999da408461f76e7e8560b4';

router.post('/fetch-jobssignals', async (req, res) => {
    console.log('Received request with body:', req.body);
    const response = await fetchAdzunaJobListings(req.body);
    res.status(200).send(response);
});

const fetchAdzunaJobListings = async (body) => {
    console.log('Processing Adzuna job request with body:', body);
    const { companyName, jobType, location } = body;

    if (!companyName && !jobType && !location) {
        console.log('Missing required parameters:', { companyName, jobType, location });
        return {
            status: "-1",
            message: "At least one of companyName, jobType, or location is required.",
            data: {}
        };
    }

    const baseUrl = 'https://api.adzuna.com/v1/api/jobs';
    const country = 'us'; // Country hardcoded to 'us'
    const url = `${baseUrl}/${country}/search/1`;

    // Building the query parameters dynamically
    const params = {
        app_id: ADZUNA_APP_ID,
        app_key: ADZUNA_APP_KEY,
        results_per_page: 5
    };
    if (companyName) params.company = companyName;
    if (jobType) params.what = jobType;
    if (location) params.where = location;

    console.log('Sending request to Adzuna API with params:', params);
    try {
        const response = await axios.get(url, { params });
        console.log('Received response from Adzuna API:', response.status, response.statusText);

        const jobListings = response.data.results;

        if (jobListings && jobListings.length > 0) {
            const enhancedResponse = jobListings.map(job => {
                // Extracting relevant fields from job data
                return {
                    title: job.title,
                    company: job.company.display_name,
                    location: job.location.display_name,
                    description: job.description,
                    url: job.redirect_url,
                    postedDate: job.created
                };
            });

            console.log('Returning job listings to client.');
            return {
                status: "1",
                message: `Successfully fetched job listings.`,
                data: enhancedResponse
            };
        } else {
            console.log('No job listings found for:', { companyName, jobType, location });
            return {
                status: "-1",
                message: `No job listings found for the ${companyName}`,
                data: {}
            };
        }
    } catch (error) {
        console.error('Error fetching job listings from Adzuna:', error.message);
        // console.error('Full error object:', error);
        return {
            status: "-1",
            message: `No job listings found for the ${companyName}`,
            data: {}
        };
    }
};

module.exports = {
    router,
    fetchAdzunaJobListings
};
