

const axios = require('axios');
const express = require('express');
const router = express.Router();

const SEC_API_KEY = 'e1cd2b9bddef9ea679d69eec99cc9c546560c0c31afeeead0d8b49e9e3e09a79';

router.post('/fetch-latest-filing', async (req, res) => {
    console.log('Received request with body:', req.body);
    const response = await fetchLatestFiling(req.body);
    res.status(200).send(response);
});

const fetchLatestFiling = async (body) => {
    console.log('Received request with body:', body);
    const { companyName, formType } = body;
    if (!companyName || !formType) {
        console.log('Missing required parameters:', { companyName, formType });
        return {
            status:"-1",
            message:"Company name and form type are required.",
            data:{}
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
        if (filings && filings.length > 0) {
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
                console.log('Warning: Some expected fields are missing:', missingFields);
            }

            // console.log('Sending dynamic response to client:', enhancedResponse);
            return {
                status:"1",
                message:"Success fully found filings for the specified company and form type.",
                data:enhancedResponse
            }
        } else {
            console.log('No filings found for:', { companyName, formType });
            return {
                status:"1",
                message:"No filings found for the specified company and form type..",
                data:{}
            }
        }
    } catch (error) {
        console.error('Error fetching filing URL:', error.message);
        console.error('Full error object:', error);
        return {
            status:"-1",
            message: error.response.data.error,
            data:{}
        }
    }
}

module.exports ={
    router,
    fetchLatestFiling
}













