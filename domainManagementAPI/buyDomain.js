require('dotenv').config();
const express = require('express');
const axios = require('axios');
const xml2js = require('xml2js');
const rateLimit = require('express-rate-limit');

const router = express.Router();
const DYNADOT_API_URL = 'https://api.dynadot.com/api3.xml';
const API_KEY = process.env.DYNADOT_API_KEY;

// Rate limiter (Dynadot allows ~60 requests/minute)
const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 50, // Safe margin
    message: 'Too many requests. Wait a minute and retry.'
});
router.use(apiLimiter);

// Helper: Parse XML safely
async function parseXml(xml) {
    try {
        const parser = new xml2js.Parser({ explicitArray: false, trim: true });
        return await parser.parseStringPromise(xml);
    } catch (err) {
        throw new Error(`Failed to parse XML: ${err.message}`);
    }
}

/**
 * Check domain availability.
 * @param {string} domain - Domain name (e.g., 'example.com')
 * @returns {Promise<{domain: string, available: boolean, raw?: any}>}
 */
async function checkDomainAvailability(domain) {
    if (!domain || !/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain)) {
        throw new Error('Invalid domain format.');
    }

    const url = `${DYNADOT_API_URL}?key=${API_KEY}&command=search&domain0=${encodeURIComponent(domain)}`;
    const { data: xml } = await axios.get(url);
    const result = await parseXml(xml);

    if (!result?.Results?.SearchResponse) {
        throw new Error('Unexpected API response structure.');
    }

    const header = result.Results.SearchResponse.SearchHeader;
    return {
        domain: header?.DomainName || domain,
        available: header?.Available === 'yes',
        raw: result
    };
}

/**
 * Register a domain.
 * @param {string} domain - Domain to register
 * @param {number} duration - Years (1-10)
 * @returns {Promise<{domain: string, success: boolean, cost?: number, raw?: any}>}
 */
async function registerDomain(domain, duration = 1) {
    if (!domain || !/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain)) {
        throw new Error('Invalid domain format.');
    }
    if (duration < 1 || duration > 10) {
        throw new Error('Duration must be 1-10 years.');
    }

    const url = `${DYNADOT_API_URL}?key=${API_KEY}&command=register` +
        `&domain=${encodeURIComponent(domain)}` +
        `&duration=${duration}`;
    const { data: xml } = await axios.get(url);
    const result = await parseXml(xml);

    // Check if we got a valid response structure
    if (!result?.Results?.RegisterResponse) {
        const errorResponse = JSON.stringify(result, null, 2);
        console.error('Unexpected API response structure:', errorResponse);
        throw new Error(errorResponse);
    }

    const header = result.Results.RegisterResponse.RegisterHeader;
    
    // Handle all non-success statuses
    if (!header || header.Status !== 'success') {
        const statusMessage = header?.Status || 'unknown_error';
        const errorMsg = header?.Error || `Domain registration failed: ${statusMessage}`;
        throw new Error(errorMsg);
    }

    return {
        domain,
        success: true,
        cost: header?.Price ? parseFloat(header.Price) : undefined,
        raw: result
    };
}

// Routes
router.post('/dynadotdomain/check', async (req, res) => {
    try {
        const { domain } = req.body;
        if (!domain) throw new Error('Domain is required.');
        const result = await checkDomainAvailability(domain);
        res.json({ status: '1', message: 'Success', data: result });
    } catch (err) {
        console.error('Dynadot check error:', err.message);
        res.status(400).json({ status: '-1', message: err.message });
    }
});

router.post('/dynadotdomain/register', async (req, res) => {
    try {
        const { domain, duration = 1 } = req.body;
        if (!domain) throw new Error('Domain is required.');
        const result = await registerDomain(domain, duration);
        res.json({
            status: '1',
            message: 'Domain registered successfully',
            data: result
        });
    } catch (err) {
        console.error('Dynadot register error:', err.message);
        // If the error message is a JSON string, parse it and send as data
        try {
            const errorData = JSON.parse(err.message);
            res.status(400).json({ 
                status: '-1', 
                message: 'Registration failed',
                data: errorData
            });
        } catch (e) {
            // If not JSON, send as regular error message
            res.status(400).json({ 
                status: '-1', 
                message: err.message 
            });
        }
    }
});

module.exports = router;