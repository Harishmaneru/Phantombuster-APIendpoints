const express = require('express');
const axios = require('axios');
const router = express.Router();

// Configure Explorium API client
const exploriumAxios = axios.create({
    baseURL: 'https://api.explorium.ai/v1',
    headers: {
        'Content-Type': 'application/json',
        'api_key': process.env.EXPLORIUM_API_KEY
    }
});

// Helper function to validate and convert year to ISO timestamp
const validateAndConvertYear = (yearInput) => {
    const currentYear = new Date().getFullYear();

    // Default to 2023 if no year provided
    if (typeof yearInput === 'undefined') {
        return new Date('2023-01-01').toISOString();
    }

    // Validate input type
    const year = parseInt(yearInput, 10);
    if (isNaN(year)) {
        throw new Error('Invalid year format - must be a number');
    }

    // Validate year range
    if (year < 1900) {
        throw new Error('Year must be 1900 or later');
    }

    if (year > currentYear) {
        throw new Error('Year cannot be in the future');
    }
 
    return new Date(`${year}-01-01`).toISOString();
};

// Reusable method for matching businesses using only the URL
const matchBusinesses = async (domain) => {
    try {
        let formattedUrl = domain;
        // Prepend "https://" if no protocol is present
        if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
            formattedUrl = `https://${domain}`;
        }
        console.log('Matching business with URL:', formattedUrl);

        // Call the API with only the "url" field as in the example
        const response = await exploriumAxios.post('/businesses/match', {
            businesses_to_match: [{ url: formattedUrl }]
        });
        console.log('Matched businesses:', response.data.matched_businesses);
        const businesses = response.data.matched_businesses;
        // Return an array of business IDs
        return businesses.map(b => b.business_id);
    } catch (error) {
        console.error('Error matching businesses:', error.response?.data || error.message);
        throw new Error('Failed to match businesses');
    }
};

// Reusable method for fetching business events (e.g., IPO announcements)
const fetchBusinessEvents = async (businessIds, timestampFrom) => {
    try {
        console.log('Fetching business events for IDs:', businessIds, 'from:', timestampFrom);
        const response = await exploriumAxios.post('/businesses/events', {
            event_types: ["ipo_announcement"],
            business_ids: businessIds,
            timestamp_from: timestampFrom
        });
        console.log('Fetched business events:', response.data);
        return response.data || [];
    } catch (error) {
        console.error('Error fetching business events:', error.response?.data || error.message);
        throw new Error('Failed to fetch business events');
    }
};

router.post('/fetchFundingannounmenet', async (req, res) => {
    try {
        const { domain, year } = req.body;

        // Validate required parameter
        if (!domain) {
            return res.status(400).json({
                status: '-1',
                message: 'Domain is required'
            });
        }

        // Convert the provided year to an ISO timestamp
        let timestampFrom;
        try {
            timestampFrom = validateAndConvertYear(year);
        } catch (yearError) {
            return res.status(400).json({
                status: '-1',
                message: yearError.message
            });
        }

        // Match businesses using the provided domain (via URL)
        const businessIds = await matchBusinesses(domain);
        if (!businessIds.length) {
            return res.status(404).json({
                status: '-1',
                message: 'No businesses found for the given domain'
            });
        }

        const events = await fetchBusinessEvents(businessIds, timestampFrom);

        res.json({
            status: '1',
            events: events,
            count: events.length,
            timestamp_from: timestampFrom
        });
    } catch (error) {
        const statusCode = error.response?.status || 500;
        res.status(statusCode).json({
            status: '-1',
            message: error.message || 'An error occurred during processing'
        });
    }
});

module.exports = router;
