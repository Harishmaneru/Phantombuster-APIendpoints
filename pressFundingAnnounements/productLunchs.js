const axios = require('axios');
const express = require('express');
const router = express.Router();
const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0'
];
const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const axiosInstance = axios.create({
    timeout: 30000,
    headers: {
        'Content-Type': 'application/json'
    }
});

router.post('/fetch-productlaunchsignals', async (req, res) => {
    try {
        console.log('Received request body:', req.body);
        const response = await fetchProductLaunchSignals(req.body);
        // console.log('Final response:', response);
        res.status(200).json(response);
    } catch (error) {
        console.error('Error in route handler:', error);
        res.status(500).json({ status: "-1", message: error.message });
    }
});

const fetchProductLaunchSignals = async ({ companyName }) => {
    if (!companyName) throw new Error("companyName is required.");
    console.log('Searching for company:', companyName);

    const searchResults = await searchProductLaunches(companyName);
    // console.log('Search results:', searchResults);

    if (!searchResults.length) return { status: "-1", message: `No data for ${companyName}` };

    const analyzedResults = await analyzeResults(searchResults, companyName);
    // console.log('Analyzed results:', analyzedResults);
    return { status: "1", message: "Product signals fetched", data: analyzedResults };
};

const searchProductLaunches = async (companyName) => {
    const url = `https://videoresponse.onepgr.com:3001/webscraper`;
    const body = {
        query: `${companyName} new product launch in this year`
    };

    console.log('Sending search query to WebScraper API:', body);

    try {
        const response = await axiosInstance.post(url, body);
        // console.log('WebScraper API response data:', response.data);

        if (response.data.success && Array.isArray(response.data.data)) {
            const results = response.data.data.map(item => ({
                title: item.title || 'No Title',
                link: item.link || 'No Link',
                snippet: item.snippet || 'No Snippet'
            }));
            console.log('WebScraper results count:', results.length);
            return results;
        } else {
            console.error('Unexpected response structure from WebScraper API');
            return [];
        }
    } catch (error) {
        console.error('Error with WebScraper API:', error.message);
        return [];
    }
};

const analyzeResults = async (results, companyName) => {
    const analyzedData = [];
    for (const result of results) {
        try {
            // console.log('Fetching additional content for:', result.link);
            const articleContent = await fetchArticleContent(result.link);

            const prompt = `Analyze the following article content and confirm if it mentions a new product launch for ${companyName}. Provide a structured JSON response:\n\nTitle: ${result.title}\nSnippet: ${result.snippet}\nArticle Content: ${articleContent}\n\nResponse format:\n{
 "isProductLaunch": true/false,
 "productName": "",
 "launchDate": "",
 "keyFeatures": [],
 "confidence": 0-1
}`;

            const openaiResponse = await openai.chat.completions.create({
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2,
                max_tokens: 500
            });

            const parsedData = JSON.parse(openaiResponse.choices[0].message.content);
            // console.log('OpenAI response:', parsedData);
            if (parsedData.isProductLaunch && parsedData.confidence > 0.7) {
                analyzedData.push({ ...result, extractedData: parsedData });
            }
        } catch (error) {
            console.error('Error analyzing article:', error.message);
        }
    }
    return analyzedData;
};

const fetchArticleContent = async (url, retries = 3) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': getRandomUserAgent()
                }
            });
            return response.data.slice(0, 2000); // Limiting content length
        } catch (error) {
            console.error(`Error fetching article content (attempt ${attempt}):`, error.message);
            if (attempt === retries) return '';
        }
    }
};

module.exports = { router, fetchProductLaunchSignals };