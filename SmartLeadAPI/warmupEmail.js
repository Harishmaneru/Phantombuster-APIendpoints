const express = require('express');
const axios = require('axios');
const router = express.Router();

router.use(express.json());

// Endpoint to trigger the warm-up process
router.post('/enable-warmup', async (req, res) => {
    // Extract API key from query parameters
    const apiKey = req.query.apiKey;

    // Validate API key
    if (!apiKey) {
        return res.status(400).json({ error: 'API key is required' });
    }

    try {
        // Step 1: Retrieve email account ID
        const emailAccountsUrl = `https://server.smartlead.ai/api/v1/email-accounts?api_key=${apiKey}`;
        const emailResponse = await axios.get(emailAccountsUrl, {
            headers: { 'Content-Type': 'application/json' },
        });

        if (!emailResponse.data || emailResponse.data.length === 0) {
            return res.status(404).json({ error: 'No email accounts found.' });
        }

        const emailAccountId = emailResponse.data[0].id;
        console.log('Email Account ID:', emailAccountId);
        // Step 2: Define default warm-up settings
        const defaultPayload = {
            warmup_enabled: true,
            total_warmup_per_day: 35,
            daily_rampup: 2,
            reply_rate_percentage: 38,
            warmup_key_id: 'Test-warmup',
        };

        // Step 3: Merge request payload with default settings
        const userPayload = req.body || {};
        const warmupPayload = { ...defaultPayload, ...userPayload };

        // Step 4: Trigger the warm-up API
        const warmupUrl = `https://server.smartlead.ai/api/v1/email-accounts/${emailAccountId}/warmup?api_key=${apiKey}`;
        const warmupResponse = await axios.post(warmupUrl, warmupPayload, {
            headers: { 'Content-Type': 'application/json' },
        });
        console.log('Warm-up enabled successfully:', warmupResponse.data);
        res.status(200).json({
            message: 'Warm-up enabled successfully.',
            warmupDetails: warmupResponse.data,
        });
    } catch (error) {
        console.error('Error enabling warm-up:', error);
        res.status(500).json({
            error: error.response ? error.response.data : error.message,
        });
    }
});


//  endpoint to fetch warm-up stats
router.post('/warmup-stats/:emailAccountId', async (req, res) => {
    // Extract API key and email account ID from query parameters and route params
    const apiKey = req.query.apiKey;
    const emailAccountId = req.params.emailAccountId;

    // Validate inputs
    if (!apiKey) {
        return res.status(400).json({ error: 'API key is required' });
    }

    if (!emailAccountId) {
        return res.status(400).json({ error: 'Email Account ID is required' });
    }

    try {
        // Construct the URL for warm-up stats
        const warmupStatsUrl = `https://server.smartlead.ai/api/v1/email-accounts/${emailAccountId}/warmup-stats?api_key=${apiKey}`;
        
        // Make the API request to fetch warm-up stats
        const warmupStatsResponse = await axios.get(warmupStatsUrl, {
            headers: { 'Content-Type': 'application/json' },
        });
        console.log('Warm-up Statisstics:', warmupStatsResponse.data);
        // Return the warm-up stats
        res.status(200).json({
            message: 'Warm-up stats retrieved successfully.',
            warmupStats: warmupStatsResponse.data,
        });
    } catch (error) {
        console.error('Error fetching warm-up stats:', error);
        res.status(500).json({
            error: error.response ? error.response.data : error.message,
        });
    }
});

module.exports = router;


// // Endpoint to create a campaign
// router.post('/createcampaign', async (req, res) => {
//     const { name } = req.body;

//     if (!name) {
//         return res.status(400).json({ error: 'Campaign name is required' });
//     }

//     const createCampaignUrl = `https://server.smartlead.ai/api/v1/campaigns/create?api_key=${apiKey}`;
    
//     try {
//         const response = await axios.post(
//             createCampaignUrl,
//             new URLSearchParams({ name }),
//             { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
//         );

//         res.status(200).json({
//             message: 'Campaign created successfully',
//             campaignDetails: response.data,
//         });
//     } catch (error) {
//         console.error('Error creating campaign:', error);
//         res.status(500).json({
//             error: error.response ? error.response.data : error.message,
//         });
//     }
// });

// // Endpoint to schedule a campaign
// router.post('/campaign/:campaignId/schedule', async (req, res) => {
//     const { campaignId } = req.params;
//     const {
//         timezone,
//         days_of_the_week,
//         start_hour,
//         end_hour,
//         min_time_btw_emails,
//         max_new_leads_per_day,
//         schedule_start_time,
//     } = req.body;

//     if (!timezone || !days_of_the_week || !start_hour || !end_hour || !min_time_btw_emails || !max_new_leads_per_day || !schedule_start_time) {
//         return res.status(400).json({ error: 'All scheduling parameters are required' });
//     }

//     const scheduleCampaignUrl = `https://server.smartlead.ai/api/v1/campaigns/${campaignId}/schedule?api_key=${apiKey}`;
//     const schedulePayload = {
//         timezone,
//         days_of_the_week,
//         start_hour,
//         end_hour,
//         min_time_btw_emails,
//         max_new_leads_per_day,
//         schedule_start_time,
//     };

//     try {
//         const response = await axios.post(
//             scheduleCampaignUrl,
//             schedulePayload,
//             { headers: { 'Content-Type': 'application/json' } }
//         );

//         res.status(200).json({
//             message: 'Campaign scheduled successfully',
//             scheduleDetails: response.data,
//         });
//     } catch (error) {
//         console.error('Error scheduling campaign:', error);
//         res.status(500).json({
//             error: error.response ? error.response.data : error.message,
//         });
//     }
// });


// // Endpoint to retrieve campaigns
// router.get('/getcampaigns', async (req, res) => {
//     const apiKey = req.query.apiKey; // Retrieve API key from query parameters

//     if (!apiKey) {
//         return res.status(400).json({ error: 'API key is required' });
//     }

//     const campaignsUrl = `https://server.smartlead.ai/api/v1/campaigns?api_key=${apiKey}`;

//     try {
//         const response = await axios.get(campaignsUrl, {
//             headers: { 'Content-Type': 'application/json' },
//         });

//         res.status(200).json({
//             message: 'Campaigns retrieved successfully',
//             campaigns: response.data,
//         });
//     } catch (error) {
//         console.error('Error retrieving campaigns:', error);
//         res.status(500).json({
//             error: error.response ? error.response.data : error.message,
//         });
//     }
// });