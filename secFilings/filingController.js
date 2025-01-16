const axios = require('axios');
const express = require('express');
const router = express.Router();

const SEC_API_KEY = 'fddf9ef6f4e9d4e4366d3ed5551e642ab57b0638a5eb43e05b5c92116e7a59d1';

router.post('/fetch-latest-filing', async (req, res) => {
    console.log(' [API] POST /fetch-latest-filing - Starting request processing');
    console.log(' [API] Request body:', JSON.stringify(req.body, null, 2));

    const response = await fetchLatestFiling(req.body);
    console.log(' [API] Sending response:', JSON.stringify(response, null, 2));
    res.status(200).send(response);
});

const fetchLatestFiling = async (body) => {
    console.log('\n [fetchLatestFiling] Starting with body:', JSON.stringify(body, null, 2));
    
    const { companyName, formType } = body;
    
    // Parameter validation
    if (!companyName || !formType) {
        console.warn(' [fetchLatestFiling] Missing required parameters:', {
            companyName: companyName || 'MISSING',
            formType: formType || 'MISSING'
        });
        return {
            status: "-1",
            message: "Company name and form type are required.",
            data: {}
        }
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

    console.log(' [fetchLatestFiling] Constructed SEC API query:', JSON.stringify(query, null, 2));

    try {
        console.log(' [fetchLatestFiling] Sending request to SEC API...');
        const response = await axios.post('https://api.sec-api.io', query, {
            headers: {
                Authorization: SEC_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        console.log(` [fetchLatestFiling] SEC API Response Status: ${response.status} (${response.statusText})`);
        console.log(' [fetchLatestFiling] Response data size:', JSON.stringify(response.data).length, 'bytes');

        const filings = response.data.filings;
        
        if (filings && filings.length > 0) {
            console.log(' [fetchLatestFiling] Found', filings.length, 'filing(s)');
            
            const latestFiling = filings[0];
            const enhancedResponse = {};
            
            const expectedFields = [
                'ticker', 'formType', 'accessionNo', 'cik', 'companyNameLong',
                'companyName', 'linkToFilingDetails', 'description', 'linkToTxt',
                'filedAt', 'documentFormatFiles', 'periodOfReport', 'entities',
                'id', 'seriesAndClassesContractsInformation', 'linkToHtml',
                'linkToXbrl', 'dataFiles'
            ];

            Object.entries(latestFiling).forEach(([key, value]) => {
                enhancedResponse[key] = value;
            });

            const missingFields = expectedFields.filter(field => !(field in enhancedResponse));
            if (missingFields.length > 0) {
                console.warn(' [fetchLatestFiling] Missing expected fields:', missingFields);
            }

            console.log(' [fetchLatestFiling] Successfully processed filing data');
            return {
                status: "1",
                message: "Successfully found filings for the specified company and form type.",
                data: enhancedResponse
            }
        } else {
            console.warn(' [fetchLatestFiling] No filings found:', { companyName, formType });
            return {
                status: "1",
                message: "No filings found for the specified company and form type.",
                data: {}
            }
        }
    } catch (error) {
        console.error(' [fetchLatestFiling] Error fetching filing:', {
            message: error.message,
            status: error.response?.status,
            statusText: error.response?.statusText,
            errorData: error.response?.data
        });

        return {
            status: "-1",
            message: error.response?.data?.error || 'An unexpected error occurred',
            data: {}
        }
    }
}

module.exports = {
    router,
    fetchLatestFiling
}