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

// Function to extract company name from LinkedIn URL
const extractCompanyFromLinkedInURL = (linkedinUrl) => {
    try {
        if (!linkedinUrl) return null;

        // Handle various LinkedIn URL formats
        const urlPatterns = [
            /linkedin\.com\/company\/([^\/\?]+)/i,    
            /linkedin\.com\/school\/([^\/\?]+)/i,     
            /linkedin\.com\/organization\/([^\/\?]+)/i  
        ];

        for (const pattern of urlPatterns) {
            const match = linkedinUrl.match(pattern);
            if (match && match[1]) {
                // Convert URL-friendly format back to company name
                const companyName = match[1]
                    .replace(/-/g, ' ')           
                    .replace(/\+/g, ' ')         
                    .replace(/%20/g, ' ')         
                    .trim();
                
                return companyName;
            }
        }

        return null;
    } catch (error) {
        console.error('Error extracting company name from LinkedIn URL:', error);
        return null;
    }
};

const fetchAdzunaJobListings = async (body) => {
    console.log('Processing Adzuna job request with body:', body);
    const { companyName, linkedinUrl, jobType, location } = body;

    // Try to get company name either directly or from LinkedIn URL
    let targetCompany = companyName;
    if (!targetCompany && linkedinUrl) {
        targetCompany = extractCompanyFromLinkedInURL(linkedinUrl);
        console.log('Extracted company name from LinkedIn URL:', targetCompany);
    }

    // Validate required parameters
    if (!targetCompany && !jobType && !location) {
        console.log('Missing required parameters');
        return {
            status: "-1",
            message: "linkedinUrl is required.",
            data: {}
        };
    }

    const baseUrl = 'https://api.adzuna.com/v1/api/jobs';
    const country = 'us';
    const url = `${baseUrl}/${country}/search/1`;

    // Building the query parameters
    const params = {
        app_id: ADZUNA_APP_ID,
        app_key: ADZUNA_APP_KEY,
        results_per_page: 5
    };

    if (targetCompany) params.company = targetCompany;
    if (jobType) params.what = jobType;
    if (location) params.where = location;

    console.log('Sending request to Adzuna API with params:', params);
    
    try {
        const response = await axios.get(url, { params });
        console.log('Received response from Adzuna API:', response.status, response.statusText);
        console.log('Response data:', response.data);
        const jobListings = response.data.results;

        if (!jobListings || jobListings.length === 0) {
            console.log('No job listings found for:', { targetCompany, jobType, location });
            return {
                status: "0",
                message: `No job listings found for the given criteria`,
                data: []
            };
        }

        const enhancedResponse = jobListings.map(job => ({
            title: job.title,
            company: job.company.display_name,
            location: job.location.display_name,
            description: job.description,
            url: job.redirect_url,
            postedDate: job.created,
            salary: job.salary_min ? {
                min: job.salary_min,
                max: job.salary_max,
                currency: job.salary_is_predicted ? 'Estimated' : job.currency
            } : null
        }));

        return {
            status: "1",
            message: "Successfully fetched job listings",
            data: enhancedResponse
        };

    } catch (error) {
        console.error('Error fetching job listings from Adzuna:', error.message);
        
        if (error.response) {
            console.error('API Error Status:', error.response.status);
            console.error('API Error Data:', error.response.data);
            
            return {
                status: "-1",
                message: `Job search failed with status ${error.response.status}. Please try again later`,
                data: {}
            };
        } else if (error.request) {
            return {
                status: "-1",
                message: "No response received from the job search service",
                data: {}
            };
        } else {
            return {
                status: "-1",
                message: `Error fetching job listings: ${error.message}`,
                data: {}
            };
        }
    }
};

module.exports = {
    router,
    fetchAdzunaJobListings
};