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

const matchProspects = async (linkedinUrl) => {
    try {
        const response = await exploriumAxios.post('/prospects/match', {
            prospects_to_match: [{ linkedin: linkedinUrl }]
        });
        console.log('Matched prospects:', response.data.matched_prospects);
        // Extract prospect IDs from response
        const prospects = response.data.matched_prospects;
        return prospects.map(p => p.prospect_id);
    } catch (error) {
        console.error('Error matching prospects:', error.response?.data || error.message);
        throw new Error('Failed to match prospects');
    }
};

// Helper function to validate and convert year to timestamp
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

    // Create ISO timestamp for January 1st of the given year
    return new Date(`${year}-01-01`).toISOString();
};


const fetchPersonChanges = async (prospectIds, timestampFrom) => {
    try {
        const response = await exploriumAxios.post('/prospects/events', {
            event_types: ['prospect_changed_company', 'prospect_changed_role', 'prospect_job_start_anniversary'],
            prospect_ids: prospectIds,
            timestamp_from: timestampFrom
        });
        console.log('fetchPersonChanges:', response.data);
        return response.data || [];
    } catch (error) {
        console.error('Error fetching person changes:', error.response?.data || error.message);
        throw new Error('Failed to fetch person changes');
    }
};

const fetchPersonContactsInformation = async (prospectId) => {
    try {
        const response = await exploriumAxios.post('/prospects/enrich', {
            prospect_id: prospectId,
        });

        console.log('fetchPersonContactsInformation:', response.data);
        return response.data || [];
    } catch (error) {
        console.error('Error fetchPersonContactsInformation:', error.response?.data || error.message);
        throw error;
    }
};

const fetchPersonProfessionalProfile = async (prospectId) => {
    try {
        const response = await exploriumAxios.post('/prospects/professional-profile/enrich', {
            prospect_id: prospectId,
        });

        console.log('fetchPersonProfessionalProfile:', response.data);
        return response.data || [];
    } catch (error) {
        console.error('Error fetchPersonProfessionalProfile:', error.response?.data || error.message);
        throw error;
    }
};

//API's for fetching person changes, person contacts information, person professional profile
router.post('/fetch-person-changes', async (req, res) => {
    try {
        const { linkedinUrl, year } = req.body;

        // Validate required parameters
        if (!linkedinUrl) {
            return res.status(400).json({
                status: '-1',
                message: 'LinkedIn URL is required'
            });
        }

        // Convert year to timestamp
        let timestampFrom;
        try {
            timestampFrom = validateAndConvertYear(year);
        } catch (yearError) {
            return res.status(400).json({
                status: '-1',
                message: yearError.message
            });
        }

        // Get prospect IDs
        const prospectIds = await matchProspects(linkedinUrl);
        if (!prospectIds.length) {
            return res.status(404).json({
                status: '-1',
                message: 'No prospects found for the given LinkedIn URL'
            });
        }

        // Get combined changes
        const changes = await fetchPersonChanges(prospectIds, timestampFrom);

        res.json({
            status: '1',
            personchanges: changes,
            count: changes.length,
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

router.post('/fetch-person-info', async (req, res) => {
    try {
        const { linkedinUrl } = req.body;

        // Validate required parameters
        if (!linkedinUrl) {
            return res.status(400).json({
                status: '-1',
                message: 'LinkedIn URL is required'
            });
        }

        // Get prospect IDs
        const prospectIds = await matchProspects(linkedinUrl);
        if (!prospectIds.length) {
            return res.status(404).json({
                status: '-1',
                message: 'No prospects found for the given LinkedIn URL'
            });
        }

        // Get combined changes
        const PersonContactsInformation = await fetchPersonContactsInformation(prospectIds);

        res.json({
            status: '1',
            PersonContactsInformation: PersonContactsInformation,
            PersonContactsInformation: PersonContactsInformation.length,
        });

    } catch (error) {
        const statusCode = error.response?.status || 500;

        // Send the actual error message from the API
        const errorMessage = (() => {
            try {
                if (error.response?.data) {
                    // Handle Explorium-style errors
                    if (typeof error.response.data === 'object') {
                        return error.response.data.detail ||
                            error.response.data.message ||
                            JSON.stringify(error.response.data);
                    }
                    return error.response.data;
                }
                return error.message || 'An error occurred during processing';
            } catch (parseError) {
                return 'Contacts Information Not Found';
            }
        })();

        res.status(statusCode).json({
            status: '-1',
            message: errorMessage

        });
    }
});


router.post('/fetchProfessionalinfo', async (req, res) => {
    try {
        const { linkedinUrl } = req.body;

        // Validate required parameters
        if (!linkedinUrl) {
            return res.status(400).json({
                status: '-1',
                message: 'LinkedIn URL is required'
            });
        }

        // Get prospect IDs
        const prospectIds = await matchProspects(linkedinUrl);
        if (!prospectIds.length) {
            return res.status(404).json({
                status: '-1',
                message: 'No prospects found for the given LinkedIn URL'
            });
        }

        // Get combined changes
        const PersonContactsInformation = await fetchPersonProfessionalProfile(prospectIds);

        res.json({
            status: '1',
            PersonContactsInformation: PersonContactsInformation,
            PersonContactsInformation: PersonContactsInformation.length,
        });

    } catch (error) {
        const statusCode = error.response?.status || 500;

        // Send the actual error message from the API
        const errorMessage = (() => {
            try {
                if (error.response?.data) {
                    // Handle Explorium-style errors
                    if (typeof error.response.data === 'object') {
                        return error.response.data.detail ||
                            error.response.data.message ||
                            JSON.stringify(error.response.data);
                    }
                    return error.response.data;
                }
                return error.message || 'An error occurred during processing';
            } catch (parseError) {
                return 'Contacts Information Not Found';
            }
        })();

        res.status(statusCode).json({
            status: '-1',
            message: errorMessage

        });
    }
});
module.exports = router;