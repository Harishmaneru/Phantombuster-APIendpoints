const express = require('express');
const axios = require('axios');
const router = express.Router();

router.use(express.json());

//used rapid api
// Step-by-step flow for job search
router.post('/linkdinjobsscraper', async (req, res) => {
    try {
        
        const { keywords, location } = req.body;
        if (!keywords || !location) {
            return res.status(400).json({ error: 'keywords and location are required fields' });
        }

       
        const params = {
            keywords,  
            location,  
            datePosted: 'anyTime',  
            sort: 'mostRelevant' 
        };

        const headers = {
            'x-rapidapi-host': 'linkedin-api8.p.rapidapi.com',
            'x-rapidapi-key': '989f4f415emsh61990bfbf21063fp14c1a4jsn58f1c4a73736'
        };

       
        const apiUrl = 'https://linkedin-api8.p.rapidapi.com/search-jobs';
        const response = await axios.get(apiUrl, { params, headers });
        console.log(response.data);
   
        res.status(200).json(response.data);
    } catch (error) {
        
        console.error('Error fetching job data:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Failed to fetch job data',
            details: error.response?.data || error.message
        });
    }
});

module.exports = router;