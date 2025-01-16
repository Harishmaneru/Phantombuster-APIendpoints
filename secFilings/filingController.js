const axios = require('axios');
const express = require('express');
const router = express.Router();

const SEC_API_KEY = 'fddf9ef6f4e9d4e4366d3ed5551e642ab57b0638a5eb43e05b5c92116e7a59d1';

router.post('/fetch-latest-filing', async (req, res) => {
    console.log('[API] POST /fetch-latest-filing', { body: req.body });
    const response = await fetchLatestFiling(req.body);
    res.status(200).send(response);
});

const fetchLatestFiling = async (body) => {
    const { companyName, formType } = body;
    
    if (!companyName || !formType) {
        console.error('[fetchLatestFiling] Missing required parameters', {
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
        sort: [{ filedAt: { order: 'desc' } }]
    };

    try {
        const response = await axios.post('https://api.sec-api.io', query, {
            headers: {
                Authorization: SEC_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        const filings = response.data.filings;
        
        if (filings && filings.length > 0) {
            console.log('[fetchLatestFiling] Found filing', {
                companyName,
                formType,
                accessionNo: filings[0].accessionNo
            });
            
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
                console.warn('[fetchLatestFiling] Missing expected fields', { missingFields });
            }

            return {
                status: "1",
                message: `Successfully found filings for ${companyName}, ${formType}.`,
                data: enhancedResponse
            }
        } else {
            console.warn('[fetchLatestFiling] No filings found', { companyName, formType });
            return {
                status: "0",
                message: `No filings found for the ${companyName}, ${formType}.`,
                data: {}
            }
        }
    } catch (error) {
        console.error('[fetchLatestFiling] Error fetching filing', {
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