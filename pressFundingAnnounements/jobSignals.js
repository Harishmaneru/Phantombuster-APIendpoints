// const axios = require('axios');
// const express = require('express');
// const router = express.Router();

// const ADZUNA_APP_ID = 'eb7bd0b4';
// const ADZUNA_APP_KEY = 'ece2b22a1999da408461f76e7e8560b4';

// router.post('/fetch-jobssignals', async (req, res) => {
//     console.log('Received request with body:', req.body);
//     const response = await fetchAdzunaJobListings(req.body);
//     res.status(200).send(response);
// });

// // Function to extract company name from LinkedIn URL
// const extractCompanyFromLinkedInURL = (linkedinUrl) => {
//     try {
//         if (!linkedinUrl) return null;

//         // Handle various LinkedIn URL formats
//         const urlPatterns = [
//             /linkedin\.com\/company\/([^\/\?]+)/i,    
//             /linkedin\.com\/school\/([^\/\?]+)/i,     
//             /linkedin\.com\/organization\/([^\/\?]+)/i  
//         ];

//         for (const pattern of urlPatterns) {
//             const match = linkedinUrl.match(pattern);
//             if (match && match[1]) {
//                 // Convert URL-friendly format back to company name
//                 const companyName = match[1]
//                     .replace(/-/g, ' ')           
//                     .replace(/\+/g, ' ')         
//                     .replace(/%20/g, ' ')         
//                     .trim();

//                 return companyName;
//             }
//         }

//         return null;
//     } catch (error) {
//         console.error('Error extracting company name from LinkedIn URL:', error);
//         return null;
//     }
// };

// const fetchAdzunaJobListings = async (body) => {
//     console.log('Processing Adzuna job request with body:', body);
//     const { companyName, linkedinUrl, jobType, location } = body;

//     // Try to get company name either directly or from LinkedIn URL
//     let targetCompany = companyName;
//     console.log('Company name:', targetCompany);
//     if (!targetCompany && linkedinUrl) {
//         targetCompany = extractCompanyFromLinkedInURL(linkedinUrl);
//         console.log('Extracted company name from LinkedIn URL:', targetCompany);
//     }

//     // Validate required parameters
//     if (!targetCompany && !jobType && !location) {
//         console.log('Missing required parameters');
//         return {
//             status: "-1",
//             message: "linkedinUrl is required.",
//             data: {}
//         };
//     }

//     const baseUrl = 'https://api.adzuna.com/v1/api/jobs';
//     const country = 'us';
//     const url = `${baseUrl}/${country}/search/1`;

//     // Building the query parameters
//     const params = {
//         app_id: ADZUNA_APP_ID,
//         app_key: ADZUNA_APP_KEY,
//         results_per_page: 5
//     };

//     if (targetCompany) params.company = targetCompany;
//     if (jobType) params.what = jobType;
//     if (location) params.where = location;

//     console.log('Sending request to Adzuna API with params:', params);

//     try {
//         const response = await axios.get(url, { params });
//         console.log('Received response from Adzuna API:', response.status, response.statusText);
//         console.log('Response data:', response.data);
//         const jobListings = response.data.results;

//         if (!jobListings || jobListings.length === 0) {
//             console.log('No job listings found for:', { targetCompany, jobType, location });
//             return {
//                 status: "0",
//                 message: `No job listings found for the given criteria`,
//                 data: []
//             };
//         }

//         const enhancedResponse = jobListings.map(job => ({
//             title: job.title,
//             company: job.company.display_name,
//             location: job.location.display_name,
//             description: job.description,
//             url: job.redirect_url,
//             postedDate: job.created,
//             salary: job.salary_min ? {
//                 min: job.salary_min,
//                 max: job.salary_max,
//                 currency: job.salary_is_predicted ? 'Estimated' : job.currency
//             } : null
//         }));

//         return {
//             status: "1",
//             message: "Successfully fetched job listings",
//             data: enhancedResponse
//         };

//     } catch (error) {
//         console.error('Error fetching job listings from Adzuna:', error.message);

//         if (error.response) {
//             console.error('API Error Status:', error.response.status);
//             console.error('API Error Data:', error.response.data);

//             return {
//                 status: "-1",
//                 message: `Job search failed with status ${error.response.status}. Please try again later`,
//                 data: {}
//             };
//         } else if (error.request) {
//             return {
//                 status: "-1",
//                 message: "No response received from the job search service",
//                 data: {}
//             };
//         } else {
//             return {
//                 status: "-1",
//                 message: `Error fetching job listings: ${error.message}`,
//                 data: {}
//             };
//         }
//     }
// };

// module.exports = {
//     router,
//     fetchAdzunaJobListings
// };

const axios = require('axios');
const express = require('express');
const puppeteer = require('puppeteer');
const router = express.Router();

const ADZUNA_APP_ID = 'eb7bd0b4';
const ADZUNA_APP_KEY = 'ece2b22a1999da408461f76e7e8560b4';

const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


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



async function scrapeJobDetails(url, queue) {
    return queue.add(async () => {
        const browser = await getBrowser();
        const page = await browser.newPage();

        try {
            await page.setDefaultNavigationTimeout(30000);
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

            await page.goto(url, { waitUntil: 'networkidle0' });

            const rawContent = await page.evaluate(() => {
                function cleanText(text) {
                    return text.replace(/\s+/g, ' ').trim();
                }

                function processContent() {
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
                            window.getComputedStyle(node).display === 'none') {
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
                                if (currentSection.heading || currentSection.content.length) {
                                    sections.push({ ...currentSection });
                                }
                                currentSection = {
                                    heading: cleanText(node.textContent),
                                    content: []
                                };
                            }
                        } else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                            const text = cleanText(node.textContent);
                            if (text && !currentSection.content.includes(text)) {
                                currentSection.content.push(text);
                            }
                        }
                    }

                    if (currentSection.heading || currentSection.content.length) {
                        sections.push(currentSection);
                    }

                    return sections.map(section => ({
                        heading: section.heading,
                        content: section.content.join(' ')
                    }));
                }

                return processContent();
            });

            // Filter for job-related sections
            const jobRelatedKeywords = [
                'job description', 'responsibilities', 'qualifications', 'requirements', 'benefits'
            ];

            const filteredContent = rawContent.filter(section =>
                jobRelatedKeywords.some(keyword =>
                    section.heading.toLowerCase().includes(keyword) ||
                    section.content.toLowerCase().includes(keyword)
                ) &&
                !section.heading.toLowerCase().includes('similar') && // Exclude "similar jobs"
                !section.heading.toLowerCase().includes('alert') &&   // Exclude "alerts"
                !section.content.toLowerCase().includes('not available') // Exclude regional restrictions
            );

            const formattedContent = {
                mainContent: '',
                structuredContent: filteredContent.map(section => ({
                    heading: section.heading,
                    content: section.content
                }))
            };

            formattedContent.mainContent = filteredContent.map(section =>
                `**${section.heading}**\n${section.content}\n\n`
            ).join('');

            return {
                ...formattedContent,
                scrapedAt: new Date().toISOString(),
                success: true,
                url: url
            };

        } catch (error) {
            console.error(`Error scraping ${url}:`, error.message);
            return {
                mainContent: 'Failed to load detailed description',
                structuredContent: [],
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



const extractCompanyFromLinkedInURL = (linkedinUrl) => {
    try {
        if (!linkedinUrl) return null;

        // Handle various LinkedIn URL formats
        const urlPatterns = [
            /linkedin\.com\/company\/([^\/\?]+)/i,
            /linkedin\.com\/school\/([^\/\?]+)/i,
            /linkedin\.com\/organization\/([^\/\?]+)/i
        ];

        for (const pattern of urlPatterns) {
            const match = linkedinUrl.match(pattern);
            if (match && match[1]) {
                // Convert URL-friendly format back to company name
                const companyName = match[1]
                    .replace(/-/g, ' ')
                    .replace(/\+/g, ' ')
                    .replace(/%20/g, ' ')
                    .trim();

                return companyName;
            }
        }

        return null;
    } catch (error) {
        console.error('Error extracting company name from LinkedIn URL:', error);
        return null;
    }
};

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



const fetchAdzunaJobListings = async (body) => {
    const { companyName, linkedinUrl, jobType, location } = body;

    let targetCompany = companyName || extractCompanyFromLinkedInURL(linkedinUrl);
    const scrapingQueue = new ScrapingQueue(2);

    try {
        const baseUrl = 'https://api.adzuna.com/v1/api/jobs/us/search/1';
        const params = {
            app_id: ADZUNA_APP_ID,
            app_key: ADZUNA_APP_KEY,
            results_per_page: 5,
            ...(targetCompany && { company: targetCompany }),
            ...(jobType && { what: jobType }),
            ...(location && { where: location })
        };

        const response = await axios.get(baseUrl, { params });
        const jobListings = response.data.results;

        if (!jobListings?.length) {
            return {
                status: "0",
                message: "No job listings found",
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
                        currency: 'USD', // Default currency
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


// Route handler remains the same
router.post('/fetch-jobssignals', async (req, res) => {
    console.log('Received request with body:', req.body);
    const response = await fetchAdzunaJobListings(req.body);
    res.status(200).send(response);
});

module.exports = {
    router,
    fetchAdzunaJobListings
};