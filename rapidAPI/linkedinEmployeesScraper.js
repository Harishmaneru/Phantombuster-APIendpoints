const express = require('express');
const router = express.Router();
const axios = require('axios');

// Reusable method to fetch LinkedIn employees data using Apify
async function getLinkedInEmployees(companyUrl) {
    const apiUrl = 'https://api.apify.com/v2/actor-tasks/your-task-id/run-sync-get-dataset-items';
    const apifyApiToken = 'apify_api_ZgKiMexVWnVuxQfpfFNytjNNPdZYVN3vE5VC';

    try {
        const response = await axios.get(apiUrl, {
            headers: {
                'Authorization': `Bearer ${apifyApiToken}`
            },
            params: {
                companyUrl: companyUrl
            }
        });

        const employeesData = response.data;

        // Check if any employees were found
        if (employeesData && employeesData.length > 0) {
            return {
                status: "1",
                message: "Successfully fetched LinkedIn employees data.",
                data: employeesData.slice(0, 100), // Limit to the latest 10 employees
            };
        } else {
            return {
                status: "0",
                message: "No employees found for the provided company URL.",
                data: [],
            };
        }
    } catch (error) {
        console.error('API Request Error:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data,
        });

        return {
            status: "-1",
            message: error.response?.data?.message || error.message || "Failed to fetch LinkedIn employees data.",
            error: error.response?.data || {},
            data: [],
        };
    }
}

// POST route to get LinkedIn employees
router.post('/getLinkedInEmployees', async (req, res) => {
    const { companyUrl } = req.body;

    if (!companyUrl) {
        return res.status(400).json({
            status: "-1",
            message: "Company URL is required.",
            data: [],
        });
    }

    try {
        const result = await getLinkedInEmployees(companyUrl);

        // Log response data for monitoring
        console.log('Sending response:', {
            status: result.status,
            message: result.message,
            dataPresent: result.data.length > 0
        });

        res.json(result);
    } catch (error) {
        console.error('Route Handler Error:', {
            message: error.message,
            stack: error.stack,
        });

        res.status(500).json({
            status: "-1",
            message: error.message || "An error occurred while fetching LinkedIn employees.",
            data: [],
            error: error.message,
        });
    }
});

module.exports = { router, getLinkedInEmployees };
