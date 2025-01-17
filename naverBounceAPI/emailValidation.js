const express = require('express');
const axios = require('axios');
const router = express.Router();

router.use(express.json());
const apiKey = 'private_abdd5ed846e818d9801cd92810283e4b';

const resultExplanation = {
    'valid': {
        description: 'A valid email address has been verified as a real email that is currently accepting mail.',
        recommendation: 'SAFE – These emails exist and have been verified for safe sending.'
    },
    'invalid': {
        description: 'An invalid email address has been verified as a bad recipient address that does not exist or is not accepting mail.',
        recommendation: 'DON’T SEND – These emails do not exist and are not safe for sending.'
    },
    'disposable': {
        description: 'Disposable emails are temporary accounts used to avoid using a real personal account during a sign-up process.',
        recommendation: 'DON’T SEND – These emails are fake or temporary emails and are not safe for sending.'
    },
    'catchall': {
        description: 'Also known as an “accept all”. This is a domain-wide setting where all emails on this domain will be reported as "accept all".',
        recommendation: 'SAFE – If you have a dedicated email server with your own IPs, accept all emails may be safe for sending dependent on the overall health of your list. DON’T SEND – If you use a third party email provider that requires a bounce rate below 4%, these emails are not safe for sending.'
    },
    'unknown': {
        description: 'We are unable to definitively determine this email’s status due to the domain and/or server not responding to our requests.',
        recommendation: 'SAFE – If you have a dedicated email server with your own IPs, unknown emails are normally safe for sending. DON’T SEND – If you use a third party email provider that requires a bounce rate below 4%, these emails are not safe for sending.'
    }
};


// Format verification result to match UI display
const formatResult = (verificationResult) => {
    const resultMap = {
        'valid': 'VALID',
        'invalid': 'INVALID',
        'catchall': 'ACCEPT ALL',
        'disposable': 'DISPOSABLE',
        'unknown': 'UNKNOWN'
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
    try {
        const { emails } = req.body;

        if (!emails || !Array.isArray(emails)) {
            return res.status(400).json({
                error: 'Input must be an array of email addresses'
            });
        }

        // Create job
        const createJobResponse = await axios.post('https://api.neverbounce.com/v4/jobs/create', {
            key: apiKey,
            input: emails,
            input_location: 'supplied',
            filename: 'email_validation.csv',
            auto_start: 1,
            auto_parse: 1,
        });

        if (createJobResponse.data.status !== 'success') {
            return res.status(400).json({
                status: 'error',
                message: createJobResponse.data.message
            });
        }

        const jobId = createJobResponse.data.job_id;
        const jobStartTime = new Date();

        // Poll job status
        let isComplete = false;

        while (!isComplete) {
            const statusResponse = await axios.get('https://api.neverbounce.com/v4/jobs/status', {
                params: {
                    key: apiKey,
                    job_id: jobId
                }
            });
            
            if (statusResponse.data.job_status === 'complete') {
                isComplete = true;
            } else if (statusResponse.data.job_status === 'failed') {
                return res.status(400).json({
                    status: 'error',
                    message: 'Job processing failed'
                });
            } else {
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        // Get results
        const resultsResponse = await axios.get('https://api.neverbounce.com/v4/jobs/results', {
            params: {
                key: apiKey,
                job_id: jobId
            }
        });

        // Format results to match UI
        const formattedResults = resultsResponse.data.results.map(item => ({
            email: item.data.email,
            result: formatResult(item.verification.result),
            explanation: resultExplanation[item.verification.result],
            time: getRelativeTime(jobStartTime)
        }));

        res.status(200).json({
            status: 'success',
            verification_results: formattedResults
            
        });

    } catch (error) {
        console.error('API Error:', error.response?.data || error.message);
        res.status(500).json({
            status: 'error',
            message: 'API Error',
            details: error.response?.data?.message || error.message
        });
    }
});

module.exports = router;