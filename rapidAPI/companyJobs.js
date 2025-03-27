
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const router = express.Router();  
const RAPIDAPI_HOST = 'linkedin-data-scraper.p.rapidapi.com';
const RAPIDAPI_KEY = '265efbe094msh21bc518404ee2cep1ac560jsn3281b82d3aed';
const RAPIDAPI_URL = 'https://linkedin-data-scraper.p.rapidapi.com/company_jobs';

// Helper function to convert "listedAt" to minutes
const parseListedAtTime = (listedAt) => {
    if (!listedAt) return Infinity;
    const regex = /(\d+)\s*(minute|hour|day|month|year)s?\sago/;
    const match = listedAt.match(regex);
    if (!match) return Infinity;

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
        case 'minute': return value;
        case 'hour': return value * 60;
        case 'day': return value * 24 * 60;
        case 'month': return value * 30 * 24 * 60;
        case 'year': return value * 365 * 24 * 60;
        default: return Infinity;
    }
};

const filterJobsByCountry = (jobs, countryCode) => {
    if (!jobs || !Array.isArray(jobs)) return [];
    const targetCountry = countryCode.toLowerCase();
    const filtered = jobs.filter(job => job.country?.toLowerCase() === targetCountry);

    // Sort by most recent first based on "listedAt"
    filtered.sort((a, b) => {
        const timeA = parseListedAtTime(a.listedAt);
        const timeB = parseListedAtTime(b.listedAt);
        return timeA - timeB;
    });

    return filtered;
};

const getCountryCode = (location) => {
    const countryMap = {
        'united states': 'us',
        'us': 'us',
        'usa': 'us',
        'united kingdom': 'gb',
        'uk': 'gb',
        'great britain': 'gb',
        'canada': 'ca',
        'australia': 'au',
        'france': 'fr',
        'germany': 'de',
        'spain': 'es',
        'mexico': 'mx'
    };

    return countryMap[location.toLowerCase()] || location.toLowerCase();
};

const fetchCompanyJobs = async (companyUrl) => {
    try {
        const response = await axios.post(RAPIDAPI_URL, {
            company_url: companyUrl,
            count: 40
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-rapidapi-host': RAPIDAPI_HOST,
                'x-rapidapi-key': RAPIDAPI_KEY
            }
        });

        if (response.data && response.data.success) {
            const allJobs = response.data.response?.data?.jobs || [];

            // 1. Filter US jobs first
            let filteredJobs = filterJobsByCountry(allJobs, 'us');

            // 2. If no US jobs found, try Canada and Mexico
            if (filteredJobs.length === 0) {
                console.log('No US jobs found, checking nearby countries...');
                filteredJobs = filterJobsByCountry(allJobs, 'ca');

                if (filteredJobs.length === 0) {
                    // console.log('No jobs found in Canada, checking Mexico...');
                    filteredJobs = filterJobsByCountry(allJobs, 'mx');
                }
            }

            // 3. If still no jobs found, return all jobs
            if (filteredJobs.length === 0) {
                console.log('Returning all available jobs.');
                filteredJobs = allJobs;
            }

            return {
                status: "1",
                message: filteredJobs.length > 0
                    ? "Successfully fetched company jobs."
                    : "No jobs found.",
                data: {
                    jobs: filteredJobs,
                    total: filteredJobs.length
                }
            };
        } else {
            return {
                status: "-1",
                message: "Invalid response from jobs API.",
                data: {}
            };
        }
    } catch (error) {
        console.error('API Request Error:', {
            message: error.message,
            stack: error.stack
        });

        if (error.response) {
            return {
                status: "-1",
                message: error.response.data.message || "Failed to fetch company jobs.",
                data: {}
            };
        }

        return {
            status: "-1",
            message: "Failed to fetch company jobs.",
            data: {}
        };
    }
};

router.post('/getCompanyJobs', async (req, res) => {
    const { companyUrl } = req.body;

    if (!companyUrl) {
        return res.status(400).json({
            status: "-1",
            message: "Company LinkedIn URL is required.",
            data: {}
        });
    }

    try {
        const response = await fetchCompanyJobs(companyUrl);
        console.log('Sending response:', {
            status: response.status,
            message: response.message,
            dataPresent: !!response.data
        });
        res.send(response);
    } catch (error) {
        res.status(500).json({
            status: "-1",
            message: error.message ||  "An error occurred while fetching company jobs.",
            data: {},
            error: error.message
        });
    }
});

module.exports = {
    router,
    fetchCompanyJobs
};
