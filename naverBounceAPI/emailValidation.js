const express = require('express');
const axios = require('axios');
const router = express.Router();

router.use(express.json());
const apiKey = 'private_abdd5ed846e818d9801cd92810283e4b';


// Format verification result to match UI display
const formatResult = (verificationResult) => {
    const resultMap = {
        'valid': 'VALID',
        'invalid': 'INVALID',
        'catchall': 'VALID',
        'disposable': 'INVALID',
        'unknown': 'INVALID'
    };
    return resultMap[verificationResult] || verificationResult.toUpperCase();
};

// Format relative time
const getRelativeTime = (timestamp) => {
    const now = new Date();
    const verifiedAt = new Date(timestamp);
    const diffInMinutes = Math.floor((now - verifiedAt) / (1000 * 60));

    if (diffInMinutes < 1) return 'a few seconds ago';
    if (diffInMinutes < 60) return `${diffInMinutes} minute${diffInMinutes === 1 ? '' : 's'} ago`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours} hour${diffInHours === 1 ? '' : 's'} ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays} day${diffInDays === 1 ? '' : 's'} ago`;
};

router.post('/validate-bulk-email', async (req, res) => {
    const startTime = new Date();
    try {
        const { emails } = req.body;
        console.log(`[Email Validation] Starting bulk validation request at ${startTime.toISOString()}`);

        if (!emails || !Array.isArray(emails)) {
            console.warn('[Email Validation] Invalid input: emails must be an array');
            return res.status(400).json({
                error: 'Input must be an array of email addresses'
            });
        }

        console.log(`[Email Validation] Processing ${emails.length} emails for validation`);

        // Create job
        console.log('[Email Validation] Creating NeverBounce job...');
        const createJobResponse = await axios.post('https://api.neverbounce.com/v4/jobs/create', {
            key: apiKey,
            input: emails,
            input_location: 'supplied',
            filename: 'email_validation.csv',
            auto_start: 1,
            auto_parse: 1,
        });

        if (createJobResponse.data.status !== 'success') {
            console.error('[Email Validation] Job creation failed:', createJobResponse.data.message);
            return res.status(400).json({
                status: 'error',
                message: createJobResponse.data.message
            });
        }

        const jobId = createJobResponse.data.job_id;
        const jobStartTime = new Date();
        console.log(`[Email Validation] Job created successfully. Job ID: ${jobId}`);
        
        // Poll job status
        let isComplete = false;
        let pollCount = 0;

        while (!isComplete) {
            pollCount++;
            console.log(`[Email Validation] Polling job status (attempt ${pollCount}). Job ID: ${jobId}`);
            
            const statusResponse = await axios.get('https://api.neverbounce.com/v4/jobs/status', {
                params: {
                    key: apiKey,
                    job_id: jobId
                }
            });
            
            console.log(`[Email Validation] Current job status: ${statusResponse.data.job_status}`);
            
            if (statusResponse.data.job_status === 'complete') {
                isComplete = true;
                console.log('[Email Validation] Job processing completed successfully');
            } else if (statusResponse.data.job_status === 'failed') {
                console.error('[Email Validation] Job processing failed');
                return res.status(400).json({
                    status: 'error',
                    message: 'Job processing failed'
                });
            } else {
                console.log('[Email Validation] Job still processing, waiting 5 seconds...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        // Fetch ALL results with pagination
        console.log('[Email Validation] Starting to fetch paginated results...');
        let allResults = [];
        let currentPage = 1;
        const itemsPerPage = 100; // Maximum allowed per request

        while (true) {
            console.log(`[Email Validation] Fetching page ${currentPage} (${itemsPerPage} items per page)`);
            const resultsResponse = await axios.get('https://api.neverbounce.com/v4/jobs/results', {
                params: {
                    key: apiKey,
                    job_id: jobId,
                    page: currentPage,
                    items_per_page: itemsPerPage
                }
            });

            if (!resultsResponse.data.results || resultsResponse.data.results.length === 0) {
                console.log('[Email Validation] No more results to fetch');
                break;
            }

            const pageResults = resultsResponse.data.results;
            allResults = allResults.concat(pageResults);
            console.log(`[Email Validation] Fetched ${pageResults.length} results from page ${currentPage}. Total results so far: ${allResults.length}`);

            // Stop if we got fewer results than requested (reached the end)
            if (pageResults.length < itemsPerPage) {
                console.log('[Email Validation] Reached last page of results');
                break;
            }

            currentPage++;
        }

        const formattedResults = allResults.map(item => ({
            email: item.data.email,
            result: formatResult(item.verification.result),
            time: getRelativeTime(jobStartTime)
        }));

        const endTime = new Date();
        const processingTime = (endTime - startTime) / 1000;
        
        console.log(`[Email Validation] Validation completed successfully:
        - Total emails processed: ${formattedResults.length}
        - Processing time: ${processingTime} seconds
        - Total pages fetched: ${currentPage}
        - Job ID: ${jobId}
        - Start time: ${startTime.toISOString()}
        - End time: ${endTime.toISOString()}`);

        res.status(200).json({
            status: 'success',
            verification_results: formattedResults
        });

    } catch (error) {
        const errorTime = new Date();
        console.error(`[Email Validation] Error occurred at ${errorTime.toISOString()}:`);
        console.error('- Error message:', error.message);
        console.error('- Stack trace:', error.stack);
        if (error.response) {
            console.error('- API Response data:', JSON.stringify(error.response.data, null, 2));
            console.error('- API Response status:', error.response.status);
            console.error('- API Response headers:', JSON.stringify(error.response.headers, null, 2));
        }

        res.status(500).json({
            status: 'error',
            message: 'API Error',
            details: error.response?.data?.message || error.message
        });
    }
});

module.exports = router;