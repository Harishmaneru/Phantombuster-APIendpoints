// const axios = require('axios');
// const express = require('express');
// const puppeteer = require('puppeteer');
// const router = express.Router();

// const ADZUNA_APP_ID = 'eb7bd0b4';
// const ADZUNA_APP_KEY = 'ece2b22a1999da408461f76e7e8560b4';

// const { OpenAI } = require('openai');
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// // Validate LinkedIn URL format
// const isValidLinkedInUrl = (url) => {
//     if (!url || url === 'null' || url === 'N/A' || url === 'undefined') {
//         return false;
//     }
//     const linkedinUrlRegex = /^https?:\/\/([\w]+\.)?linkedin\.com\/company\/[\w\-]+\/?$/i;
//     return linkedinUrlRegex.test(url);
// };


// async function extractJobDescriptionWithAI(content) {
//     try {
//         console.log('Processing job description with OpenAI...');

//         const messages = [
//             {
//                 role: 'system',
//                 content: `You are a helpful assistant that extracts detailed job descriptions.
//                 Your goal is to extract and organize the job description in the following sections if present:
//                 - Job Description
//                 - Responsibilities
//                 - Qualifications
//                 - Benefits
//                 - Working Model
//                 Preserve all relevant details and avoid summarizing.`
//             },
//             {
//                 role: 'user',
//                 content: `Extract the full job details from the following content. Include all available information and organize it into logical sections:\n\n${content}`
//             }
//         ];

//         const response = await openai.chat.completions.create({
//             model: 'gpt-3.5-turbo',
//             messages,
//             max_tokens: 2000,
//             temperature: 0.5,
//             top_p: 1
//         });

//         // Validate and return the full response content
//         if (response && response.choices && response.choices[0] && response.choices[0].message) {
//             return response.choices[0].message.content.trim();
//         } else {
//             console.error('Unexpected API Response Structure:', JSON.stringify(response, null, 2));
//             throw new Error('Invalid API response structure. Unable to extract job details.');
//         }
//     } catch (error) {
//         console.error('Error in extractJobDescriptionWithAI:', error);
//         if (error.response) {
//             console.error('API Error Response:', JSON.stringify(error.response.data, null, 2));
//         }
//         return 'Unable to extract job details.';
//     }
// }


// // Enhanced company name extraction with validation
// const extractCompanyFromLinkedInURL = (linkedinUrl) => {
//     try {
//         if (!isValidLinkedInUrl(linkedinUrl)) {
//             console.log('Invalid LinkedIn URL format:', linkedinUrl);
//             return null;
//         }

//         const urlPatterns = [
//             /linkedin\.com\/company\/([^\/\?]+)/i,
//             /linkedin\.com\/school\/([^\/\?]+)/i,
//             /linkedin\.com\/organization\/([^\/\?]+)/i
//         ];

//         for (const pattern of urlPatterns) {
//             const match = linkedinUrl.match(pattern);
//             if (match && match[1]) {
//                 const companyName = match[1]
//                     .replace(/-/g, ' ')
//                     .replace(/\+/g, ' ')
//                     .replace(/%20/g, ' ')
//                     .trim();

//                 // Validate extracted company name
//                 if (companyName.length < 2) {
//                     console.log('Extracted company name too short:', companyName);
//                     return null;
//                 }

//                 console.log('Successfully extracted company name:', companyName);
//                 return companyName;
//             }
//         }

//         console.log('No company name pattern matched in URL:', linkedinUrl);
//         return null;
//     } catch (error) {
//         console.error('Error extracting company name from LinkedIn URL:', error);
//         return null;
//     }
// };

// // Main function to fetch job listings with enhanced validation
// const fetchAdzunaJobListings = async (body) => {
//     try {
//         const { linkedinUrl } = body;

//         // Validate LinkedIn URL
//         if (!linkedinUrl) {
//             return {
//                 status: "0",
//                 message: "LinkedIn URL is required",
//                 data: []
//             };
//         }

//         // Extract company name
//         const targetCompany = extractCompanyFromLinkedInURL(linkedinUrl);
//         console.log('Extracted company name:', targetCompany);

//         if (!targetCompany) {
//             return {
//                 status: "0",
//                 message: "Invalid LinkedIn URL or unable to extract company name",
//                 data: []
//             };
//         }

//         const scrapingQueue = new ScrapingQueue(2);

//         const baseUrl = 'https://api.adzuna.com/v1/api/jobs/us/search/1';
//         const params = {
//             app_id: ADZUNA_APP_ID,
//             app_key: ADZUNA_APP_KEY,
//             results_per_page: 5,
//             company: targetCompany
//         };

//         console.log('Searching for jobs with params:', params);
//         const response = await axios.get(baseUrl, { params });
//         const jobListings = response.data.results;

//         if (!jobListings?.length) {
//             return {
//                 status: "0",
//                 message: `No job listings found for company: ${targetCompany}`,
//                 data: []
//             };
//         }

//         const enhancedJobListings = await Promise.all(
//             jobListings.map(async (job) => {
//                 const scrapedDetails = await scrapeJobDetails(job.redirect_url, scrapingQueue);

//                 return {
//                     title: job.title,
//                     company: job.company?.display_name || 'Not specified',
//                     location: job.location?.display_name || 'Not specified',
//                     contract: {
//                         type: job.contract_type || 'Not specified',
//                         time: job.contract_time || 'Not specified'
//                     },
//                     salary: job.salary_min && job.salary_max ? {
//                         min: job.salary_min,
//                         max: job.salary_max,
//                         currency: 'USD',
//                         is_predicted: job.salary_is_predicted === "1"
//                     } : null,
//                     description: {
//                         original: job.description,
//                         "Full Job Description": scrapedDetails.aiProcessedDescription
//                     },
//                     url: job.redirect_url,
//                     postedDate: job.created
//                 };
//             })
//         );

//         return {
//             status: "1",
//             message: "Successfully fetched job listings",
//             data: enhancedJobListings
//         };

//     } catch (error) {
//         console.error('Error fetching jobs:', error);
//         return {
//             status: "-1",
//             message: `Error: ${error.message}`,
//             data: []
//         };
//     }
// };

// // Enhanced route handler with input validation
// router.post('/fetch-jobssignals', async (req, res) => {
//     try {
//         console.log('Received request with body:', req.body);

//         // Basic request body validation
//         if (!req.body || typeof req.body !== 'object') {
//             return res.status(400).json({
//                 status: "0",
//                 message: "Invalid request body",
//                 data: []
//             });
//         }

//         const response = await fetchAdzunaJobListings(req.body);

//         // Send appropriate HTTP status based on the operation status
//         const httpStatus = response.status === "1" ? 200 :
//             response.status === "0" ? 400 : 500;

//         res.status(httpStatus).json(response);

//     } catch (error) {
//         console.error('Route handler error:', error);
//         res.status(500).json({
//             status: "-1",
//             message: "Internal server error",
//             data: []
//         });
//     }
// });
// let browserInstance = null;
// async function getBrowser() {
//     if (!browserInstance) {
//         browserInstance = await puppeteer.launch({
//             headless: 'new',
//             args: ['--no-sandbox', '--disable-setuid-sandbox']
//         });
//     }
//     return browserInstance;
// }
// async function scrapeJobDetails(url, queue) {
//     return queue.add(async () => {
//         console.log('Scraping details from:', url);
//         const browser = await getBrowser();
//         const page = await browser.newPage();

//         try {
//             await page.setDefaultNavigationTimeout(30000);
//             await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

//             await page.goto(url, { waitUntil: 'networkidle0' });

//             const jobContent = await page.evaluate(() => {
//                 function cleanText(text) {
//                     return text.replace(/\s+/g, ' ').trim();
//                 }

//                 // Define relevant job sections
//                 const relevantSections = [
//                     'job description',
//                     'responsibilities',
//                     'requirements',
//                     'qualifications',
//                     'skills',
//                     'experience',
//                     'about the role',
//                     'about this position',
//                     'what you\'ll do',
//                     'what we\'re looking for',
//                     'benefits',
//                     'perks',
//                     'compensation'
//                 ];

//                 function isRelevantHeading(text) {
//                     return relevantSections.some(section =>
//                         text.toLowerCase().includes(section)
//                     );
//                 }

//                 function extractJobContent() {
//                     const sections = [];
//                     let currentSection = {
//                         heading: '',
//                         content: []
//                     };

//                     const walker = document.createTreeWalker(
//                         document.body,
//                         NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
//                         null,
//                         false
//                     );

//                     let node;
//                     while (node = walker.nextNode()) {
//                         if (node.nodeType === Node.ELEMENT_NODE &&
//                             (window.getComputedStyle(node).display === 'none' ||
//                                 node.classList.contains('similar-jobs') ||
//                                 node.classList.contains('job-alert'))) {
//                             continue;
//                         }

//                         if (node.nodeType === Node.ELEMENT_NODE) {
//                             const style = window.getComputedStyle(node);
//                             const isBold = style.fontWeight >= 600;
//                             const isHeading = /^H[1-6]$/.test(node.tagName) ||
//                                 node.tagName === 'B' ||
//                                 node.tagName === 'STRONG' ||
//                                 isBold;

//                             if (isHeading && node.textContent.trim()) {
//                                 const headingText = cleanText(node.textContent);

//                                 if (isRelevantHeading(headingText)) {
//                                     if (currentSection.heading || currentSection.content.length) {
//                                         sections.push({ ...currentSection });
//                                     }
//                                     currentSection = {
//                                         heading: headingText,
//                                         content: []
//                                     };
//                                 }
//                             }
//                         } else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
//                             const text = cleanText(node.textContent);
//                             if (text &&
//                                 !text.toLowerCase().includes('similar jobs') &&
//                                 !text.toLowerCase().includes('create alert') &&
//                                 !text.toLowerCase().includes('not available in your region')) {
//                                 currentSection.content.push(text);
//                             }
//                         }
//                     }

//                     if (currentSection.heading || currentSection.content.length) {
//                         sections.push(currentSection);
//                     }

//                     return sections;
//                 }

//                 // Extract basic job info
//                 const basicInfo = {
//                     title: document.querySelector('h1')?.textContent.trim() || '',
//                     location: document.querySelector('[data-cy="location"]')?.textContent.trim() || '',
//                     company: document.querySelector('[data-cy="company-name"]')?.textContent.trim() || ''
//                 };

//                 const jobSections = extractJobContent();

//                 return {
//                     basicInfo,
//                     sections: jobSections
//                 };
//             });

//             // Process content for AI
//             const contentForAI = jobContent.sections
//                 .map(section => `${section.heading}\n${section.content.join(' ')}`)
//                 .join('\n\n');

//             // Get AI-processed description
//             const aiProcessedDescription = await extractJobDescriptionWithAI(contentForAI);

//             return {
//                 basicInfo: jobContent.basicInfo,
//                 structuredContent: jobContent.sections,
//                 aiProcessedDescription,
//                 scrapedAt: new Date().toISOString(),
//                 success: true,
//                 url: url
//             };

//         } catch (error) {
//             console.error(`Error scraping ${url}:`, error.message);
//             return {
//                 basicInfo: {},
//                 structuredContent: [],
//                 aiProcessedDescription: '',
//                 scrapedAt: new Date().toISOString(),
//                 success: false,
//                 error: error.message,
//                 url: url
//             };
//         } finally {
//             await page.close();
//         }
//     });
// }

// // Rest of the code (ScrapingQueue, scrapeJobDetails, etc.) remains the same...
// class ScrapingQueue {
//     constructor(maxConcurrent = 2) {
//         this.queue = [];
//         this.running = 0;
//         this.maxConcurrent = maxConcurrent;
//     }

//     async add(fn) {
//         if (this.running >= this.maxConcurrent) {
//             await new Promise(resolve => this.queue.push(resolve));
//         }
//         this.running++;
//         try {
//             return await fn();
//         } finally {
//             this.running--;
//             if (this.queue.length > 0) {
//                 const next = this.queue.shift();
//                 next();
//             }
//         }
//     }
// }

// module.exports = {
//     router,
//     fetchAdzunaJobListings,
//     isValidLinkedInUrl,  // Exported for testing
//     extractCompanyFromLinkedInURL  // Exported for testing
// };



// require('dotenv').config();
// const axios = require('axios');
// const express = require('express');
// const puppeteer = require('puppeteer-extra');
// const StealthPlugin = require('puppeteer-extra-plugin-stealth');
// const router = express.Router();

// const { OpenAI } = require('openai');
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// // Load Adzuna credentials securely from environment variables
// const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
// const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;

// // Puppeteer Stealth Plugin to bypass bot detection
// puppeteer.use(StealthPlugin());

// // Status code definitions for better error handling
// const STATUS_CODES = {
//     SUCCESS: { code: "1", httpStatus: 200, message: "Operation completed successfully" },
//     VALIDATION_ERROR: { code: "0", httpStatus: 400, message: "Validation error occurred" },
//     SERVER_ERROR: { code: "-1", httpStatus: 500, message: "Internal server error occurred" },
//     NOT_FOUND: { code: "0", httpStatus: 404, message: "Resource not found" }
// };

// // Retry helper for failed operations
// async function retry(fn, retries = 3, delay = 2000) {
//     for (let attempt = 1; attempt <= retries; attempt++) {
//         try {
//             return await fn();
//         } catch (error) {
//             console.error(`Attempt ${attempt} failed: ${error.message}`);
//             if (attempt < retries) await new Promise(res => setTimeout(res, delay));
//         }
//     }
//     throw new Error(`All ${retries} attempts failed.`);
// }

// // OpenAI Job Description Formatting
// async function extractJobDescriptionWithAI(content) {
//     try {
//         if (!content || content.trim().length < 50) {
//             console.log('Content too short or empty:', content);
//             return content || '';
//         }

//         console.log('Processing job description with OpenAI...');
//         const messages = [
//             {
//                 role: 'system',
//                 content: `You are a helpful assistant that extracts and formats job descriptions.
//                 Extract all available information and organize it into sections (e.g., Job Title, Key Responsibilities, Required Qualifications, etc.).
//                 Preserve the original content and use proper formatting.`
//             },
//             { role: 'user', content: `Extract and format the following job description:\n\n${content}` }
//         ];

//         const response = await openai.chat.completions.create({
//             model: 'gpt-3.5-turbo',
//             messages,
//             max_tokens: 3000,
//             temperature: 0.1,
//             top_p: 1
//         });

//         return response?.choices?.[0]?.message?.content.trim() || content;
//     } catch (error) {
//         console.error('AI Processing Error:', error.message);
//         return content || '';
//     }
// }

// // JobScraper class with Puppeteer Stealth Mode
// class JobScraper {
//     constructor() {
//         this.browserInstance = null;
//     }

//     async initBrowser() {
//         if (!this.browserInstance) {
//             console.log('Initializing new browser instance...');
//             this.browserInstance = await puppeteer.launch({
//                 headless: true,
//                 args: [
//                     '--no-sandbox',
//                     '--disable-setuid-sandbox',
//                     '--disable-blink-features=AutomationControlled'
//                 ]
//             });
//         }
//         return this.browserInstance;
//     }

//     async scrapeJobDetails(url) {
//         const browser = await this.initBrowser();
//         const page = await browser.newPage();

//         try {
//             await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
//             await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

//             console.log(`Navigating to URL: ${url}`);
//             await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

//             await page.waitForSelector('body', { timeout: 30000 });

//             // Scroll to ensure content loads
//             await page.evaluate(async () => {
//                 await new Promise(resolve => {
//                     let totalHeight = 0;
//                     let distance = 100;
//                     let timer = setInterval(() => {
//                         let scrollHeight = document.body.scrollHeight;
//                         window.scrollBy(0, distance);
//                         totalHeight += distance;

//                         if (totalHeight >= scrollHeight) {
//                             clearInterval(timer);
//                             resolve();
//                         }
//                     }, 200);
//                 });
//             });

//             // Extract <p> and <b> tag data
//             const pTags = await page.evaluate(() => {
//                 return Array.from(document.querySelectorAll('p')).map(p => p.innerText.trim()).filter(text => text.length > 0);
//             });

//             const bTags = await page.evaluate(() => {
//                 return Array.from(document.querySelectorAll('b[class]')).map(b => b.innerText.trim()).filter(text => text.length > 0);
//             });

//             // AI processing
//             const formattedDescription = await extractJobDescriptionWithAI(pTags.join('\n'));

//             const extractedData = {
//                 paragraphs: pTags,
//                 bold_text: bTags,
//                 processed: formattedDescription
//             };

//             console.log(`Extracted data for ${url}:`, extractedData);

//             return {
//                 success: true,
//                 description: extractedData,
//                 metadata: { url, scrapedAt: new Date().toISOString() }
//             };

//         } catch (error) {
//             console.error(`Scraping error for ${url}:`, error.message);
//             return { success: false, error: error.message, metadata: { url } };
//         } finally {
//             await page.close();
//         }
//     }
// }

// // Fetch job listings from Adzuna
// const fetchJobListings = async (body) => {
//     try {
//         console.log('Fetching job listings with params:', body);
//         const { linkedinUrl } = body;

//         if (!linkedinUrl) {
//             return { ...STATUS_CODES.VALIDATION_ERROR, message: "LinkedIn URL is required", data: [] };
//         }

//         const targetCompany = linkedinUrl.split('/').pop().replace(/[-_]+/g, ' ').trim();
//         if (!targetCompany) {
//             return { ...STATUS_CODES.VALIDATION_ERROR, message: "Invalid LinkedIn URL", data: [] };
//         }

//         const scraper = new JobScraper();
//         const baseUrl = 'https://api.adzuna.com/v1/api/jobs/us/search/1';
//         const params = {
//             app_id: ADZUNA_APP_ID,
//             app_key: ADZUNA_APP_KEY,
//             results_per_page: 5,
//             company: targetCompany
//         };

//         console.log('Querying Adzuna API...');
//         const response = await axios.get(baseUrl, { params });
//         const jobListings = response.data.results;

//         if (!jobListings?.length) {
//             return { ...STATUS_CODES.NOT_FOUND, message: `No job listings found for ${targetCompany}`, data: [] };
//         }

//         console.log(`Found ${jobListings.length} job listings, processing details...`);
//         const enhancedJobListings = await Promise.all(
//             jobListings.map(async (job) => {
//                 const scrapedDetails = await retry(() => scraper.scrapeJobDetails(job.redirect_url));

//                 return {
//                     title: job.title,
//                     company: job.company?.display_name || 'Not specified',
//                     location: job.location?.display_name || 'Not specified',
//                     description: scrapedDetails.description,
//                     application_url: job.redirect_url,
//                     posted_date: job.created,
//                     scraping_metadata: { platform: 'adzuna', success: scrapedDetails.success, scraped_at: scrapedDetails.metadata.scrapedAt }
//                 };
//             })
//         );

//         return { ...STATUS_CODES.SUCCESS, message: "Successfully fetched and processed job listings", data: enhancedJobListings };

//     } catch (error) {
//         console.error('Error in fetchJobListings:', error.message);
//         return { ...STATUS_CODES.SERVER_ERROR, message: `Error: ${error.message}`, data: [] };
//     }
// };

// // Route handler
// router.post('/fetch-job-signals', async (req, res) => {
//     const response = await fetchJobListings(req.body);
//     res.status(response.httpStatus).json(response);
// });

// module.exports = { router, fetchJobListings, JobScraper, STATUS_CODES };







// //Scraping Functionality Removed from the code

require('dotenv').config();
const axios = require('axios');
const express = require('express');
const router = express.Router();

// Load Adzuna credentials securely from environment variables
const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;

// Status code definitions for better error handling
const STATUS_CODES = {
    SUCCESS: { code: "1", httpStatus: 200, message: "Job listings retrieved successfully" },
    VALIDATION_ERROR: { code: "0", httpStatus: 400, message: "Invalid request parameters" },
    SERVER_ERROR: { code: "0", httpStatus: 500, message: "Internal server error occurred" },
    NOT_FOUND: { code: "-1", httpStatus: 404, message: "No job listings found for the given criteria" },
    SERVICE_UNAVAILABLE: { code: "0", httpStatus: 503, message: "Service is currently unavailable. Please try again later." },
    UNAUTHORIZED: { code: "0", httpStatus: 401, message: "Invalid Adzuna API credentials" },
    RATE_LIMIT: { code: "0", httpStatus: 429, message: "Rate limit exceeded, please try again later" }
};

// Validate LinkedIn URL format
const isValidLinkedInUrl = (url) => {
    console.log(`Validating LinkedIn URL: ${url}`);
    
    if (!url || url === 'null' || url === 'N/A' || url === 'undefined') {
        console.log('LinkedIn URL validation failed: Invalid or empty URL');
        return false;
    }
    
    const linkedinUrlRegex = /^https?:\/\/([\w]+\.)?linkedin\.com\/company\/[\w\-]+\/?$/i;
    const isValid = linkedinUrlRegex.test(url);
    console.log(`LinkedIn URL validation result: ${isValid}`);
    return isValid;
};

const extractCompanyNameFromLinkedInUrl = (linkedinUrl) => {
    console.log(`Attempting to extract company name from LinkedIn URL: ${linkedinUrl}`);
    
    try {
        if (!isValidLinkedInUrl(linkedinUrl)) {
            console.warn('Invalid LinkedIn URL format:', linkedinUrl);
            return null;
        }

        const urlPatterns = [
            /linkedin\.com\/company\/([^\/\?]+)/i,
            /linkedin\.com\/school\/([^\/\?]+)/i,
            /linkedin\.com\/organization\/([^\/\?]+)/i
        ];

        console.log('Applying URL patterns to extract company name');
        
        for (const pattern of urlPatterns) {
            const match = linkedinUrl.match(pattern);
            if (match && match[1]) {
                const companyName = match[1]
                    .replace(/-/g, ' ')
                    .replace(/\+/g, ' ')
                    .replace(/%20/g, ' ')
                    .trim();

                if (companyName.length < 2) {
                    console.warn('Extracted company name too short:', companyName);
                    return null;
                }

                console.log('Successfully extracted company name:', companyName);
                return companyName;
            }
        }

        console.warn('No company name pattern matched in URL:', linkedinUrl);
        return null;
    } catch (error) {
        console.error('Error extracting company name from LinkedIn URL:', error);
        return null;
    }
};

// Reusable function to fetch job listings from Adzuna
const fetchJobListings = async (companyName) => {
    console.log(`Initiating job listings fetch for company: ${companyName}`);
    
    if (!companyName) {
        console.warn('Job listing fetch failed: Company name is required');
        return { ...STATUS_CODES.VALIDATION_ERROR, message: "Company name is required for job search" };
    }

    const baseUrl = 'https://api.adzuna.com/v1/api/jobs/us/search/1';
    const params = {
        app_id: ADZUNA_APP_ID,
        app_key: ADZUNA_APP_KEY,
        results_per_page: 8,
        what: companyName
    };

    try {
        console.log('Sending request to Adzuna API...');
        const response = await axios.get(baseUrl, { params });
        console.log(`Received response from Adzuna API with status: ${response.status}`);

        if (response.status === 401) return { ...STATUS_CODES.UNAUTHORIZED };
        if (response.status === 429) return { ...STATUS_CODES.RATE_LIMIT };
        if (response.status === 503) return { ...STATUS_CODES.SERVICE_UNAVAILABLE };

        const jobResults = response.data.results || [];
        if (jobResults.length === 0) {
            return { ...STATUS_CODES.NOT_FOUND, message: `No job listings found for company: ${companyName}` };
        }

        const formattedResults = jobResults.map(job => ({
            title: job.title || "Title not available",
            company: job.company?.display_name || "Company name not available",
            location: job.location?.display_name || "Location not available",
            salary: job.salary_min && job.salary_max ? `$${job.salary_min} - $${job.salary_max}` : "Salary not provided",
            description: job.description || "Description not available",
            url: job.redirect_url || "No application link available",
            posted_date: job.created || "Posting date not available"
        }));

        return {
            ...STATUS_CODES.SUCCESS,
            data: formattedResults
        };

    } catch (error) {
        console.error('Error fetching job listings:', error.message);
        return { ...STATUS_CODES.SERVER_ERROR, message: `Unexpected error: ${error.message}` };
    }
};

// Main method that handles the entire job signals flow
const processJobSignals = async ({ linkedinUrl, companyName }) => {
    console.log('Starting job signals process:', {
        hasLinkedinUrl: !!linkedinUrl,
        hasCompanyName: !!companyName
    });

    try {
        // Input validation
        if (!linkedinUrl && !companyName) {
            console.warn('Process failed: Missing both LinkedIn URL and company name');
            return {
                ...STATUS_CODES.VALIDATION_ERROR,
                message: "Either LinkedIn URL or Company Name is required"
            };
        }

        let targetCompany = companyName;

        // Extract company name from LinkedIn URL if available
        if (linkedinUrl) {
            console.log('Attempting to extract company name from LinkedIn URL');
            const extractedCompanyName = extractCompanyNameFromLinkedInUrl(linkedinUrl);
            if (extractedCompanyName) {
                console.log(`Using extracted company name: ${extractedCompanyName}`);
                targetCompany = extractedCompanyName;
            } else {
                console.warn('Failed to extract company name from LinkedIn URL');
            }
        }

        // First attempt with extracted/provided company name
        console.log(`Initiating job listings fetch with company: ${targetCompany}`);
        let response = await fetchJobListings(targetCompany);

        // Fallback to provided company name if needed
        if (response.httpStatus === 404 && companyName !== targetCompany) {
            console.log(`First attempt failed, retrying with provided company name: ${companyName}`);
            response = await fetchJobListings(companyName);
        }

        console.log(`Process completed with status ${response.httpStatus}`);
        return response;

    } catch (error) {
        console.error('Process error:', {
            error: error.message,
            stack: error.stack,
            type: error.name
        });
        
        return {
            ...STATUS_CODES.SERVER_ERROR,
            message: "An unexpected error occurred, please try again later"
        };
    }
};

// API Route Handler using the main method
router.post('/fetch-jobssignals', async (req, res) => {
    const response = await processJobSignals(req.body);
    return res.status(response.httpStatus).json(response);
});

// Export the reusable methods & router
module.exports = {
    router,
    processJobSignals,  // Main method for external use
    fetchJobListings,
    extractCompanyNameFromLinkedInUrl,
    STATUS_CODES
};