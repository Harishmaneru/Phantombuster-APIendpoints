const express = require('express');
const axios = require('axios');
const router = express.Router();



// Endpoint: /webscraper
router.post('/webscraper', async (req, res) => {
    const query = req.body.query;
    let data = JSON.stringify({
        "q": query
    });
    let config = {
        method: 'post',
        url: 'https://google.serper.dev/search',
        headers: {
            'X-API-KEY': '2befb18f5d1c0a86d2a9df863e2f9742a8820fc2',
            'Content-Type': 'application/json'
        },
        data: data
    };

    try {
        const response = await axios(config);
        const results = response.data;
        if (results && results.organic) {
            res.json({
                success: true,
                data: results.organic
            });
        } else {
            res.status(404).json({ success: false, message: 'No organic results found.' });
        }
    } catch (error) {
        console.error('Error fetching search results:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching search results.',
            error: error.response ? error.response.data : error.message
        });
    }
});

module.exports = router;


// const express = require('express');
// const axios = require('axios');
// const cheerio = require('cheerio');  
// const router = express.Router();

 
// const scrapeWebsite = async (url) => {
//     try {
//         const { data } = await axios.get(url);  
//         const $ = cheerio.load(data);  

     
//         const pageTitle = $('title').text();
//         const metaDescription = $('meta[name="description"]').attr('content');

         

//         return {
//             title: pageTitle || 'No title found',
//             description: metaDescription || 'No description found',
//             url
//         };
//     } catch (error) {
//         console.error(`Error scraping ${url}:`, error.message);
//         return {
//             title: 'Error fetching details',
//             description: 'Error occurred during scraping',
//             url
//         };
//     }
// };

// // Endpoint: /webscraper
// router.post('/webscraper', async (req, res) => {
//     const query = req.body.query;
//     let data = JSON.stringify({
//         "q": query
//     });

//     let config = {
//         method: 'post',
//         url: 'https://google.serper.dev/search',
//         headers: {
//             'X-API-KEY': '2befb18f5d1c0a86d2a9df863e2f9742a8820fc2',
//             'Content-Type': 'application/json'
//         },
//         data: data
//     };

//     try {
//         const response = await axios(config);
//         const results = response.data;

//         if (results && results.organic) {
//             // Loop through each search result and scrape the linked pages
//             let enrichedResults = await Promise.all(results.organic.map(async (result) => {
//                 const scrapedData = await scrapeWebsite(result.link); // Scrape each linked page
//                 return {
//                     ...result, // Original search result
//                     details: scrapedData // Additional details from scraping the website
//                 };
//             }));

//             res.json({
//                 success: true,
//                 data: enrichedResults
//             });
//         } else {
//             res.status(404).json({ success: false, message: 'No organic results found.' });
//         }
//     } catch (error) {
//         console.error('Error fetching search results:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Error fetching search results.',
//             error: error.response ? error.response.data : error.message
//         });
//     }
// });

// module.exports = router;
