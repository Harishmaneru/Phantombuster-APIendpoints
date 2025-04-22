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

// Reusable method for matching businesses using name, domain, and URL
const matchBusinesses = async (businessData) => {
    try {
        let matchData = {
            name: businessData.name || '',
            domain: businessData.domain || '',
            url: businessData.url || ''
        };

        // If URL is provided but no protocol, prepend https://
        if (matchData.url && !matchData.url.startsWith('http://') && !matchData.url.startsWith('https://')) {
            matchData.url = `https://${matchData.url}`;
        }

        // If domain is provided but no URL, create URL from domain
        if (!matchData.url && matchData.domain) {
            matchData.url = `https://${matchData.domain}`;
        }

        console.log('Matching business with data:', matchData);

        const response = await exploriumAxios.post('/businesses/match', {
            businesses_to_match: [matchData]
        });

        console.log('Matched businesses:', response.data.matched_businesses);
        const businesses = response.data.matched_businesses;
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
            event_types: ["ipo_announcement", "new_investment", "new_product", "new_funding_round",],
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

// Reusable method for fetching funding and acquisition data
const fetchFundingAndAcquisition = async (businessId) => {
    try {
        console.log('Fetching funding and acquisition data for business ID:', businessId);
        const response = await exploriumAxios.post('/businesses/funding_and_acquisition/bulk_enrich', {
            business_ids: [businessId]
        });

        // Extract and restructure the data to remove the nested data object
        const fundingData = response.data?.data?.[0]?.data || {};
        console.log('Fetched funding and acquisition data:', fundingData);
        return fundingData;
    } catch (error) {
        console.error('Error fetching funding and acquisition data:', error.response?.data || error.message);
        throw new Error('Failed to fetch funding and acquisition data');
    }
};

router.post('/fetchFundingAndProductLaunchdata', async (req, res) => {
    try {
        const { name, domain, url, year } = req.body;

        // Validate required parameters
        if (!name && !domain && !url) {
            return res.status(400).json({
                status: '-1',
                message: 'At least one of: name, domain, or url is required'
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

        // Match businesses using the provided data
        const businessIds = await matchBusinesses({ name, domain, url });
        if (!businessIds.length) {
            return res.status(404).json({
                status: '-1',
                message: 'No businesses found for the given criteria'
            });
        }

        const events = await fetchBusinessEvents(businessIds, timestampFrom);

        // Check if events are empty
        if (!events.output_events || events.output_events.length === 0) {
            return res.json({
                status: '-1',
                message: 'No funding announcements found for the provided company',
                timestamp_from: timestampFrom,
                matched_business_ids: businessIds
            });
        }

        res.json({
            status: '1',
            fundingInvestmentAndProductLaunchData: events,
            count: events.output_events.length,
            timestamp_from: timestampFrom,
            matched_business_ids: businessIds
        });
    } catch (error) {
        const statusCode = error.response?.status || 500;
        res.status(statusCode).json({
            status: '-1',
            message: error.message || 'An error occurred during processing'
        });
    }
});

router.post('/fetchFundingAndAcquisition', async (req, res) => {
    try {
        const { name, domain, url } = req.body;

        // Validate required parameters
        if (!name && !domain && !url) {
            return res.status(400).json({
                status: '-1',
                message: 'At least one of: name, domain, or url is required'
            });
        }

        // Match businesses using the provided data
        const businessIds = await matchBusinesses({ name, domain, url });
        if (!businessIds.length) {
            return res.status(404).json({
                status: '-1',
                message: 'No businesses found for the given criteria'
            });
        }

        // Get funding and acquisition data for the first matched business
        const fundingData = await fetchFundingAndAcquisition(businessIds[0]);

        // Check if the response data is empty
        if (!fundingData || Object.keys(fundingData).length === 0) {
            return res.json({
                status: '-1',
                message: 'No funding and or new investment data found for the provided company',
                business_id: businessIds[0]
            });
        }

        res.json({
            status: '1',
            FundingAndAcquisitionData: fundingData,
            business_id: businessIds[0]
        });
    } catch (error) {
        const statusCode = error.response?.status || 500;
        res.status(statusCode).json({
            status: '-1',
            message: error.message || 'An error occurred during processing'
        });
    }
});

// Reusable method for fetching funding announcements
const fetchFundingAndProductLaunchSignals = async ({ name, domain, url, year }) => {
    console.log('[EXPLORIUM_BUSINESSES_API] Starting fetchFundingAndProductLaunchSignals with params:', { name, domain, url, year });

    // Validate required parameters
    if (!name && !domain && !url) {
        console.error('[EXPLORIUM_BUSINESSES_API] Validation Error: No identifier provided');
        return {
            status: '-1',
            message: 'At least one of: name, domain, or url is required'
        };
    }

    try {
        // Convert the provided year to an ISO timestamp
        const timestampFrom = validateAndConvertYear(year);
        console.log('[EXPLORIUM_BUSINESSES_API] Converted timestamp:', timestampFrom);

        // Match businesses using the provided data
        console.log('[EXPLORIUM_BUSINESSES_API] Attempting to match businesses with:', { name, domain, url });
        const businessIds = await matchBusinesses({ name, domain, url });
        if (!businessIds.length) {
            console.error('[EXPLORIUM_BUSINESSES_API] No businesses found for criteria:', { name, domain, url });
            return {
                status: '-1',
                message: 'No businesses found for the given criteria'
            };
        }
        console.log('[EXPLORIUM_BUSINESSES_API] Found business IDs:', businessIds);

        console.log('[EXPLORIUM_BUSINESSES_API] Fetching business events for IDs:', businessIds);
        const events = await fetchBusinessEvents(businessIds, timestampFrom);
        console.log('[EXPLORIUM_BUSINESSES_API] Retrieved events count:', events.length);

        // Check if events are empty
        if (!events.output_events || events.output_events.length === 0) {
            return {
                status: '-1',
                message: 'No funding announcements found for the provided company',
                timestamp_from: timestampFrom,
                matched_business_ids: businessIds
            };
        }

        const response = {
            status: '1',
            fundingInvestmentAndProductLaunchData: events,
            count: events.output_events ? events.output_events.length : 0,
            timestamp_from: timestampFrom,
            matched_business_ids: businessIds
        };
        console.log('[EXPLORIUM_BUSINESSES_API] Successfully completed fetchFundingAndProductLaunchSignals');
        return response;
    } catch (error) {
        console.error('[EXPLORIUM_BUSINESSES_API] Error in fetchFundingAndProductLaunchSignals:', error.message);
        return {
            status: '-1',
            message: error.message || 'An error occurred during processing'
        };
    }
};

// Reusable method for fetching funding and acquisition information
const fetchFundingAcquisitionInfo = async ({ name, domain, url }) => {
    console.log('[EXPLORIUM_BUSINESSES_API] Starting fetchFundingAcquisitionInfo with params:', { name, domain, url });

    // Validate required parameters
    if (!name && !domain && !url) {
        console.error('[EXPLORIUM_BUSINESSES_API] Validation Error: No identifier provided');
        return {
            status: '-1',
            message: 'At least one of: name, domain, or url is required'
        };
    }

    try {
        // Match businesses using the provided data
        console.log('[EXPLORIUM_BUSINESSES_API] Attempting to match businesses with:', { name, domain, url });
        const businessIds = await matchBusinesses({ name, domain, url });
        if (!businessIds.length) {
            console.error('[EXPLORIUM_BUSINESSES_API] No businesses found for criteria:', { name, domain, url });
            return {
                status: '-1',
                message: 'No businesses found for the given criteria'
            };
        }
        console.log('[EXPLORIUM_BUSINESSES_API] Found business IDs:', businessIds);

        // Get funding and acquisition data for the first matched business
        console.log('[EXPLORIUM_BUSINESSES_API] Fetching funding data for business ID:', businessIds[0]);
        const fundingData = await fetchFundingAndAcquisition(businessIds[0]);
        console.log('[EXPLORIUM_BUSINESSES_API] Retrieved funding data:', !!fundingData);

        // Check if the response data is empty
        if (!fundingData || Object.keys(fundingData).length === 0) {
            return {
                status: '-1',
                message: 'No funding and acquisition data found for the provided company',
                business_id: businessIds[0]
            };
        }

        const response = {
            status: '1',
            FundingAndAcquisitionData: fundingData,
            business_id: businessIds[0]
        };
        console.log('[EXPLORIUM_BUSINESSES_API] Successfully completed fetchFundingAcquisitionInfo');
        return response;
    } catch (error) {
        console.error('[EXPLORIUM_BUSINESSES_API] Error in fetchFundingAcquisitionInfo:', error.message);
        return {
            status: '-1',
            message: error.message || 'An error occurred during processing'
        };
    }
};

// Reusable method for fetching technographics data
const fetchTechnographicsData = async (businessId) => {
    try {
        console.log('[EXPLORIUM_BUSINESSES_API] Fetching technographics data for business ID:', businessId);
        const response = await exploriumAxios.post('/businesses/technographics/bulk_enrich', {
            business_ids: [businessId]
        });

        // Extract and restructure the data to remove the nested data object
        const technographicsData = response.data?.data?.[0]?.data || {};
        console.log('[EXPLORIUM_BUSINESSES_API] Retrieved technographics data:', !!technographicsData);
        return technographicsData;
    } catch (error) {
        console.error('[EXPLORIUM_BUSINESSES_API] Error fetching technographics data:', error.response?.data || error.message);
        throw new Error('Failed to fetch technographics data');
    }
};

router.post('/fetchtechnographicsdata', async (req, res) => {
    try {
        const { name, domain, url } = req.body;

        // Validate required parameters
        if (!name && !domain && !url) {
            return res.status(400).json({
                status: '-1',
                message: 'At least one of: name, domain, or url is required'
            });
        }

        // Match businesses using the provided data
        const businessIds = await matchBusinesses({ name, domain, url });
        if (!businessIds.length) {
            return res.status(404).json({
                status: '-1',
                message: 'No businesses found for the given criteria'
            });
        }

        // Get technographics data for the first matched business
        const technographicsData = await fetchTechnographicsData(businessIds[0]);

        // Check if the response data is empty
        if (!technographicsData || Object.keys(technographicsData).length === 0) {
            return res.json({
                status: '-1',
                message: 'No technographics data found for the provided company',
                business_id: businessIds[0]
            });
        }

        res.json({
            status: '1',
            technographicsData: technographicsData,
            business_id: businessIds[0]
        });
    } catch (error) {
        const statusCode = error.response?.status || 500;
        res.status(statusCode).json({
            status: '-1',
            message: error.message || 'An error occurred during processing'
        });
    }
});

// Reusable method for fetching technographics information
const fetchTechnographicsInfo = async ({ domain }) => {
    console.log('[EXPLORIUM_BUSINESSES_API] Starting fetchTechnographicsInfo with domain:', domain);

    // Validate required parameters
    if (!domain) {
        console.error('[EXPLORIUM_BUSINESSES_API] Validation Error: Domain is required');
        return {
            status: '-1',
            message: 'Domain is required'
        };
    }

    try {
        // Match businesses using the provided domain
        console.log('[EXPLORIUM_BUSINESSES_API] Attempting to match businesses with domain:', domain);
        const businessIds = await matchBusinesses({ domain });
        if (!businessIds.length) {
            console.error('[EXPLORIUM_BUSINESSES_API] No businesses found for domain:', domain);
            return {
                status: '-1',
                message: 'No businesses found for the given domain'
            };
        }
        console.log('[EXPLORIUM_BUSINESSES_API] Found business IDs:', businessIds);

        // Get technographics data for the first matched business
        console.log('[EXPLORIUM_BUSINESSES_API] Fetching technographics data for business ID:', businessIds[0]);
        const technographicsData = await fetchTechnographicsData(businessIds[0]);
        console.log('[EXPLORIUM_BUSINESSES_API] Retrieved technographics data:', !!technographicsData);

        // Check if the response data is empty
        if (!technographicsData || Object.keys(technographicsData).length === 0) {
            return {
                status: '-1',
                message: 'No technographics data found for the provided company',
                business_id: businessIds[0]
            };
        }

        const response = {
            status: '1',
            technographicsData: technographicsData,
            business_id: businessIds[0]
        };
        console.log('[EXPLORIUM_BUSINESSES_API] Successfully completed fetchTechnographicsInfo');
        return response;
    } catch (error) {
        console.error('[EXPLORIUM_BUSINESSES_API] Error in fetchTechnographicsInfo:', error.message);
        return {
            status: '-1',
            message: error.message || 'An error occurred during processing'
        };
    }
};

module.exports = {
    router,
    matchBusinesses,
    fetchBusinessEvents,
    fetchFundingAndAcquisition,
    validateAndConvertYear,
    fetchFundingAndProductLaunchSignals,
    fetchFundingAcquisitionInfo,
    fetchTechnographicsData,
    fetchTechnographicsInfo
};
