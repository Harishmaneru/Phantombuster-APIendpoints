const express = require('express');
const axios = require('axios');

const router = express.Router();

router.post('/linkdinjobsscraper', async (req, res) => {
    try {
        const { keywords, location } = req.body;

      
        if (!keywords || !location) {
            return res.status(400).json({ error: 'keywords and location are required fields' });
        }

        // Step 1: Resolve location name to locationId using the secondary API
        const locationApiUrl = 'https://linkedin-data-api.p.rapidapi.com/search-locations';
        const locationHeaders = {
            'x-rapidapi-host': 'linkedin-data-api.p.rapidapi.com',
            'x-rapidapi-key': '989f4f415emsh61990bfbf21063fp14c1a4jsn58f1c4a73736'
        };
        const locationParams = { keyword: location };

        const locationResponse = await axios.get(locationApiUrl, { params: locationParams, headers: locationHeaders });
        console.log('Search Location API Response:', locationResponse.data.success);

  
        const items = locationResponse.data?.data?.items;
        console.log('LocationId:', items);
        if (!items || items.length === 0) {
            return res.status(404).json({ error: `Unable to find locationId for location: ${location}` });
        }

        // Extract the locationId from the first item in the array
        const locationId = items[0]?.id?.split(':').pop(); // Extract numeric part of ID
        if (!locationId) {
            return res.status(404).json({ error: `No valid locationId found for location: ${location}` });
        }
        console.log('Extracted LocationId:', locationId);

        // Step 2: Call the LinkedIn job search API with resolved locationId
        const jobApiUrl = 'https://linkedin-data-api.p.rapidapi.com/search-jobs-v2';
        const jobHeaders = {
            'x-rapidapi-host': 'linkedin-data-api.p.rapidapi.com',
            'x-rapidapi-key': '989f4f415emsh61990bfbf21063fp14c1a4jsn58f1c4a73736'
        };
        const jobParams = {
            keywords,
            locationId,
            datePosted: 'anyTime',
            sort: 'mostRelevant'
        };

        const jobResponse = await axios.get(jobApiUrl, { params: jobParams, headers: jobHeaders });
        console.log('Search Jobs API Response:', jobResponse.data.success);

        // Step 3: Return the job search results
        res.status(200).json(jobResponse.data);
    } catch (error) {
        console.error('Error in LinkedIn job scraper:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Failed to fetch job data',
            details: error.response?.data || error.message
        });
    }
});
  //get job more details by job Url
  router.post('/getdeepjobdetails', async (req, res) => {
    try {
        const { jobUrl } = req.body;

        if (!jobUrl) {
            return res.status(400).json({ error: 'jobUrl is a required field' });
        }

        const jobDetailsApiUrl = 'https://fresh-linkedin-profile-data.p.rapidapi.com/get-job-details';
        const jobDetailsHeaders = {
            'x-rapidapi-host': 'fresh-linkedin-profile-data.p.rapidapi.com',
            'x-rapidapi-key': '989f4f415emsh61990bfbf21063fp14c1a4jsn58f1c4a73736'
        };
        const jobDetailsParams = {
            job_url: jobUrl,
            include_skills: false,
            include_hiring_team: true
        };

        const jobDetailsResponse = await axios.get(jobDetailsApiUrl, { params: jobDetailsParams, headers: jobDetailsHeaders });
        console.log('More JobDetails API Response:', jobDetailsResponse.data.message);
        res.status(200).json(jobDetailsResponse.data);
    } catch (error) {
        console.error('Error in getting job details:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Failed to fetch job details',
            details: error.response?.data || error.message
        });
    }
});




module.exports = router;
