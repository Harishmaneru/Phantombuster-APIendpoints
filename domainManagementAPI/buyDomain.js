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
 * Make request to Dynadot API
 * @param {Object} params - URL parameters to append to the API endpoint
 * @returns {Promise<Object>} - Parsed XML response
 */
async function makeDynadotRequest(params) {
    try {
        // Add API key to all requests
        const queryParams = new URLSearchParams({
            key: API_KEY,
            ...params
        });

        const url = `${DYNADOT_API_URL}?${queryParams.toString()}`;
        console.log(`Making request to: ${url.replace(API_KEY, 'API_KEY_HIDDEN')}`);

        const { data: xml } = await axios.get(url);
        console.log('Raw XML response:', xml);

        const result = await parseXml(xml);
        return result;
    } catch (err) {
        console.error('Dynadot API request failed:', err.message);
        throw err;
    }
}

/**
 * Get list of available TLDs with pricing
 * @returns {Promise<Map<string, {register: number, renew: number, currency: string}>>}
 */
async function getAllTldPricing() {
    try {
        const result = await makeDynadotRequest({
            command: 'get_tld_list',
            show_price: 'yes'
        });

        if (!result?.Results?.GetTldListResponse?.Tld) {
            console.error('TLD list not available in response:', result);
            return new Map();
        }

        const pricingMap = new Map();
        const tlds = Array.isArray(result.Results.GetTldListResponse.Tld)
            ? result.Results.GetTldListResponse.Tld
            : [result.Results.GetTldListResponse.Tld];

        for (const tld of tlds) {
            if (tld.TldName && tld.RegisterPrice) {
                pricingMap.set(tld.TldName.toLowerCase(), {
                    register: parseFloat(tld.RegisterPrice) || 0,
                    renew: parseFloat(tld.RenewPrice) || 0,
                    currency: tld.Currency || 'USD'
                });
            }
        }

        return pricingMap;
    } catch (err) {
        console.error('Error fetching TLD prices:', err.message);
        return new Map();
    }
}

/**
 * Get domain pricing from TLD pricing map
 * @param {string} domain - Domain name
 * @param {Map} tldPricingMap - Map of TLD prices
 * @returns {Object|null} - Pricing information
 */
function getDomainPricing(domain, tldPricingMap) {
    const tldMatch = domain.match(/\.([^.]+)$/);
    if (!tldMatch) return null;

    const tld = tldMatch[1].toLowerCase();
    return tldPricingMap.get(tld) || null;
}

/**
 * Parse price string from Dynadot API
 * @param {string} priceString - Price string from API
 * @returns {Object} - Parsed price object with register and renew values
 */
function parsePriceString(priceString) {
    if (!priceString) return null;

    try {
        // Extract registration price
        const regMatch = priceString.match(/Registration Price: ([0-9.]+) in ([A-Z]+)/i);
        // Extract renewal price
        const renewMatch = priceString.match(/Renewal price: ([0-9.]+) in ([A-Z]+)/i);

        const result = {};

        if (regMatch && regMatch.length >= 3) {
            result.register = parseFloat(regMatch[1]) || 0;
            result.currency = regMatch[2] || 'USD';
        }

        if (renewMatch && renewMatch.length >= 3) {
            result.renew = parseFloat(renewMatch[1]) || 0;
        }

        return Object.keys(result).length > 0 ? result : null;
    } catch (err) {
        console.error('Error parsing price string:', err.message);
        return null;
    }
}

/**
 * Generate domain suggestions based on the searched domain
 * @param {string} domain - Original domain name
 * @returns {Promise<Array>} - List of suggested domains
 */
async function generateDomainSuggestions(domain) {
    try {
        // Extract the domain name without TLD
        const baseName = domain.split('.')[0];

        // Common TLDs to check
        const commonTlds = ['com', 'net', 'org', 'io', 'co', 'app', 'ai', 'dev'];
        const suggestions = [];

        // Create an array of promises for all domain checks
        const checkPromises = commonTlds.map(async tld => {
            const suggestedDomain = `${baseName}.${tld}`;
            if (suggestedDomain !== domain) { // Skip the original domain
                try {
                    const checkResult = await makeDynadotRequest({
                        command: 'search',
                        domain0: suggestedDomain,
                        show_price: '1',
                        currency: 'USD'
                    });

                    if (checkResult?.Results?.SearchResponse?.SearchHeader) {
                        const header = checkResult.Results.SearchResponse.SearchHeader;
                        const available = header.Available === 'yes';

                        const suggestion = {
                            domain: suggestedDomain,
                            available: available,
                            status: header?.Status || 'unknown'
                        };

                        // Add pricing directly from the search response using the new parser
                        if (available && header.Price) {
                            const parsedPrice = parsePriceString(header.Price);
                            if (parsedPrice) {
                                suggestion.price = parsedPrice;
                            }
                        }

                        return suggestion;
                    }
                } catch (err) {
                    console.error(`Error checking suggestion ${suggestedDomain}:`, err.message);
                }
            }
            return null;
        });

        // Wait for all checks to complete and filter out null results
        const results = await Promise.all(checkPromises);
        return results.filter(result => result !== null);
    } catch (err) {
        console.error('Error generating suggestions:', err.message);
        return [];
    }
}

/**
 * Check domain availability with pricing and suggestions
 * @param {string} domain - Domain name (e.g., 'example.com')
 * @returns {Promise<{domain: string, available: boolean, price?: object, suggestedDomains?: Array, status: string}>}
 */
async function checkDomainAvailability(domain) {
    if (!domain || !/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain)) {
        throw new Error('Invalid domain format.');
    }

    // First check domain availability with price information
    const result = await makeDynadotRequest({
        command: 'search',
        domain0: domain,
        show_price: '1',
        currency: 'USD'
    });

    if (!result?.Results?.SearchResponse?.SearchHeader) {
        throw new Error('Unexpected API response structure.');
    }

    const header = result.Results.SearchResponse.SearchHeader;
    const response = {
        domain: header?.DomainName || domain,
        available: header?.Available === 'yes',
        status: header?.Status || 'unknown'
    };

    // Extract price directly from the search response using the new parser
    if (response.available && header?.Price) {
        const parsedPrice = parsePriceString(header.Price);
        if (parsedPrice) {
            response.price = parsedPrice;
        }
    }

    // Fallback to TLD pricing if direct price info not available
    if (!response.price) {
        const tldPricingMap = await getAllTldPricing();
        const pricing = getDomainPricing(domain, tldPricingMap);
        if (pricing) {
            response.price = pricing;
        }
    }

    // Generate suggestions if domain is not available
    if (!response.available) {
        const suggestions = await generateDomainSuggestions(domain);
        if (suggestions.length > 0) {
            response.suggestedDomains = suggestions;
        }
    }

    return response;
}

/**
 * Register a domain
 * @param {string} domain - Domain to register
 * @param {number} duration - Years (1-10)
 * @returns {Promise<{domain: string, success: boolean, cost?: number, status: string, errorCode?: string, message?: string}>}
 */
async function registerDomain(domain, duration = 1) {
    if (!domain || !/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain)) {
        throw new Error('Invalid domain format.');
    }
    if (duration < 1 || duration > 10) {
        throw new Error('Duration must be 1-10 years.');
    }

    const result = await makeDynadotRequest({
        command: 'register',
        domain: domain,
        duration: duration
    });

    // Handle both possible response structures (nested under Results or top-level)
    const registerResponse = result?.Results?.RegisterResponse || result?.RegisterResponse;

    if (!registerResponse) {
        console.error('No RegisterResponse found:', JSON.stringify(result, null, 2));
        throw new Error('Unexpected API response structure.');
    }

    // Some versions wrap details inside RegisterHeader, others put them directly.
    const header = registerResponse.RegisterHeader ?? registerResponse;

    // When status is not "success", return a structured failure response instead of throwing.
    if (!header || header.Status !== 'success') {
        return {
            domain,
            success: false,
            status: header?.Status || 'error',
            errorCode: header?.SuccessCode || header?.ErrorCode || header?.Code || null,
            message: header?.Error || header?.Status || 'Domain registration failed'
        };
    }

    // Success – return the usual payload
    return {
        domain,
        success: true,
        cost: header?.Price ? parseFloat(header.Price) : undefined,
        status: 'success'
    };
}

/**
 * Get detailed information about a domain
 * @param {string} domain - Domain name to get info for
 * @returns {Promise<Object>} - Domain information
 */
async function getDomainInfo(domain) {
    if (!domain || !/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain)) {
        throw new Error('Invalid domain format.');
    }

    try {
        // Add API key to all requests
        const queryParams = new URLSearchParams({
            key: API_KEY,
            command: 'domain_info',
            domain: domain
        });

        const url = `https://api.dynadot.com/api3.json?${queryParams.toString()}`;
        console.log(`Making request to: ${url.replace(API_KEY, 'API_KEY_HIDDEN')}`);

        const { data } = await axios.get(url);
        console.log('Raw JSON response:', JSON.stringify(data));

        // Return the response as is, even if it contains an error
        if (data?.DomainInfoResponse) {
            return data.DomainInfoResponse;
        } else {
            throw new Error('Unexpected API response structure.');
        }
    } catch (err) {
        console.error('Dynadot API request failed:', err.message);
        throw err;
    }
}

// Routes
router.post('/dynadotdomain/check', async (req, res) => {
    try {
        const { domain } = req.body;
        if (!domain) throw new Error('Domain is required.');

        console.log(`Checking domain availability for: ${domain}`);
        const result = await checkDomainAvailability(domain);

        // Send a clean response
        res.json({
            status: '1',
            message: 'Success',
            data: {
                domain: result.domain,
                available: result.available,
                status: result.status,
                price: result.price || null,
                suggestedDomains: result.suggestedDomains || []
            }
        });
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

        // If Dynadot returned an error status, forward it to the client with a 400.
        if (!result.success) {
            return res.status(400).json({
                status: '-1',
                message: `Registration failed: ${result.status}`,
                data: {
                    domain: result.domain,
                    status: result.status,
                    errorCode: result.errorCode,
                    message: result.message
                }
            });
        }
        // Success
        res.json({
            status: '1',
            message: 'Domain registered successfully',
            data: {
                domain: result.domain,
                success: result.success,
                cost: result.cost,
                status: result.status || 'success'
            }
        });
    } catch (err) {
        console.error('Dynadot register error:', err.message);
        res.status(400).json({ status: '-1', message: err.message });
    }
});
router.post('/dynadot/domainInfo', async (req, res) => {
    try {
        const { domain } = req.body;
        if (!domain) throw new Error('Domain is required.');

        console.log(`Getting domain info for: ${domain}`);
        const result = await getDomainInfo(domain);

        // Check if there was an error in the response
        if (result.Status === 'error') {
            return res.status(400).json({
                status: result.ResponseCode || '-1',
                message: result.Error || 'Domain info retrieval failed',
                data: result
            });
        }

        res.json({
            status: '1',
            message: 'Success',
            data: result
        });
    } catch (err) {
        console.error('Dynadot domain info error:', err.message);
        res.status(400).json({ status: '-1', message: err.message });
    }
});

module.exports = router;