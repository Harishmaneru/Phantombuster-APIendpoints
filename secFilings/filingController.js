const axios = require('axios');
const express = require('express');
const router = express.Router();

const SEC_API_KEY = 'a4b8d2116974c6ed4fed5d5d5a3088e5a003055cc864eaf77fb0562b95c73ed6';

router.post('/fetch-latest-filing', async (req, res) => {
    console.log('Received request with body:', req.body);
    const { companyName, formType } = req.body;

    if (!companyName || !formType) {
        console.log('Missing required parameters:', { companyName, formType });
        return res.status(400).json({ error: 'Company name and form type are required.' });
    }

    const query = {
        query: {
            query_string: {
                query: `companyName:"${companyName}" AND formType:"${formType}"`
            }
        },
        from: 0,
        size: 1,
        sort: [
            {
                filedAt: {
                    order: 'desc'
                }
            }
        ]
    };

    console.log('Sending query to SEC API:', query);

    try {
        const response = await axios.post('https://api.sec-api.io', query, {
            headers: {
                Authorization: SEC_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        console.log('Received response from SEC API:', response.status, response.statusText);
        
        const filings = response.data.filings;
        // console.log('Fetched Filings Successfully:', filings);

        if (filings && filings.length > 0) {
            const latestFiling = filings[0];
            // console.log('Processing latest filing:', latestFiling);

            // Create dynamic response object with all available fields
            const enhancedResponse = {};
            
            // Log any missing fields for monitoring
            const expectedFields = [
                'ticker', 'formType', 'accessionNo', 'cik', 'companyNameLong',
                'companyName', 'linkToFilingDetails', 'description', 'linkToTxt',
                'filedAt', 'documentFormatFiles', 'periodOfReport', 'entities',
                'id', 'seriesAndClassesContractsInformation', 'linkToHtml',
                'linkToXbrl', 'dataFiles'
            ];

            // Add all available fields to response
            Object.entries(latestFiling).forEach(([key, value]) => {
                enhancedResponse[key] = value;
            });

            // Log any missing expected fields for monitoring
            const missingFields = expectedFields.filter(field => !(field in enhancedResponse));
            if (missingFields.length > 0) {
                console.log('Warning: Some expected fields are missing:', missingFields);
            }

            console.log('Sending dynamic response to client:', enhancedResponse);
            return res.status(200).json(enhancedResponse);
        } else {
            console.log('No filings found for:', { companyName, formType });
            return res.status(404).json({ error: 'No filings found for the specified company and form type.' });
        }
    } catch (error) {
        console.error('Error fetching filing URL:', error.message);
        console.error('Full error object:', error);
        return res.status(500).json({ 
            error: 'Internal server error.',
            details: error.message
        });
    }
});

module.exports = router;










