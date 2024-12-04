const express = require('express');
const axios = require('axios');
const router = express.Router();

router.use(express.json());
const apiKey = 'private_abdd5ed846e818d9801cd92810283e4b';
// Single Email Validation
router.post('/validate-single-email', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is a required field' });
        }

      
        
        const apiUrl = 'https://api.neverbounce.com/v4/single/check';

       
        const response = await axios.post(apiUrl, {
            key: apiKey,
            email
        });
        console.log('single_email_response',response.data)
        
        res.status(200).json(response.data);
    } catch (error) {
        console.error('Error validating email:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Failed to validate email',
            details: error.response?.data || error.message
        });
    }
});

// Bulk Email Validation
router.post('/validate-bulk-email', async (req, res) => {
    try {
        const { emails } = req.body;

       
        if (!emails || !Array.isArray(emails) || emails.length === 0) {
            return res.status(400).json({
                error: 'Emails must be provided as an array with each item being an array of email and name.',
            });
        }

        const apiUrl = 'https://api.neverbounce.com/v4/jobs/create';

       
        const createResponse = await axios.post(apiUrl, {
            key: apiKey,
            input_location: 'supplied',
            filename: 'SampleNeverBounceAPI.csv',  
            auto_start: true,
            auto_parse: true,
            input: emails,
        });

        console.log('Job created successfully:', createResponse.data);
        const jobId = createResponse.data.job_id;

        const statusUrl = 'https://api.neverbounce.com/v4/jobs/status';
        let jobStatus;
        do {
            const statusResponse = await axios.get(statusUrl, {
                params: {
                    key: apiKey,
                    job_id: jobId,
                },
            });

            jobStatus = statusResponse.data.job_status;
            console.log(`Job status: ${jobStatus}`);

            if (jobStatus === 'complete') {
                break;
            } else if (jobStatus === 'failed') {
                throw new Error('Job failed during processing');
            }

           
            await new Promise(resolve => setTimeout(resolve, 5000));
        } while (jobStatus !== 'complete');

        // Download job results
        const downloadUrl = 'https://api.neverbounce.com/v4/jobs/download';
        const resultsResponse = await axios.get(downloadUrl, {
            params: {
                key: apiKey,
                job_id: jobId,
            },
        });

        console.log('Raw bulk email results:', resultsResponse.data);

        // Parse the raw results
        const rawResults = resultsResponse.data.split('\r\n').filter(row => row.trim() !== '');
        const parsedResults = rawResults.map(row => {
            const [email, name, result] = row.replace(/"/g, '').split(',');
            return { email, name, result };
        });

        console.log('Formatted bulk email results:', parsedResults);

        // Send formatted results back to the client
        res.status(200).json({
            message: 'Email validation completed successfully',
            results: parsedResults,
        });
    } catch (error) {
        console.error('Error validating bulk emails:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Failed to validate bulk emails',
            details: error.response?.data || error.message,
        });
    }
});

module.exports = router;