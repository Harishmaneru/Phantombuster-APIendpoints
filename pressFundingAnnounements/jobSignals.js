const axios = require('axios');
const express = require('express');
const puppeteer = require('puppeteer');
const router = express.Router();

const ADZUNA_APP_ID = 'eb7bd0b4';
const ADZUNA_APP_KEY = 'ece2b22a1999da408461f76e7e8560b4';

const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Validate LinkedIn URL format
const isValidLinkedInUrl = (url) => {
    if (!url || url === 'null' || url === 'N/A' || url === 'undefined') {
        return false;
    }
    const linkedinUrlRegex = /^https?:\/\/([\w]+\.)?linkedin\.com\/company\/[\w\-]+\/?$/i;
    return linkedinUrlRegex.test(url);
};


async function extractJobDescriptionWithAI(content) {
    try {
        console.log('Processing job description with OpenAI...');

        const messages = [
            {
                role: 'system',
                content: `You are a helpful assistant that extracts detailed job descriptions.
                Your goal is to extract and organize the job description in the following sections if present:
                - Job Description
                - Responsibilities
                - Qualifications
                - Benefits
                - Working Model
                Preserve all relevant details and avoid summarizing.`
            },
            {
                role: 'user',
                content: `Extract the full job details from the following content. Include all available information and organize it into logical sections:\n\n${content}`
            }
        ];

        const response = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages,
            max_tokens: 2000,
            temperature: 0.5,
            top_p: 1
        });

        // Validate and return the full response content
        if (response && response.choices && response.choices[0] && response.choices[0].message) {
            return response.choices[0].message.content.trim();
        } else {
            console.error('Unexpected API Response Structure:', JSON.stringify(response, null, 2));
            throw new Error('Invalid API response structure. Unable to extract job details.');
        }
    } catch (error) {
        console.error('Error in extractJobDescriptionWithAI:', error);
        if (error.response) {
            console.error('API Error Response:', JSON.stringify(error.response.data, null, 2));
        }
        return 'Unable to extract job details.';
    }
}


// Enhanced company name extraction with validation
const extractCompanyFromLinkedInURL = (linkedinUrl) => {
    try {
        if (!isValidLinkedInUrl(linkedinUrl)) {
            console.log('Invalid LinkedIn URL format:', linkedinUrl);
            return null;
        }

        const urlPatterns = [
            /linkedin\.com\/company\/([^\/\?]+)/i,
            /linkedin\.com\/school\/([^\/\?]+)/i,
            /linkedin\.com\/organization\/([^\/\?]+)/i
        ];

        for (const pattern of urlPatterns) {
            const match = linkedinUrl.match(pattern);
            if (match && match[1]) {
                const companyName = match[1]
                    .replace(/-/g, ' ')
                    .replace(/\+/g, ' ')
                    .replace(/%20/g, ' ')
                    .trim();

                // Validate extracted company name
                if (companyName.length < 2) {
                    console.log('Extracted company name too short:', companyName);
                    return null;
                }

                console.log('Successfully extracted company name:', companyName);
                return companyName;
            }
        }

        console.log('No company name pattern matched in URL:', linkedinUrl);
        return null;
    } catch (error) {
        console.error('Error extracting company name from LinkedIn URL:', error);
        return null;
    }
};

// Main function to fetch job listings with enhanced validation
const fetchAdzunaJobListings = async (body) => {
    try {
        const { linkedinUrl } = body;

        // Validate LinkedIn URL
        if (!linkedinUrl) {
            return {
                status: "0",
                message: "LinkedIn URL is required",
                data: []
            };
        }

        // Extract company name
        const targetCompany = extractCompanyFromLinkedInURL(linkedinUrl);
        console.log('Extracted company name:', targetCompany);

        if (!targetCompany) {
            return {
                status: "0",
                message: "Invalid LinkedIn URL or unable to extract company name",
                data: []
            };
        }

        const scrapingQueue = new ScrapingQueue(2);

        const baseUrl = 'https://api.adzuna.com/v1/api/jobs/us/search/1';
        const params = {
            app_id: ADZUNA_APP_ID,
            app_key: ADZUNA_APP_KEY,
            results_per_page: 5,
            company: targetCompany
        };

        console.log('Searching for jobs with params:', params);
        const response = await axios.get(baseUrl, { params });
        const jobListings = response.data.results;

        if (!jobListings?.length) {
            return {
                status: "0",
                message: `No job listings found for company: ${targetCompany}`,
                data: []
            };
        }

        const enhancedJobListings = await Promise.all(
            jobListings.map(async (job) => {
                const scrapedDetails = await scrapeJobDetails(job.redirect_url, scrapingQueue);

                return {
                    title: job.title,
                    company: job.company?.display_name || 'Not specified',
                    location: job.location?.display_name || 'Not specified',
                    contract: {
                        type: job.contract_type || 'Not specified',
                        time: job.contract_time || 'Not specified'
                    },
                    salary: job.salary_min && job.salary_max ? {
                        min: job.salary_min,
                        max: job.salary_max,
                        currency: 'USD',
                        is_predicted: job.salary_is_predicted === "1"
                    } : null,
                    description: {
                        original: job.description,
                        "Full Job Description": scrapedDetails.aiProcessedDescription
                    },
                    url: job.redirect_url,
                    postedDate: job.created
                };
            })
        );

        return {
            status: "1",
            message: "Successfully fetched job listings",
            data: enhancedJobListings
        };

    } catch (error) {
        console.error('Error fetching jobs:', error);
        return {
            status: "-1",
            message: `Error: ${error.message}`,
            data: []
        };
    }
};

// Enhanced route handler with input validation
router.post('/fetch-jobssignals', async (req, res) => {
    try {
        console.log('Received request with body:', req.body);

        // Basic request body validation
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({
                status: "0",
                message: "Invalid request body",
                data: []
            });
        }

        const response = await fetchAdzunaJobListings(req.body);

        // Send appropriate HTTP status based on the operation status
        const httpStatus = response.status === "1" ? 200 :
            response.status === "0" ? 400 : 500;

        res.status(httpStatus).json(response);

    } catch (error) {
        console.error('Route handler error:', error);
        res.status(500).json({
            status: "-1",
            message: "Internal server error",
            data: []
        });
    }
});
let browserInstance = null;
async function getBrowser() {
    if (!browserInstance) {
        browserInstance = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
    }
    return browserInstance;
}
async function scrapeJobDetails(url, queue) {
    return queue.add(async () => {
        console.log('Scraping details from:', url);
        const browser = await getBrowser();
        const page = await browser.newPage();

        try {
            await page.setDefaultNavigationTimeout(30000);
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

            await page.goto(url, { waitUntil: 'networkidle0' });

            const jobContent = await page.evaluate(() => {
                function cleanText(text) {
                    return text.replace(/\s+/g, ' ').trim();
                }

                // Define relevant job sections
                const relevantSections = [
                    'job description',
                    'responsibilities',
                    'requirements',
                    'qualifications',
                    'skills',
                    'experience',
                    'about the role',
                    'about this position',
                    'what you\'ll do',
                    'what we\'re looking for',
                    'benefits',
                    'perks',
                    'compensation'
                ];

                function isRelevantHeading(text) {
                    return relevantSections.some(section =>
                        text.toLowerCase().includes(section)
                    );
                }

                function extractJobContent() {
                    const sections = [];
                    let currentSection = {
                        heading: '',
                        content: []
                    };

                    const walker = document.createTreeWalker(
                        document.body,
                        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
                        null,
                        false
                    );

                    let node;
                    while (node = walker.nextNode()) {
                        if (node.nodeType === Node.ELEMENT_NODE &&
                            (window.getComputedStyle(node).display === 'none' ||
                                node.classList.contains('similar-jobs') ||
                                node.classList.contains('job-alert'))) {
                            continue;
                        }

                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const style = window.getComputedStyle(node);
                            const isBold = style.fontWeight >= 600;
                            const isHeading = /^H[1-6]$/.test(node.tagName) ||
                                node.tagName === 'B' ||
                                node.tagName === 'STRONG' ||
                                isBold;

                            if (isHeading && node.textContent.trim()) {
                                const headingText = cleanText(node.textContent);

                                if (isRelevantHeading(headingText)) {
                                    if (currentSection.heading || currentSection.content.length) {
                                        sections.push({ ...currentSection });
                                    }
                                    currentSection = {
                                        heading: headingText,
                                        content: []
                                    };
                                }
                            }
                        } else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                            const text = cleanText(node.textContent);
                            if (text &&
                                !text.toLowerCase().includes('similar jobs') &&
                                !text.toLowerCase().includes('create alert') &&
                                !text.toLowerCase().includes('not available in your region')) {
                                currentSection.content.push(text);
                            }
                        }
                    }

                    if (currentSection.heading || currentSection.content.length) {
                        sections.push(currentSection);
                    }

                    return sections;
                }

                // Extract basic job info
                const basicInfo = {
                    title: document.querySelector('h1')?.textContent.trim() || '',
                    location: document.querySelector('[data-cy="location"]')?.textContent.trim() || '',
                    company: document.querySelector('[data-cy="company-name"]')?.textContent.trim() || ''
                };

                const jobSections = extractJobContent();

                return {
                    basicInfo,
                    sections: jobSections
                };
            });

            // Process content for AI
            const contentForAI = jobContent.sections
                .map(section => `${section.heading}\n${section.content.join(' ')}`)
                .join('\n\n');

            // Get AI-processed description
            const aiProcessedDescription = await extractJobDescriptionWithAI(contentForAI);

            return {
                basicInfo: jobContent.basicInfo,
                structuredContent: jobContent.sections,
                aiProcessedDescription,
                scrapedAt: new Date().toISOString(),
                success: true,
                url: url
            };

        } catch (error) {
            console.error(`Error scraping ${url}:`, error.message);
            return {
                basicInfo: {},
                structuredContent: [],
                aiProcessedDescription: '',
                scrapedAt: new Date().toISOString(),
                success: false,
                error: error.message,
                url: url
            };
        } finally {
            await page.close();
        }
    });
}

// Rest of the code (ScrapingQueue, scrapeJobDetails, etc.) remains the same...
class ScrapingQueue {
    constructor(maxConcurrent = 2) {
        this.queue = [];
        this.running = 0;
        this.maxConcurrent = maxConcurrent;
    }

    async add(fn) {
        if (this.running >= this.maxConcurrent) {
            await new Promise(resolve => this.queue.push(resolve));
        }
        this.running++;
        try {
            return await fn();
        } finally {
            this.running--;
            if (this.queue.length > 0) {
                const next = this.queue.shift();
                next();
            }
        }
    }
}

module.exports = {
    router,
    fetchAdzunaJobListings,
    isValidLinkedInUrl,  // Exported for testing
    extractCompanyFromLinkedInURL  // Exported for testing
};


// const axios = require('axios');
// const express = require('express');
// const puppeteer = require('puppeteer');
// const router = express.Router();

// const ADZUNA_APP_ID = 'eb7bd0b4';
// const ADZUNA_APP_KEY = 'ece2b22a1999da408461f76e7e8560b4';

// const { OpenAI } = require('openai');
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// // API Queue Manager Implementation
// class ApiQueueManager {
//     constructor() {
//         this.isProcessing = false;
//     }

//     async processRequest(request) {
//         if (this.isProcessing) {
//             console.log('Previous request is still processing. Waiting...');
//             return new Promise((resolve) => {
//                 setTimeout(async () => {
//                     resolve(await this.processRequest(request));
//                 }, 1000); // Wait 1 second before retrying
//             });
//         }

//         try {
//             this.isProcessing = true;
//             console.log('Processing new request...');
//             const result = await fetchAdzunaJobListings(request);
//             return result;
//         } finally {
//             this.isProcessing = false;
//             console.log('Request processing completed.');
//         }
//     }
// }

// // Create single instance of queue manager
// const queueManager = new ApiQueueManager();

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

// const fetchAdzunaJobListings = async (body) => {
//     try {
//         const { linkedinUrl } = body;

//         if (!linkedinUrl) {
//             return {
//                 status: "0",
//                 message: "LinkedIn URL is required",
//                 data: []
//             };
//         }

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

// // Modified route handler with queue management
// router.post('/fetch-jobssignals', async (req, res) => {
//     try {
//         console.log('Received request with body:', req.body);

//         if (!req.body || typeof req.body !== 'object') {
//             return res.status(400).json({
//                 status: "0",
//                 message: "Invalid request body",
//                 data: []
//             });
//         }

//         // Process request through queue manager
//         const response = await queueManager.processRequest(req.body);

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

//             const contentForAI = jobContent.sections
//                 .map(section => `${section.heading}\n${section.content.join(' ')}`)
//                 .join('\n\n');

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
//     isValidLinkedInUrl,
//     extractCompanyFromLinkedInURL,
//     queueManager  // Exported for testing
// };