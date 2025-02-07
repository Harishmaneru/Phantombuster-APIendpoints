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
            message: "LinkedIn URL is required.",
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
            console.log(`Found ${response.data.data.length} posts,`);
            
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
                message: "No posts found for the provided company.",
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

            // Return the actual API error message to client
            return {
                status: "-1",
                message: error.response.data.message || error.response.statusText,
                error: error.response.data,
                data: {}
            };
        }

        // Generic error handling if no response object
        return {
            status: "-1",
            message: error.message || "Failed to fetch company posts.",
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
        
        // Set appropriate HTTP status code
        // const httpStatus = response.status === "-1" ? 500 : 200;
        
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