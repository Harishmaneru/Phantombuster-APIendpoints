const express = require('express');
const axios = require('axios');
const router = express.Router();

const apiKey = 'bab7e837c303dcb10ff6ab67c9ac873952eb72d418d9b697f34bf9d27e3742b9';
router.use(express.json());
// Person Search Endpoint
router.post('/person/search', async (req, res) => {
    const { industry, location, job_company_name, skills, job_title } = req.body;

    if (!industry && !location && !job_company_name && !skills && !job_title) {
        return res.status(400).json({
            error: "Please provide exactly any one of the following fields: industry, job_company_name, skills, or job_title."
        });
    }
    if (
        (industry && typeof industry !== 'string') ||
        (location && typeof location !== 'string') ||
        (job_company_name && typeof job_company_name !== 'string') ||
        (skills && typeof skills !== 'string') ||
        (job_title && typeof job_title !== 'string')
    ) {
        return res.status(400).json({
            error: "All input fields must be of type string."
        });
    }

    let queryObject = { term: {} };

    if (industry) queryObject.term.industry = industry;
    if (location) queryObject.term.location = location;
    if (job_company_name) queryObject.term.job_company_name = job_company_name;
    if (skills) queryObject.term.skills = skills;
    if (job_title) queryObject.term.job_title = job_title;

    const url = `https://api.peopledatalabs.com/v5/person/search`;

    try {
        const response = await axios.post(
            url,
            {
                query: queryObject,
                size: 1,
                from: 0,
                titlecase: false,
                pretty: false
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey
                }
            }
        );

        res.json(response.data);
        console.log('people found successfully:', response.config.data);

    } catch (error) {
        console.error('Error getting results:', error);
        res.status(500).json({
            error: error.response ? error.response.data : error.message
        });
    }
});

// Company Search Endpoint
router.post('/company/search', async (req, res) => {
    const { name, industry, summary, industries, location } = req.body;

    let queryObject = {
        bool: {
            must: [] 
        }
    };

    if (name) queryObject.bool.must.push({ term: { name: name } });
    if (industry) queryObject.bool.must.push({ term: { industry: industry } });
    if (summary) queryObject.bool.must.push({ match: { summary: summary } });
    if (industries && industries.length > 0) {
        queryObject.bool.must.push({ terms: { industry: industries } });
    }
    if (location) {
        queryObject.bool.must.push({ term: { "location.name": location.toLowerCase() } });
    }

    const url = `https://api.peopledatalabs.com/v5/company/search`;

    try {
        const response = await axios.post(
            url,
            {
                query: queryObject,
                size: 1,
                from: 0,
                titlecase: false,
                pretty: false
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey
                }
            }
        );

        res.json(response.data);
        console.log('company found successfully:', response.config.data);

    } catch (error) {
        console.error('Error getting results:', error);
        res.status(500).json({
            error: error.response ? error.response.data : error.message
        });
    }
});

// PERSON ENRICHMENT API
router.post('/person/enrich', async (req, res) => {
    const { requests } = req.body;

    // Input validation
    if (!requests || !Array.isArray(requests) || requests.length === 0) {
        return res.status(400).json({
            error: "Please provide an array of requests with LinkedIn profile URLs or other supported fields in the 'requests' field of the request body."
        });
    }

    const linkedInUrlRegex = /^https:\/\/(www\.)?linkedin\.com\/in\/[\w\-]+\/?$/;

    // Helper function to extract core company name
    const extractCompanyName = (company) => {
        return company.split(",")[0].trim();
    };

    // Validate each request
    for (const request of requests) {
        const params = request.params;
        
        if (!params) {
            return res.status(400).json({
                error: "Each request must have a 'params' object."
            });
        }

        // Validate LinkedIn profile URL if provided
        if (params.profile && !linkedInUrlRegex.test(params.profile)) {
            return res.status(400).json({
                error: "Invalid LinkedIn profile URL format in one or more requests. Each profile URL should match 'https://www.linkedin.com/in/username'."
            });
        }

        // Validate minimum required fields for name-based search
        if (!params.profile && !params.email && !params.phone && !params.email_hash && !params.lid && !params.pdl_id &&
            (!params.first_name || !params.last_name) &&
            (!params.name || (!params.company && !params.school && !params.location && !params.street_address && 
            !params.locality && !params.region && !params.country && !params.postal_code && !params.birth_date))) {
            return res.status(400).json({
                error: "Each request must contain at least one identifier such as profile, email, phone, email_hash, lid, or pdl_id. For name-based searches, include first_name and last_name or name, and at least one additional field like company, school, location, etc."
            });
        }

        // Process the company name if provided
        if (params.company) {
            params.company = extractCompanyName(params.company);
        }

        // Default location example
        params.location = params.location || "Medford, OR USA";
    }

    try {
        const response = await axios({
            method: 'post',
            url: 'https://api.peopledatalabs.com/v5/person/bulk',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey,   
                'accept': 'application/json'
            },
            data: {
                requests: requests.map(request => ({
                    params: {
                        ...request.params,
                        pretty: false,
                        min_likelihood: 2,
                        include_if_matched: false,
                        titlecase: false
                    }
                }))
            }
        });

        // Log successful request
        console.log('Person enrich request successful:', {
            profiles: requests.map(request => request.params.profile),
            status: response.status,
            timestamp: new Date().toISOString()
        });

        res.json(response.data);

    } catch (error) {
        // Enhanced error handling
        console.error('Error enriching person:', {
            profiles: requests.map(request => request.params.profile),
            error: error.message,
            timestamp: new Date().toISOString(),
            response: error.response?.data
        });

        const errorResponse = {
            error: 'Failed to enrich person data',
            details: error.response?.data || error.message,
            timestamp: new Date().toISOString()
        };

        const statusCode = error.response?.status || 500;
        res.status(statusCode).json(errorResponse);
    }
});

// Ip Enrichment API
router.post('/ip/enrich', async (req, res) => {
    const { ip } = req.body;

    if (!ip) {
        return res.status(400).json({
            error: "Please provide an IP address in the request body."
        });
    }

    const url = `https://api.peopledatalabs.com/v5/ip/enrich?ip=${ip}&return_ip_location=true&return_ip_metadata=true&return_person=true&return_if_unmatched=true`;

    try {
        const response = await axios.get(url, {
            headers: {
                'X-API-Key': apiKey,
                'Accept': 'application/json'
            }
        });

        res.json(response.data);
        console.log('IP enrichment successful:', response.data);

    } catch (error) {
        console.error('Error enriching IP:', error);
        res.status(500).json({
            error: error.response ? error.response.data : error.message
        });
    }
});

module.exports = router;
