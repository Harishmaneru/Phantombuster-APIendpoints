// const express = require('express');
// const axios = require('axios');
// const router = express.Router();

// async function fetchSalesNavURL(salesNavUrl) {
//     console.log('Starting LinkedIn Sales Navigator search with URL:', salesNavUrl);
    
//     try {
//         // Step 1: Call the initial API to get the request_id
//         console.log('Initiating search request...');
//         const payload = {
//             url: salesNavUrl,
//             limit: 3
//         };

//         console.log('Request Payload:', payload);

//         const initialResponse = await axios.post('https://fresh-linkedin-profile-data.p.rapidapi.com/search-employees-by-sales-nav-url', payload, {
//             headers: {
//                 'Content-Type': 'application/json',
//                 'x-rapidapi-host': 'fresh-linkedin-profile-data.p.rapidapi.com',
//                 'x-rapidapi-key': '9844a765dbmsh2921a4931f5e3acp19930bjsneb132c95f806'
//             }
//         });

//         console.log('Initial API Response:', initialResponse.data);
        
//         const requestId = initialResponse.data.request_id;
//         if (!requestId) {
//             const error = new Error('No request ID generated from API.');
//             error.apiResponse = initialResponse.data;
//             throw error;
//         }

//         // Step 2: Check the search status
//         console.log('Checking search status for request ID:', requestId);
//         let statusResponse;
//         let retries = 0;
//         const maxRetries = 10;
//         const retryDelay = 2000; // 2 seconds

//         while (retries < maxRetries) {
//             statusResponse = await axios.get(`https://fresh-linkedin-profile-data.p.rapidapi.com/check-search-status?request_id=${requestId}`, {
//                 headers: {
//                     'x-rapidapi-host': 'fresh-linkedin-profile-data.p.rapidapi.com',
//                     'x-rapidapi-key': '9844a765dbmsh2921a4931f5e3acp19930bjsneb132c95f806'
//                 }
//             });

//             console.log(`Status check attempt ${retries + 1}:`, statusResponse.data);

//             if (statusResponse.data.status === 'done') {
//                 break;
//             }

//             retries++;
//             await new Promise(resolve => setTimeout(resolve, retryDelay));
//         }

//         if (statusResponse.data.status !== 'done') {
//             const error = new Error('Search did not complete within the retry limit.');
//             error.apiResponse = statusResponse.data;
//             throw error;
//         }

//         // Step 3: Fetch the search results
//         console.log('Fetching final search results...');
//         const resultResponse = await axios.get(`https://fresh-linkedin-profile-data.p.rapidapi.com/get-search-results?request_id=${requestId}&page=1`, {
//             headers: {
//                 'x-rapidapi-host': 'fresh-linkedin-profile-data.p.rapidapi.com',
//                 'x-rapidapi-key': '9844a765dbmsh2921a4931f5e3acp19930bjsneb132c95f806'
//             }
//         });

//         console.log('Search completed successfully');
//         return resultResponse.data;

//     } catch (error) {
//         console.error('Error in fetchSalesNavURL:', {
//             message: error.message,
//             apiResponse: error.response ? error.response.data : 'No API response available'
      
//         });
//         throw error;
//     }
// }

// // Second endpoint: Check status and get results with request_id
// async function getSearchResults(requestId) {
//     try {
//         // First check the status
//         const statusResponse = await axios.get(`https://fresh-linkedin-profile-data.p.rapidapi.com/check-search-status?request_id=${requestId}`, {
//             headers: {
//                 'x-rapidapi-host': 'fresh-linkedin-profile-data.p.rapidapi.com',
//                 'x-rapidapi-key': '9844a765dbmsh2921a4931f5e3acp19930bjsneb132c95f806'
//             }
//         });

//         console.log('Status check response:', statusResponse.data);

//         // If status is not done, return the status
//         if (statusResponse.data.status !== 'done') {
//             return {
//                 status: statusResponse.data.status,
//                 message: statusResponse.data.message || 'Search still in progress'
//             };
//         }

//         // If status is done, get the results
//         const resultsResponse = await axios.get(`https://fresh-linkedin-profile-data.p.rapidapi.com/get-search-results?request_id=${requestId}&page=1`, {
//             headers: {
//                 'x-rapidapi-host': 'fresh-linkedin-profile-data.p.rapidapi.com',
//                 'x-rapidapi-key': '9844a765dbmsh2921a4931f5e3acp19930bjsneb132c95f806'
//             }
//         });

//         return {
//             status: 'completed',
//             data: resultsResponse.data
//         };

//     } catch (error) {
//         console.error('Error in getSearchResults:', error);
//         throw error;
//     }
// }

// // Route 2: Check status and get results endpoint
// router.get('/search-results/:requestId', async (req, res) => {
//     try {
//         const { requestId } = req.params;

//         if (!requestId) {
//             return res.status(400).json({
//                 status: -1,
//                 message: 'Request ID is required'
//             });
//         }

//         const result = await getSearchResults(requestId);

//         // If search is still in progress
//         if (result.status !== 'completed') {
//             return res.status(202).json({
//                 status: 1,
//                 message: result.message,
//                 search_status: result.status
//             });
//         }

//         // If search is complete
//         res.status(200).json({
//             status: 1,
//             data: result.data
//         });

//     } catch (error) {
//         console.error('Error in search-results route:', error);
//         res.status(503).json({
//             status: -1,
//             message: 'Error retrieving search results',
//             error: error.message,
//             apiResponse: error.response?.data || null
//         });
//     }
// });

// // Route handler for fetching employees
// router.post('/find-employees', async (req, res) => {
//     try {
//         const { salesNavUrl } = req.body;

//         if (!salesNavUrl) {
//             return res.status(400).json({
//                 status: -1,
//                 message: 'Sales Navigator URL is required'
//             });
//         }

//         const result = await fetchSalesNavURL(salesNavUrl);
        
//         res.status(200).json({
//             status: 1,
//             data: result
//         });
//     } catch (error) {
//         console.error('Error in fetch-employees route:', {
//             message: error.message,
//             apiResponse: error.response ? error.response.data : 'No API response available'
//         });

//         res.status(503).json({
//             status: -1,
//             message: 'Error processing request',
//             error: error.message,
//             apiResponse: error.response ? error.response.data : null
//         });
//     }
// });

// module.exports = {
//     router,
//     fetchSalesNavURL,
//     getSearchResults
// };

const express = require('express');
const axios = require('axios');
const router = express.Router();

const RAPID_API_HOST = 'fresh-linkedin-profile-data.p.rapidapi.com';
const RAPID_API_KEY = '9844a765dbmsh2921a4931f5e3acp19930bjsneb132c95f806';

async function fetchSalesNavURL(salesNavUrl) {
    console.log('Starting LinkedIn Sales Navigator search with URL:', salesNavUrl);

    try {
        const payload = { url: salesNavUrl, limit: 25 };
        console.log('Initiating search request with payload:', payload);

        // Step 1: Initiate search request
        const initialResponse = await axios.post(
            `https://${RAPID_API_HOST}/search-employees-by-sales-nav-url`,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-rapidapi-host': RAPID_API_HOST,
                    'x-rapidapi-key': RAPID_API_KEY
                }
            }
        );

        const requestId = initialResponse.data.request_id;
        if (!requestId) {
            throw new Error('No request ID generated from API.');
        }
        console.log('Search request initiated successfully. Request ID:', requestId);

        // Step 2: Poll for status
        let retries = 0;
        const maxRetries = 10;
        const retryDelay = 2000;
        let status;

        while (retries < maxRetries) {
            const statusResponse = await axios.get(
                `https://${RAPID_API_HOST}/check-search-status?request_id=${requestId}`,
                {
                    headers: {
                        'x-rapidapi-host': RAPID_API_HOST,
                        'x-rapidapi-key': RAPID_API_KEY
                    }
                }
            );

            status = statusResponse.data.status;
            console.log(`Status check attempt ${retries + 1}: ${status}`);

            if (status === 'done') break;
            if (status === 'pending') {
                retries++;
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
            }

            throw new Error(`Unexpected search status: ${status}`);
        }

        if (retries === maxRetries && status === 'pending') {
            return {
                request_id: requestId,
                status: 'pending',
                message: 'Your search was added to queue. Please wait and try again later!'
            };
        }

        // Step 3: Fetch results if done
        const resultResponse = await axios.get(
            `https://${RAPID_API_HOST}/get-search-results?request_id=${requestId}&page=1`,
            {
                headers: {
                    'x-rapidapi-host': RAPID_API_HOST,
                    'x-rapidapi-key': RAPID_API_KEY
                }
            }
        );

        return resultResponse.data;

    } catch (error) {
        console.error('Error in fetchSalesNavURL:', {
            message: error.message,
            apiResponse: error.response?.data || 'No API response available'
        });
        throw error;
    }
}

async function getSearchResults(requestId) {
    try {
        const statusResponse = await axios.get(
            `https://${RAPID_API_HOST}/check-search-status?request_id=${requestId}`,
            {
                headers: {
                    'x-rapidapi-host': RAPID_API_HOST,
                    'x-rapidapi-key': RAPID_API_KEY
                }
            }
        );

        if (statusResponse.data.status !== 'done') {
            return {
                status: statusResponse.data.status,
                message: statusResponse.data.message || 'Search still in progress'
            };
        }

        const resultsResponse = await axios.get(
            `https://${RAPID_API_HOST}/get-search-results?request_id=${requestId}&page=1`,
            {
                headers: {
                    'x-rapidapi-host': RAPID_API_HOST,
                    'x-rapidapi-key': RAPID_API_KEY
                }
            }
        );

        return { status: 'completed', data: resultsResponse.data };

    } catch (error) {
        console.error('Error in getSearchResults:', {
            message: error.message,
            apiResponse: error.response?.data || 'No API response available'
        });
        throw error;
    }
}

// Route 1: Find employees by Sales Navigator URL
router.post('/find-employees', async (req, res) => {
    try {
        const { salesNavUrl } = req.body;

        if (!salesNavUrl) {
            return res.status(400).json({
                status: -1,
                message: 'Sales Navigator URL is required'
            });
        }

        const result = await fetchSalesNavURL(salesNavUrl);

        if (result.status === 'pending') {
            return res.status(202).json({
                status: 1,
                request_id: result.request_id,
                message: result.message
            });
        }

        res.status(200).json({
            status: 1,
            data: result
        });

    } catch (error) {
        console.error('Error in /find-employees route:', {
            message: error.message,
            apiResponse: error.response?.data || 'No API response available'
        });

        res.status(503).json({
            status: -1,
            message: 'Error processing request',
            error: error.message,
            apiResponse: error.response?.data || null
        });
    }
});

// Route 2: Check status and get results by request_id
router.get('/search-results/:requestId', async (req, res) => {
    try {
        const { requestId } = req.params;

        if (!requestId) {
            return res.status(400).json({
                status: -1,
                message: 'Request ID is required'
            });
        }

        const result = await getSearchResults(requestId);

        if (result.status !== 'completed') {
            return res.status(202).json({
                status: 1,
                message: result.message,
                search_status: result.status
            });
        }

        res.status(200).json({
            status: 1,
            data: result.data
        });

    } catch (error) {
        console.error('Error in /search-results route:', {
            message: error.message,
            apiResponse: error.response?.data || 'No API response available'
        });

        res.status(503).json({
            status: -1,
            message: 'Error retrieving search results',
            error: error.message,
            apiResponse: error.response?.data || null
        });
    }
});

module.exports = { router, fetchSalesNavURL, getSearchResults };
