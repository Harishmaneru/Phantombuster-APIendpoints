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
    
    logError('Failed to extract URN from URL', new Error('No URN found. Please ensure the LinkedIn post URL contains a valid URN.'), { url });
    return null;
};

const getLinkedInPostData = async (urn) => {
    try {
        // API calls for reactions and comments
        const [reactionsResponse, commentsResponse] = await Promise.all([
            axios.get(`https://fresh-linkedin-profile-data.p.rapidapi.com/get-post-reactions`, {
                params: { urn: urn, type: 'LIKE', page: 1 },
                headers: {
                    'x-rapidapi-host': 'fresh-linkedin-profile-data.p.rapidapi.com',
                    'x-rapidapi-key': '9844a765dbmsh2921a4931f5e3acp19930bjsneb132c95f806' //Rajiv Account pro plan
                }
            }),
            axios.get(`https://fresh-linkedin-profile-data.p.rapidapi.com/get-post-comments`, {
                params: { urn: urn, sort_by: 'Most relevant', page: 1 },
                headers: {
                    'x-rapidapi-host': 'fresh-linkedin-profile-data.p.rapidapi.com',
                    'x-rapidapi-key': '9844a765dbmsh2921a4931f5e3acp19930bjsneb132c95f806' //Rajiv Account pro plan
                }
            })
        ]);

        logInfo('Successfully retrieved reactions and comments', {
            urn,
            reactionCount: reactionsResponse.data.reactions?.length || 0,
            commentCount: commentsResponse.data.comments?.length || 0
        });

        if (reactionsResponse.data.reactions?.length === 0 && commentsResponse.data.comments?.length === 0) {
            return { status: 0, message: 'No reactions or comments found for the provided LinkedIn post.' };
        }

        return {
            status: 1,
            likes: reactionsResponse.data,
            comments: commentsResponse.data
        };
    } catch (error) {
        if (error.response) {
            logError('API request failed', error, {
                status: error.response.status,
                data: error.response.data,
                urn
            });
            throw new Error(error.response.data.message || 'An error occurred while fetching post data.');
        } else if (error.request) {
            logError('No response from API', error, { urn });
            throw new Error('Unable to reach LinkedIn API. Please try again later.');
        } else {
            logError('Request setup failed', error, { urn });
            throw new Error('Failed to process your request. Please check the URL and try again.');
        }
    }
};

const getPostDetails = async (url) => {
    if (!url) {
        return {
            status: -1,
            message: 'A LinkedIn post URL must be provided to extract data.'
        };
    }

    const urn = extractURNFromURL(url);
    if (!urn) {
        return {
            status: -1,
            message: 'The provided LinkedIn post URL does not contain a valid URN. Please verify the URL.'
        };
    }

    try {
        return await getLinkedInPostData(urn);
    } catch (error) {
        return {
            status: -1,
            message: error.message
        };
    }
};

router.post('/getPostDetails', async (req, res) => {
    const startTime = Date.now();
    const { url } = req.query;

    logInfo('Received request for post details', {
        url,
        method: req.method,
        ip: req.ip
    });

    const result = await getPostDetails(url);
    const responseTime = Date.now() - startTime;

    logInfo('Request completed', {
        url,
        status: result.status,
        responseTime
    });

    res.status(result.status === -1 ? 400 : 200).json({
        status: result.status,
        message: result.message,
        data: result.status === 1 ? result : null,
        metadata: {
            responseTime,
            timestamp: new Date().toISOString()
        }
    });
});

module.exports = {
    router,
    getPostDetails
};
