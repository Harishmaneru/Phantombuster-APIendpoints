


// const express = require('express');
// const axios = require('axios');
// const router = express.Router();
// const AUTH_TOKEN = 'Bearer db534d84-9d06-461b-84be-6a812f6792e7';
// const BASE_URL = 'https://api.brightdata.com/datasets/v3';
// const datasetId = 'gd_l4dx9j9sscpvs7no2';

// // Helper function to sleep between status checks
// const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// // Function to create a snapshot
// async function createSnapshot(inputs) {
//     try {
//         const response = await axios.post(`${BASE_URL}/trigger`, inputs, {
//             headers: {
//                 'Authorization': AUTH_TOKEN,
//                 'Content-Type': 'application/json'
//             },
//             params: {
//                 dataset_id: datasetId,
//                 type: 'discover_new',
//                 discover_by: 'keyword',
//                 limit_per_input: 1
//             }
//         });
//         return response.data.snapshot_id;
//     } catch (error) {
//         console.error('Error creating snapshot:', error);
//         throw error;
//     }
// }

// // Function to check snapshot status
// async function checkSnapshotStatus(snapshotId) {
//     let isReady = false;
//     const url = `${BASE_URL}/progress/${snapshotId}`;
    
//     while (!isReady) {
//         try {
//             const response = await axios.get(url, {
//                 headers: {
//                     'Authorization': AUTH_TOKEN
//                 }
//             });
//             const { status } = response.data;
//             console.log('Snapshot progress response:', response.data);
//             if (status === 'ready') {
//                 isReady = true;
//             } else {
//                 await sleep(5000); // Wait for 5 seconds before retrying
//             }
//         } catch (error) {
//             console.error('Error checking snapshot status:', error);
//             throw error;
//         }
//     }
// }

// // Function to retrieve the final data once snapshot is ready
// async function getSnapshotData(snapshotId) {
//     try {
//         const response = await axios.get(`${BASE_URL}/snapshot/${snapshotId}?format=json`, {
//             headers: {
//                 'Authorization': AUTH_TOKEN
//             }
//         });
//         return response.data;
//     } catch (error) {
//         console.error('Error fetching snapshot data:', error);
//         throw error;
//     }
// }

// // API Endpoint to trigger scraping and return final data
// router.post('/scrape', async (req, res) => {
//     const inputs = req.body;
    
//     try {
//         // Step 1: Create a Snapshot
//         const snapshotId = await createSnapshot(inputs);
//         console.log('Snapshot ID:', snapshotId);

//         // Step 2: Check the snapshot status until ready
//         await checkSnapshotStatus(snapshotId);
//         console.log('Snapshot is ready.');

//         // Step 3: Retrieve the final scraped data
//         const finalData = await getSnapshotData(snapshotId);
//         res.json(finalData);
//     } catch (error) {
//         res.status(500).json({ error: 'An error occurred during the scraping process.' });
//     }
// });
// module.exports = router;


const express = require('express');
const axios = require('axios');
const router = express.Router();

const ADZUNA_APP_ID = 'eb7bd0b4';   
const ADZUNA_APP_KEY = 'ece2b22a1999da408461f76e7e8560b4';  

// Function to fetch job listings from Adzuna based on jobType and location, with country hardcoded to 'us'
async function fetchAdzunaJobListings(jobType, location) {
    const baseUrl = 'https://api.adzuna.com/v1/api/jobs';
    const country = 'us';   
    const url = `${baseUrl}/${country}/search/1`;

    const params = {
        app_id: ADZUNA_APP_ID,
        app_key: ADZUNA_APP_KEY,
        what: jobType,
        where: location,
        results_per_page: 10   
    };

    try {
        const response = await axios.get(url, { params });
        return response.data.results;
    } catch (error) {
        console.error('Error fetching job listings from Adzuna:', error.message);
        throw new Error('Failed to fetch job listings from Adzuna.');
    }
}

// Define the API endpoint for fetching job listings
router.post('/apigetadzunajobs', async (req, res) => {
    const { jobType, location } = req.body;

    // Validate jobType and location
    if (!jobType || !location) {
        return res.status(400).json({
            success: false,
            message: 'Job type and location are required',
        });
    }

    try {
        const jobListings = await fetchAdzunaJobListings(jobType, location);

        // If no job listings found
        if (jobListings.length === 0) {
            return res.status(404).json({
                success: false,
                message: `No job listings found for the given criteria.`,
            });
        }

        // Return the original Adzuna response directly without formatting
        res.json({
            success: true,
            count: jobListings.length,
            jobs: jobListings,   
        });
    } catch (error) {
        console.error('Error occurred:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch job listings from Adzuna.',
            error: error.message,
        });
    }
});

module.exports = router;

