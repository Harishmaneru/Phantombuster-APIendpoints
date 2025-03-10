require('dotenv').config();
const express = require('express');
const axios = require('axios');
const router = express.Router();

const RAPIDAPI_HOST = 'fresh-linkedin-profile-data.p.rapidapi.com';
const RAPIDAPI_KEY = '9844a765dbmsh2921a4931f5e3acp19930bjsneb132c95f806' //Rajiv Account (pro plan)
const RAPIDAPI_URL = 'https://fresh-linkedin-profile-data.p.rapidapi.com/get-company-posts';

const fetchCompanyPosts = async (companyUrl) => {
    console.log('Input LinkedIn URL:', companyUrl);

    if (!companyUrl) {
        console.log('Error: Missing LinkedIn URL');
        return {
            status: "-1",
            message: "Please provide a valid LinkedIn company URL to fetch posts.",
            data: {}
        };
    }

    try {
        const response = await axios.get(RAPIDAPI_URL, {
            headers: {
                'x-rapidapi-host': RAPIDAPI_HOST,
                'x-rapidapi-key': RAPIDAPI_KEY
            },
            params: {
                linkedin_url: companyUrl,
                start: 0,
                sort_by: 'top'
            }
        });

        console.log('API Response Status:', response.status);

        if (response.data.data && response.data.data.length > 0) {
            console.log(`Found ${response.data.data.length} posts`);
            
            const limitedPosts = {
                ...response.data,
                data: response.data.data.slice(0, 6)
            };

            return {
                status: "1",
                message: "Successfully fetched company posts.",
                data: limitedPosts
            };
        } else {
            console.log('No posts found in API response');
            return {
                status: "0",
                message: "No recent posts found. The company profile might be private or inactive.",
                data: {}
            };
        }
    } catch (error) {
        console.error('API Request Error:', {
            message: error.message,
            code: error.code
        });

        // Log the detailed error response
        if (error.response) {
            console.error('API Error Response:', {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            });

            // Handle specific error cases with professional messages
            let errorMessage = "Unable to fetch company's LinkedIn posts. Please try again later.";
            
            if (error.response.data?.message?.toLowerCase().includes('not found on linkedin')) {
                errorMessage = "Unable to find company's LinkedIn profile. Please verify the company URL or name.";
            } else if (error.response.status === 404) {
                errorMessage = "LinkedIn profile not found. Please verify the company URL.";
            } else if (error.response.status === 429) {
                errorMessage = "Request limit reached. Please try again in a few minutes.";
            }

            return {
                status: "-1",
                message: errorMessage,
                error: error.response.data,
                data: {}
            };
        }

        // Generic error handling with professional message
        return {
            status: "-1",
            message: "Technical error while fetching posts. Please try again later.",
            error: error.message,
            data: {}
        };
    }
};

router.post('/getCompanyPosts', async (req, res) => {
    console.log('Received POST request to /getCompanyPosts');
    console.log('Request Body:', req.body);

    const { companyUrl } = req.body;

    if (!companyUrl) {
        console.log('Bad Request: Missing LinkedIn URL');
        return res.status(400).json({
            status: "-1",
            message: "LinkedIn URL is required.",
            data: {}
        });
    }

    try {
        console.log('Processing request for URL:', companyUrl);
        const response = await fetchCompanyPosts(companyUrl);



        console.log('Sending response:', {
            status: response.status,
            message: response.message,
            dataPresent: !!response.data
        });

        res.send(response);
    } catch (error) {
        console.error('Route Handler Error:', {
            message: error.message,
            stack: error.stack
        });

        res.status(500).json({
            status: "-1",
            message: error.message || "An error occurred while fetching company posts.",
            data: {},
            error: error.message
        });
    }
});

module.exports = {
    router,
    fetchCompanyPosts
};