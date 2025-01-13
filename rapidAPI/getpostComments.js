// const express = require('express');
// const axios = require('axios');
// const router = express.Router();


// const extractURNFromURL = (url) => {
//     if (!url) return null;

//     // Clean the URL first
//     const cleanUrl = decodeURIComponent(url.split('?')[0]);

//     // Different patterns for URN extraction
//     const patterns = [
//         /activity-(\d+)/,  
//         /ugcPost-(\d+)/,  
//         /-(\d{19})-/, 
//         /\/(\d{19})\//,  
//         /-(\d{18,20})[^0-9]/  
//     ];

//     // Try each pattern until we find a match
//     for (const pattern of patterns) {
//         const match = cleanUrl.match(pattern);
//         if (match && match[1]) {
//             // Validate the URN
//             const urn = match[1];
//             if (urn.length >= 18 && urn.length <= 20) { // LinkedIn URNs are typically 19 digits
//                 return urn;
//             }
//         }
//     }

//     // If no pattern matches, try to find any 19-digit number in the URL
//     const anyNumberMatch = cleanUrl.match(/(\d{19})/);
//     if (anyNumberMatch) {
//         return anyNumberMatch[1];
//     }

//     return null;
// };


// const getLinkedInPostComments = async (urn) => {
//     try {
//         const apiUrl = `https://fresh-linkedin-profile-data.p.rapidapi.com/get-post-comments?urn=${urn}&sort_by=Most%20relevant&page=1`;

//         console.log('Requesting LinkedIn post comments for URN:', urn);

//         const response = await axios.get(apiUrl, {
//             headers: {
//                 'x-rapidapi-host': 'fresh-linkedin-profile-data.p.rapidapi.com',
//                 'x-rapidapi-key': '989f4f415emsh61990bfbf21063fp14c1a4jsn58f1c4a73736'
//             }
//         });

//         if (response.data.success === false) {
//             console.error('API returned an error:', response.data.message);
//             throw new Error(`API Error: ${response.data.message}`);
//         }

//         console.log('Response received:', response.data);
//         return response.data;
//     } catch (error) {
//         console.error('Error fetching LinkedIn post comments:', error);
//         if (error.response) {
//             console.error('Error details:', error.response.data);
//             throw new Error(`API Error: ${error.response.data.message || 'Unknown error'}`);
//         } else if (error.request) {
//             console.error('No response received:', error.request);
//             throw new Error('No response received from the API');
//         } else {
//             console.error('Error setting up the request:', error.message);
//             throw new Error(`Request Setup Error: ${error.message}`);
//         }
//     }
// };

// router.post('/getPostComments', async (req, res) => {
//     const { url } = req.query;

//     if (!url) {
//         return res.status(400).json({ error: 'Post URL is required' });
//     }

//     const urn = extractURNFromURL(url);

//     if (!urn) {
//         return res.status(400).json({ error: 'Invalid LinkedIn post URL. URN not found.' });
//     }

//     try {
//         const postComments = await getLinkedInPostComments(urn);
//         res.json({ success: true, data: postComments });
//     } catch (error) {
//         console.error('Error handling API endpoint:', error);
//         res.status(500).json({ success: false, error: error.message });
//     }
// });

// module.exports = router;


const express = require('express');
const axios = require('axios');
const router = express.Router();

// Configure logging timestamps
const getTimestamp = () => new Date().toISOString();

const logError = (message, error, additionalInfo = {}) => {
    console.error(`[${getTimestamp()}] ERROR: ${message}`, {
        error: error.message,
        stack: error.stack,
        ...additionalInfo
    });
};

const logInfo = (message, data = {}) => {
    console.log(`[${getTimestamp()}] INFO: ${message}`, data);
};

const extractURNFromURL = (url) => {
    if (!url) return null;
    
    logInfo('Attempting to extract URN from URL', { url });
    
    // Clean the URL first
    const cleanUrl = decodeURIComponent(url.split('?')[0]);
    
    // Different patterns for URN extraction
    const patterns = [
        /activity-(\d+)/,
        /ugcPost-(\d+)/,
        /-(\d{19})-/,
        /\/(\d{19})\//,
        /-(\d{18,20})[^0-9]/
    ];
    
    // Try each pattern until we find a match
    for (const pattern of patterns) {
        const match = cleanUrl.match(pattern);
        if (match && match[1]) {
            // Validate the URN
            const urn = match[1];
            if (urn.length >= 18 && urn.length <= 20) {
                logInfo('Successfully extracted URN', { urn });
                return urn;
            }
        }
    }
    
    // If no pattern matches, try to find any 19-digit number in the URL
    const anyNumberMatch = cleanUrl.match(/(\d{19})/);
    if (anyNumberMatch) {
        logInfo('Extracted URN using fallback pattern', { urn: anyNumberMatch[1] });
        return anyNumberMatch[1];
    }
    
    logError('Failed to extract URN from URL', new Error('No valid URN pattern found'), { url });
    return null;
};

const getLinkedInPostComments = async (urn) => {
    try {
        const apiUrl = `https://fresh-linkedin-profile-data.p.rapidapi.com/get-post-comments?urn=${urn}&sort_by=Most%20relevant&page=1`;
        
        logInfo('Initiating LinkedIn API request', { urn, apiUrl });
        
        const response = await axios.get(apiUrl, {
            headers: {
                'x-rapidapi-host': 'fresh-linkedin-profile-data.p.rapidapi.com',
                'x-rapidapi-key': '989f4f415emsh61990bfbf21063fp14c1a4jsn58f1c4a73736'
            }
        });
        
        if (response.data.success === false) {
            logError('API returned error response', new Error(response.data.message), { urn });
            throw new Error(`API Error: ${response.data.message}`);
        }
        
        logInfo('Successfully retrieved comments', { 
            urn,
            commentCount: response.data.comments?.length || 0
        });
        
        return response.data;
    } catch (error) {
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            logError('API request failed', error, {
                status: error.response.status,
                data: error.response.data,
                urn
            });
            throw new Error(`API Error (${error.response.status}): ${error.response.data.message || 'Unknown error'}`);
        } else if (error.request) {
            // The request was made but no response was received
            logError('No response from API', error, { urn });
            throw new Error('Unable to reach LinkedIn API. Please try again later.');
        } else {
            // Something happened in setting up the request that triggered an Error
            logError('Request setup failed', error, { urn });
            throw new Error('Failed to process your request. Please check the URL and try again.');
        }
    }
};

router.post('/getPostComments', async (req, res) => {
    const startTime = Date.now();
    const { url } = req.query;
    
    logInfo('Received request for post comments', { 
        url,
        method: req.method,
        ip: req.ip
    });
    
    try {
        // Input validation
        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'Post URL is required',
                details: 'Please provide a valid LinkedIn post URL in the query parameters'
            });
        }
        
        // Extract URN
        const urn = extractURNFromURL(url);
        if (!urn) {
            return res.status(400).json({
                success: false,
                error: 'Invalid LinkedIn post URL',
                details: 'Could not extract URN from the provided URL. Please ensure it\'s a valid LinkedIn post URL'
            });
        }
        
        // Fetch comments
        const postComments = await getLinkedInPostComments(urn);
        
        const responseTime = Date.now() - startTime;
        logInfo('Request completed successfully', { 
            responseTime,
            urn,
            commentCount: postComments.comments?.length || 0
        });
        
        res.json({
            success: true,
            data: postComments,
            metadata: {
                urn,
                responseTime,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        const responseTime = Date.now() - startTime;
        logError('Request failed', error, { url, responseTime });
        
        // Send appropriate error response
        const statusCode = error.response?.status || 500;
        res.status(statusCode).json({
            success: false,
            error: error.message,
            details: 'An error occurred while fetching the post comments. Please try again later.',
            metadata: {
                timestamp: new Date().toISOString(),
                responseTime
            }
        });
    }
});

module.exports = router;