const express = require('express');
const axios = require('axios');
const router = express.Router();

const apiKey = 'bab7e837c303dcb10ff6ab67c9ac873952eb72d418d9b697f34bf9d27e3742b9';

// Person Search Endpoint
router.post('/person/search', async (req, res) => {
    const { industry, location, job_company_name, skills, job_title } = req.body;

    // Validate that at least one of the required fields is provided
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

    // Create a dynamic query object
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
        // console.log("Result ID:", response.data[0].id);
        console.log('people found successfully:', response.config.data)

    } catch (error) {
        console.error('Error getting results:', error);
        res.status(500).json({
            error: error.response ? error.response.data : error.message
        });
    }
});



router.post('/company/search', async (req, res) => {
    const { name, industry, summary, industries, location } = req.body;

    let queryObject = {
        bool: {
            must: [] 
        }
    };

    // Check if 'name' is provided
    if (name) queryObject.bool.must.push({ term: { name: name } });

    // Check if 'industry' is provided
    if (industry) queryObject.bool.must.push({ term: { industry: industry } });

    // Check if 'summary' is provided
    if (summary) queryObject.bool.must.push({ match: { summary: summary } });

    // Check if 'industries' array is provided and not empty
    if (industries && industries.length > 0) {
        queryObject.bool.must.push({ terms: { industry: industries } });
    }

    // Check if 'location' is provided before using it
    if (location) {
        queryObject.bool.must.push({ term: { "location.country": location.toLowerCase() } });
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
        console.log('company found successfully:', response.config.data)


    } catch (error) {
        console.error('Error getting results:', error);
        res.status(500).json({
            error: error.response ? error.response.data : error.message
        });
    }
});




// // Company Search Endpoint
// router.post('/company/search', async (req, res) => {
//     const { name, industry } = req.body;
//     // console.log(name, industry)

// //    { "match": { "summary": "financial solutions" } } want to use this also

//     let queryObject = { term: {} };
//     if (name) queryObject.term.name = name;
//     if (industry) queryObject.term.industry = industry;

//     const url = `https://api.peopledatalabs.com/v5/company/search`;

//     try {

//       const response = await axios.post(
//         url,
//         {
//           query: queryObject,
//           size: 4,   
//           from: 0,
//           titlecase: false,
//           pretty: false
//         },
//         {
//           headers: {
//             'Content-Type': 'application/json',
//             'X-API-Key': apiKey 
//           }
//         }
//       );


//       res.json(response.data);
//     //   console.log(response.data);
//     } catch (error) {
//         console.error('Error getting results:',error)
//         res.status(500).json({

//         error: error.response ? error.response.data : error.message
//       });
//     }
//   });



module.exports = router;






// // Person Enrichment Endpoint
// router.post('/person/enrich', async (req, res) => {
//   const { email } = req.body;

//   const url = `https://api.peopledatalabs.com/v5/person/enrich`;

//   try {
//     const response = await axios.get(url, {
//       params: {
//         api_key: apiKey,
//         email: email
//       }
//     });
//     res.json(response.data);
//   } catch (error) {
//     console.error('Error getting results:',response);
//     res.status(500).json({
//       error: error.response ? error.response.data : error.message
//     });
//   }
// });
// // Company Enrichment Endpoint
// router.post('/company/enrich', async (req, res) => {
//   const { domain } = req.body;

//   const url = `https://api.peopledatalabs.com/v5/company/enrich`;

//   try {
//     const response = await axios.get(url, {
//       params: {
//         api_key: apiKey,
//         domain: domain
//       }
//     });
//     res.json(response.data);
//   } catch (error) {
//     res.status(500).json({
//       error: error.response ? error.response.data : error.message
//     });
//   }
// });