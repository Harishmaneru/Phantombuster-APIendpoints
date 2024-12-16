const express = require('express');
const router = express.Router();

router.post('/trigify-webhook', (req, res) => {
    const payload = req.body;

    if (!payload || typeof payload !== 'object') {
        return res.status(400).json({ error: 'Invalid JSON payload' });
    }

    console.log('Received Webhook Payload:', payload);

    res.status(200).json({ message: 'Webhook received successfully!' });
});

module.exports = router;
