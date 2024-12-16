const express = require('express');
const router = express.Router();

// router.post('/trigify-webhook', (req, res) => {
//     const payload = req.body;

//     if (!payload || typeof payload !== 'object') {
//         return res.status(400).json({ error: 'Invalid JSON payload' });
//     }

//     console.log('Received Webhook Payload:', payload);

//     res.status(200).json({ message: 'Webhook received successfully!' });
// });




router.post('/trigify-webhook', (req, res) => {
    const payload = req.body;

    // Log the full payload
    console.log('Full Payload:', JSON.stringify(payload, null, 2));

    // Access the first result for verification
    const result = payload.results[0];

    // Log specific fields for clarity
    if (result) {
        console.log('Prospect:', JSON.stringify(result.prospect, null, 2));
        console.log('LinkedIn Engagement:', JSON.stringify(result.linkedin_engagement, null, 2));
    } else {
        console.log('No results found in payload.');
    }

    res.status(200).send('Webhook received and processed!');
});


module.exports = router;