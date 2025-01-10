const express = require('express');
const axios = require('axios');
const router = express.Router();

const getLinkedInProfileData = async (profileUrl) => {
    try {
        const encodedUrl = encodeURIComponent(profileUrl);
        const apiUrl = `https://linkedin-api8.p.rapidapi.com/get-profile-data-by-url?url=${encodedUrl}`;

        console.log('Requesting LinkedIn profile data for URL:', profileUrl);

        const response = await axios.get(apiUrl, {
            headers: {
                'x-rapidapi-host': 'linkedin-api8.p.rapidapi.com',
                'x-rapidapi-key': '989f4f415emsh61990bfbf21063fp14c1a4jsn58f1c4a73736'
            }
        });

        console.log('Response received:', response.data.username);
        return response.data;
    } catch (error) {
        console.error('Error fetching LinkedIn profile data:', error);
        if (error.response) {
            console.error('Error details:', error.response.data);
            throw new Error(`API Error: ${error.response.data.message || 'Unknown error'}`);
        } else if (error.request) {
            console.error('No response received:', error.request);
            throw new Error('No response received from the API');
        } else {
            console.error('Error setting up the request:', error.message);
            throw new Error(`Request Setup Error: ${error.message}`);
        }
    }
};

router.post('/getprofiledata', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'Profile URL is required' });
    }

    try {
        const profileData = await getLinkedInProfileData(url);
        res.json({ success: true, data: profileData });
    } catch (error) {
        console.error('Error handling API endpoint:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;


// const express = require('express');
// const axios = require('axios');
// const router = express.Router();

// // Validation helper
// const isValidLinkedInUrl = (url) => {
//     const linkedInUrlPattern = /^https?:\/\/([\w]+\.)?linkedin\.com\/in\/[\w\-\_]+\/?$/;
//     return linkedInUrlPattern.test(url);
// };

// // Response formatting helper
// const formatProfileResponse = (profileData) => {
//     return {
//         basicInfo: {
//             fullName: profileData.fullName || 'N/A',
//             headline: profileData.headline || 'N/A',
//             location: profileData.location || 'N/A',
//             profilePicture: profileData.profilePicture || null
//         },
//         currentPosition: profileData.currentPosition || 'N/A',
//         connections: profileData.connections || 'N/A',
//         about: profileData.about || 'N/A',
//         experience: Array.isArray(profileData.experience) ? 
//             profileData.experience.map(exp => ({
//                 title: exp.title || 'N/A',
//                 company: exp.company || 'N/A',
//                 duration: exp.duration || 'N/A',
//                 description: exp.description || 'N/A'
//             })) : []
//     };
// };

// const getLinkedInProfileData = async (profileUrl) => {
//     console.log('Starting LinkedIn profile data fetch for:', profileUrl);
    
//     if (!isValidLinkedInUrl(profileUrl)) {
//         console.error('Invalid LinkedIn URL format:', profileUrl);
//         throw new Error('Invalid LinkedIn profile URL format. Please provide a valid profile URL (e.g., https://linkedin.com/in/username)');
//     }

//     try {
//         const encodedUrl = encodeURIComponent(profileUrl);
//         const apiUrl = `https://linkedin-api8.p.rapidapi.com/get-profile-data-by-url?url=${encodedUrl}`;
        
//         console.log('📡 Making API request to RapidAPI...');
        
//         const response = await axios.get(apiUrl, {
//             headers: {
//                 'x-rapidapi-host': 'linkedin-api8.p.rapidapi.com',
//                 'x-rapidapi-key': '989f4f415emsh61990bfbf21063fp14c1a4jsn58f1c4a73736'
//             },
//             timeout: 10000 // 10 second timeout
//         });

//         if (!response.data || Object.keys(response.data).length === 0) {
//             console.warn(' Empty response received from API');
//             throw new Error('No profile data found for the provided URL');
//         }

//         console.log('Successfully retrieved profile data for:', response.data.username || profileUrl);
//         return response.data;

//     } catch (error) {
//         console.error('Error occurred while fetching LinkedIn profile data:', error);

//         if (error.response) {
//             // API responded with an error
//             console.error('API Error Details:', {
//                 status: error.response.status,
//                 data: error.response.data
//             });

//             switch (error.response.status) {
//                 case 404:
//                     throw new Error('Profile not found. Please verify the URL and try again.');
//                 case 429:
//                     throw new Error('Rate limit exceeded. Please try again later.');
//                 case 403:
//                     throw new Error('Access forbidden. Please check API credentials.');
//                 default:
//                     throw new Error(`API Error: ${error.response.data.message || 'Unknown error occurred'}`);
//             }
//         } else if (error.code === 'ECONNABORTED') {
//             console.error('Request timeout');
//             throw new Error('Request timed out. Please try again.');
//         } else if (error.request) {
//             console.error('No response received from API');
//             throw new Error('Unable to reach the LinkedIn API. Please try again later.');
//         } else {
//             console.error('Request setup error:', error.message);
//             throw new Error(`Failed to process request: ${error.message}`);
//         }
//     }
// };

// router.post('/getprofiledata', async (req, res) => {
//     console.log('Received profile data request');
    
//     const { url } = req.query;

//     // Input validation
//     if (!url) {
//         console.error('Missing URL parameter');
//         return res.status(400).json({
//             success: false,
//             error: 'Profile URL is required',
//             details: 'Please provide a LinkedIn profile URL as a query parameter'
//         });
//     }

//     try {
//         // Fetch profile data
//         const profileData = await getLinkedInProfileData(url);
        
//         // Format the response
//         const formattedData = formatProfileResponse(profileData);
        
//         console.log('Sending successful response');
//         res.json({
//             success: true,
//             message: 'Profile data retrieved successfully',
//             timestamp: new Date().toISOString(),
//             data: formattedData
//         });

//     } catch (error) {
//         console.error('Error in route handler:', error);
        
//         // Determine appropriate status code
//         let statusCode = 500;
//         if (error.message.includes('Invalid LinkedIn profile URL')) {
//             statusCode = 400;
//         } else if (error.message.includes('Profile not found')) {
//             statusCode = 404;
//         } else if (error.message.includes('Rate limit exceeded')) {
//             statusCode = 429;
//         }

//         res.status(statusCode).json({
//             success: false,
//             error: {
//                 message: error.message,
//                 code: statusCode,
//                 timestamp: new Date().toISOString()
//             },
//             suggestions: [
//                 'Verify that the LinkedIn profile URL is correct',
//                 'Ensure the profile is public',
//                 'Try again in a few minutes if you encounter rate limits'
//             ]
//         });
//     }
// });

// module.exports = router;