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
const getRandomUserAgent = () => {
    const agent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    console.log('Selected User Agent:', agent);
    return agent;
};

const axiosInstance = axios.create({
    timeout: 30000,
    headers: {
        'Content-Type': 'application/json'
    }
});

router.post('/fetch-publicmentions', async (req, res) => {
    console.log('Starting /fetch-publicmentions route');
    try {
        console.log('Request body:', req.body);
        const response = await fetchPublicMentions(req.body);
        console.log('Route completed successfully');
        res.status(200).json(response);
    } catch (error) {
        console.error('Error in route handler:', error.message);
        res.status(500).json({ status: "-1", message: error.message });
    }
});

const fetchPublicMentions = async ({ companyName }) => {
    console.log('Starting fetchPublicMentions for company:', companyName);
    if (!companyName) {
        console.error('Company name missing');
        throw new Error("companyName is required.");
    }

    console.log('🔍 Initiating public mentions search');
    const searchResults = await searchPublicMentions(companyName);
    console.log(`Found ${searchResults.length} search results`);

    if (!searchResults.length) {
        console.log('No results found');
        return { status: "-1", message: `No public mentions found for ${companyName}` };
    }

    console.log('Starting analysis of search results');
    const analyzedResults = await analyzePublicMentions(searchResults, companyName);
    console.log('Analysis completed');
    return { status: "1", message: "Public mentions fetched", data: analyzedResults };
};

const searchPublicMentions = async (companyName) => {
    console.log('Searching public mentions with WebScraper API');
    const url = `https://videoresponse.onepgr.com:3001/webscraper`;
    const body = {
        query: `${companyName} latest news or blogs`
    };

    try {
        console.log('Sending request to WebScraper API');
        const response = await axiosInstance.post(url, body);
        if (response.data.success && Array.isArray(response.data.data)) {
            console.log(`WebScraper API returned ${response.data.data.length} results`);
            return response.data.data.map(item => ({
                title: item.title || 'No Title',
                link: item.link || 'No Link',
                snippet: item.snippet || 'No Snippet'
            }));
        } else {
            console.log('No valid data from WebScraper API');
            return [];
        }
    } catch (error) {
        console.error('WebScraper API error:', error.message);
        return [];
    }
};

const analyzePublicMentions = async (results, companyName) => {
    console.log(` Starting analysis of ${results.length} results`);
    const analyzedData = [];
    for (const [index, result] of results.entries()) {
        console.log(`\n Analyzing article ${index + 1}/${results.length}`);
        console.log('🔗 URL:', result.link);
        
        try {
            console.log(' Fetching article content');
            const articleContent = await fetchArticleContent(result.link);
            
            console.log('Sending to OpenAI for analysis');
            const prompt = `Analyze the following content and confirm if it mentions public news or blog posts for ${companyName}. Provide a structured JSON response:\n\nTitle: ${result.title}\nSnippet: ${result.snippet}\nContent: ${articleContent}`;

            const openaiResponse = await openai.chat.completions.create({
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2,
                max_tokens: 500
            });
            console.log(' OpenAI analysis completed');

            const parsedData = JSON.parse(openaiResponse.choices[0].message.content);
            analyzedData.push({ ...result, extractedData: parsedData });

        } catch (error) {
            console.error('Error analyzing article:', error.message);
        }
    }
    console.log(`\n Completed analysis of ${analyzedData.length}/${results.length} articles`);
    return analyzedData;
};

const fetchArticleContent = async (url, retries = 3) => {
    console.log(`Fetching article content with ${retries} max retries`);
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`Attempt ${attempt}/${retries}`);
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': getRandomUserAgent(),
                    'Referer': 'https://www.google.com/',
                    'Accept-Language': 'en-US,en;q=0.9',
                }
            });
            console.log('Article content fetched successfully');
            return response.data.slice(0, 2000);  
        } catch (error) {
            console.error(`Error fetching article content (attempt ${attempt}/${retries}):`, error.message);
            if (attempt === retries) {
                console.log(' All retry attempts exhausted');
                return ''; 
            }
        }
    }
};

module.exports = { router, fetchPublicMentions };