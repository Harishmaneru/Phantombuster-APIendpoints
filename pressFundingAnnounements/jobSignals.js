

require('dotenv').config();
const axios = require('axios');
const express = require('express');
const puppeteer = require('puppeteer');
const router = express.Router();

const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Load Adzuna credentials securely from environment variables
const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;

// Status code definitions for better error handling
const STATUS_CODES = {
    SUCCESS: {
        code: "1",
        message: "Job listings retrieved successfully"
    },
    NOT_FOUND: {
        code: "0",
        message: "No job listings found for provided company"
    },
    SERVER_ERROR: {
        code: "-1",
        message: "An error occurred while processing your request"
    }
};

// Validate LinkedIn URL format
const isValidLinkedInUrl = (url) => {
    console.log(`Validating LinkedIn URL: ${url}`);

    if (!url || typeof url !== 'string' || url.trim() === '') {
        console.log('Invalid URL: Empty or non-string input');
        return false;
    }

    try {
        const parsedUrl = new URL(url);
        const validPaths = [
            '/company/',
            '/school/',
            '/organization/'
        ];

        const isValid = validPaths.some(path => parsedUrl.pathname.startsWith(path));
        console.log(`LinkedIn URL validation result: ${isValid}`);
        return isValid;
    } catch (error) {
        console.log('Invalid URL format:', error.message);
        return false;
    }
};

async function extractJobDescriptionWithAI(content) {
    try {
        console.log('Starting AI processing for job description');
        console.log('Input content length for extractJobDescriptionWithAI:', content.length);
        if (content.length > 10000) {
            console.warn('Content exceeds 10k characters');
        }


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

const extractCompanyNameFromLinkedInUrl = (linkedinUrl) => {
    console.log(`Attempting to extract company name from LinkedIn URL: ${linkedinUrl}`);

    if (!isValidLinkedInUrl(linkedinUrl)) return null;

    try {
        const parsedUrl = new URL(linkedinUrl);
        const pathParts = parsedUrl.pathname.split('/').filter(p => p);

        if (pathParts.length < 2) return null;

        const companySlug = pathParts[1];
        console.log('Raw company slug:', companySlug);

        const companyName = companySlug
            .replace(/-/g, ' ')
            .replace(/[^a-zA-Z0-9 ]/g, '')
            .trim();

        console.log('Processed company name:', companyName);
        return companyName || null;

    } catch (error) {
        console.error('URL parsing error:', error);
        return null;
    }
};

// Helper function to normalize company names for comparison
const normalizeCompanyName = (name) => {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '') // Remove special characters and spaces
        .trim();
};

// Helper function to check if company names match
const isCompanyMatch = (jobCompany, searchCompany) => {
    const normalizedJobCompany = normalizeCompanyName(jobCompany);
    const normalizedSearchCompany = normalizeCompanyName(searchCompany);

    // Check if one contains the other or vice versa
    return normalizedJobCompany.includes(normalizedSearchCompany) ||
        normalizedSearchCompany.includes(normalizedJobCompany);
};

// Reusable function to fetch job listings from Adzuna
const fetchJobListings = async (companyName) => {
    console.log(`Initiating job listings fetch for company: ${companyName}`);


    if (!companyName || companyName.trim().length < 2) {
        console.error('Invalid company name:', companyName);
        return STATUS_CODES.SERVER_ERROR;
    }

    const baseUrl = 'https://api.adzuna.com/v1/api/jobs/us/search/1';
    const params = {
        app_id: ADZUNA_APP_ID,
        app_key: ADZUNA_APP_KEY,
        results_per_page: 6,
        what: companyName
    };

    try {
        console.log('Sending request to Adzuna API...');
        const response = await axios.get(baseUrl, { params });
        // console.log('Adzuna API Response:', response)
        console.log('Adzuna API Response:', {
            status: response.status,
            statusText: response.statusText
        });

        // Handle the successful response
        const jobResults = response.data?.results || [];
        console.log(`Retrieved ${jobResults.length} job results`);

        // Filter jobs by company name match
        const filteredJobs = jobResults.filter(job =>
            isCompanyMatch(job.company?.display_name || "", companyName)
        );
        console.log(`Filtered to ${filteredJobs.length} matching jobs`);

        if (filteredJobs.length === 0) {
            console.log('No matching jobs found after filtering');
            return STATUS_CODES.NOT_FOUND;
        }

        // Process filtered jobs through AI
        const processedResults = await Promise.all(filteredJobs.map(async job => {
            const aiProcessedDescription = await extractJobDescriptionWithAI(job.description || "");

            return {
                title: job.title || "Title not available",
                company: job.company?.display_name || "Company name not available",
                location: job.location?.display_name || "Location not available",
                salary: job.salary_min && job.salary_max ? `$${job.salary_min} - $${job.salary_max}` : "Salary not provided",
                description: job.description || "Description not available",
                // FullJobDetails: aiProcessedDescription,
                url: job.redirect_url || "No application link available",
                posted_date: job.created || "Posting date not available"
            };
        }));

        // Return success with data
        return {
            ...STATUS_CODES.SUCCESS,
            data: processedResults
        };

    } catch (error) {
        // Enhanced error logging
        console.error('Error in fetchJobListings:', {
            message: error.message,
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data
        });

        // For all error cases, return SERVER_ERROR
        return STATUS_CODES.SERVER_ERROR;
    }
};

// Main method that handles the entire job signals flow

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
const scrapingQueue = new ScrapingQueue(2);


function cleanJobContent(content) {
    // Define section-specific content to keep
    const sectionFilters = {
        'Preferred Qualifications': (text) => {
            const validPreferredQuals = [
                'Master\'s degree',
                'Experience working',
                'Experience in',
                'Experience with',
                'Active US Government'
            ];
            return validPreferredQuals.some(qual => text.startsWith(qual));
        },
        'Benefits': (text) => {
            const validBenefits = [
                'We offer',
                'Annual Salary Range',
                '*Salary range',
                'This role is available'
            ];
            return validBenefits.some(benefit => text.startsWith(benefit));
        }
    };

    // Add more phrases to exclude
    const excludePhrases = [
        'Strategic Content Solutions Manager',
        'Graphics Driver',
        'Facebook is hiring',
        'Business Development',
        'Account Manager',
        'Government',
        'Virtual Assistant',
        'Amazon',
        'Work From Home',
        'Remote',
        'Online',
        'Part Time',
        'Full Time',
        'Seasonal',
        'jobs',
        'Top',
        'Adzuna',
        '$',
        'Washington',
        'Olympia'
    ];

    // Clean the structuredContent
    if (content.structuredContent) {
        content.structuredContent = content.structuredContent
            .filter(section => {
                // Skip sections without heading
                if (!section.heading) return false;

                // Clean content array based on section-specific rules
                section.content = section.content
                    .filter(text => {
                        // Apply section-specific filters if they exist
                        if (sectionFilters[section.heading]) {
                            return sectionFilters[section.heading](text);
                        }

                        // Remove empty or short strings
                        if (!text || text.length < 5) return false;
                        
                        // Remove content with excluded phrases
                        if (excludePhrases.some(phrase => 
                            text.toLowerCase().includes(phrase.toLowerCase()))) {
                            return false;
                        }

                        // Remove duplicate headings
                        if (text === section.heading) return false;

                        return true;
                    })
                    // Remove duplicates
                    .filter((text, index, self) => self.indexOf(text) === index);

                // Keep section only if it has content
                return section.content.length > 0;
            });

        // Reorganize Working Model content if it's in Benefits section
        const workingModelContent = content.structuredContent
            .find(section => section.heading === 'Benefits')?.content
            .filter(text => text.includes('This role is available'));

        if (workingModelContent?.length) {
            // Remove working model content from Benefits
            content.structuredContent = content.structuredContent.map(section => {
                if (section.heading === 'Benefits') {
                    return {
                        ...section,
                        content: section.content.filter(text => !text.includes('This role is available'))
                    };
                }
                return section;
            });

            // Add Working Model as a separate section
            content.structuredContent.push({
                heading: 'Working Model',
                content: workingModelContent
            });
        }
    }

    return content;
}

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
        
        if (response.data && Array.isArray(response.data)) {
            const scrapingPromises = response.data.map(job => 
                scrapeJobDetails(job.url, scrapingQueue)
            );

            const scrapedResults = await Promise.all(scrapingPromises);

            // Clean and merge the data
            response.data = response.data.map((job, index) => {
                const scrapedData = scrapedResults[index];
                
                if (!scrapedData.success) {
                    return {
                        title: job.title,
                        company: job.company,
                        location: job.location,
                        salary: job.salary,
                        description: job.description,
                        url: job.url,
                        posted_date: job.posted_date
                    };
                }

                // Clean the scraped data
                const cleanedData = cleanJobContent(scrapedData);

                return {
                    title: job.title,
                    company: job.company,
                    location: job.location,
                    salary: job.salary,
                    description: job.description,
                    ...(scrapedData.aiProcessedDescription?.split(/\s+/).length >= 60 && { 
                        Fulldescription: scrapedData.aiProcessedDescription 
                    }),
                    url: job.url,
                    posted_date: job.posted_date,
                    details: {
                        basicInfo: {
                            title: cleanedData.basicInfo.title,
                            location: job.location,
                            company: job.company
                        },
                        structuredContent: cleanedData.structuredContent,
                        scrapedAt: cleanedData.scrapedAt
                    }
                };
            });
        }

        return {
            status: response.code,
            message: response.message,
            data: response.data
        };

    } catch (error) {
        console.error('Process error:', error);
        return {
            ...STATUS_CODES.SERVER_ERROR,
            message: "An unexpected error occurred, please try again later"
        };
    }
};


// let browserInstance = null;
async function getBrowser() {
    const browser = await puppeteer.launch({
        headless: true,  
        args: [
            '--no-sandbox',                
            '--disable-setuid-sandbox',    
            '--disable-dev-shm-usage',      
            '--disable-gpu',              
            '--single-process',            
            '--no-zygote',                  
            '--disable-software-rasterizer'
        ],
        executablePath: '/usr/bin/google-chrome'   
    });

    return browser;
}
// async function getBrowser() {
//     if (!browserInstance) {
//         browserInstance = await puppeteer.launch({
//             headless: 'new',
//             args: ['--no-sandbox', '--disable-setuid-sandbox']
//         });
//     }
//     return browserInstance;
// }
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

                // Define content to exclude
                const excludeContent = [
                    'login',
                    'register',
                    'advertise',
                    'search',
                    'back to last search',
                    'create alert',
                    'select your country',
                    'cookie',
                    'privacy',
                    'terms',
                    'browse jobs',
                    'post a job'
                ];

                function isRelevantHeading(text) {
                    const lowercaseText = text.toLowerCase();
                    return relevantSections.some(section => 
                        lowercaseText.includes(section)
                    ) && !excludeContent.some(exclude => 
                        lowercaseText.includes(exclude)
                    );
                }

                function shouldIncludeContent(text) {
                    const lowercaseText = text.toLowerCase();
                    return !excludeContent.some(exclude => 
                        lowercaseText.includes(exclude)
                    );
                }

                function extractJobContent() {
                    const sections = [];
                    let currentSection = {
                        heading: '',
                        content: []
                    };

                    // Target main job content container
                    const mainContent = document.querySelector('[data-cy="job-description"]') || 
                                      document.querySelector('.job-description') ||
                                      document.body;

                    const walker = document.createTreeWalker(
                        mainContent,
                        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
                        null,
                        false
                    );

                    let node;
                    while (node = walker.nextNode()) {
                        // Skip hidden elements and navigation/UI components
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const style = window.getComputedStyle(node);
                            if (style.display === 'none' || 
                                node.classList.contains('navigation') ||
                                node.classList.contains('header') ||
                                node.classList.contains('footer') ||
                                node.classList.contains('similar-jobs') ||
                                node.classList.contains('job-alert')) {
                                continue;
                            }
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
                            if (text && shouldIncludeContent(text)) {
                                currentSection.content.push(text);
                            }
                        }
                    }

                    if (currentSection.heading || currentSection.content.length) {
                        sections.push(currentSection);
                    }

                    return sections;
                }

                // Extract basic job info from relevant elements only
                const basicInfo = {
                    title: document.querySelector('h1')?.textContent.trim() || '',
                    location: document.querySelector('[data-cy="location"]')?.textContent.trim() || '',
                    company: document.querySelector('[data-cy="company-name"]')?.textContent.trim() || ''
                };

                const jobSections = extractJobContent();
                return {
                    basicInfo,
                    sections: jobSections.filter(section => 
                        section.heading && section.content.length > 0 &&
                        shouldIncludeContent(section.heading)
                    )
                };
            });

            // Clean up the sections to remove any remaining unwanted content
            jobContent.sections = jobContent.sections.filter(section => 
                section.content.some(content => content.length > 10) // Remove sections with only short content
            );

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
                error: error.message,
                success: false,
                url: url
            };
        } finally {
            await page.close();
        }
    });
}


router.post('/fetch-jobssignals', async (req, res) => {
    const response = await processJobSignals(req.body);
    res.setHeader('Content-Type', 'application/json');
    return res.status(response.httpStatus || 200).json(response);
    // return res.status(response.httpStatus).json(response);
});

module.exports = {
    router,
    processJobSignals,  // Main method for external use
    fetchJobListings,
    extractCompanyNameFromLinkedInUrl,
    STATUS_CODES
};

//Scraping part removed from the code
// require('dotenv').config();
// const axios = require('axios');
// const express = require('express');
// const router = express.Router();
// const { OpenAI } = require('openai');

// // Initialize OpenAI client
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// // Constants
// const HTTP_STATUS = {
//   BAD_REQUEST: 400,
//   NOT_FOUND: 404,
//   SERVER_ERROR: 500,
//   SUCCESS: 200
// };

// const MESSAGES = {
//   INVALID_INPUT: 'Either LinkedIn URL or Company Name is required',
//   NO_JOBS_FOUND: 'No matching job listings found',
//   JOB_FETCH_SUCCESS: 'Successfully retrieved job listings',
//   LINKEDIN_URL_INVALID: 'Invalid LinkedIn URL format'
// };

// // Response formatter
// const formatResponse = (status, data = null, message = '') => ({
//   status,
//   data,
//   message: message || (status === HTTP_STATUS.SUCCESS ? MESSAGES.JOB_FETCH_SUCCESS : ''),
//   timestamp: new Date().toISOString()
// });

// // LinkedIn URL validation and parsing
// const parseLinkedInCompany = url => {
//   try {
//     const parsed = new URL(url);
//     const validPaths = ['/company/', '/school/', '/organization/'];
//     if (!validPaths.some(path => parsed.pathname.startsWith(path))) return null;
    
//     const [, , companySlug] = parsed.pathname.split('/');
//     return companySlug?.replace(/-/g, ' ') || null;
//   } catch (error) {
//     return null;
//   }
// };

// // AI-powered job description processing
// const processJobDescription = async content => {
//   try {
//     const { choices } = await openai.chat.completions.create({
//       model: 'gpt-3.5-turbo',
//       messages: [{
//         role: 'system',
//         content: 'Extract and structure job details from the following content. Preserve all key information in logical sections.'
//       }, {
//         role: 'user',
//         content: `Process this job description:\n\n${content.slice(0, 10000)}` // Prevent token overflow
//       }],
//       max_tokens: 2000,
//       temperature: 0.3
//     });

//     return choices[0].message.content.trim();
//   } catch (error) {
//     console.error('AI Processing Error:', error);
//     return 'Job description processing unavailable';
//   }
// };

// // Adzuna API client
// class JobAPI {
//   static async fetchListings(companyName) {
//     try {
//       const { data } = await axios.get('https://api.adzuna.com/v1/api/jobs/us/search/1', {
//         params: {
//           app_id: process.env.ADZUNA_APP_ID,
//           app_key: process.env.ADZUNA_APP_KEY,
//           what: companyName,
//           results_per_page: 10
//         }
//       });

//       return data.results || [];
//     } catch (error) {
//       console.error('Adzuna API Error:', error.response?.data || error.message);
//       return [];
//     }
//   }
// }

// // Core business logic
// const jobSignalsService = {
//   normalizeName: name => name.toLowerCase().replace(/[^a-z0-9]/g, ''),

//   isCompanyMatch: (a, b) => {
//     const normA = jobSignalsService.normalizeName(a);
//     const normB = jobSignalsService.normalizeName(b);
//     return normA.includes(normB) || normB.includes(normA);
//   },

//   processJobs: async (jobs, companyName) => {
//     const filtered = jobs.filter(job => 
//       jobSignalsService.isCompanyMatch(job.company?.display_name || '', companyName)
//     );

//     return Promise.all(filtered.map(async job => ({
//       title: job.title || 'Untitled Position',
//       company: job.company?.display_name || 'Unknown Company',
//       location: job.location?.display_name || 'Location not specified',
//       salary: job.salary_min && job.salary_max ? 
//         `$${job.salary_min} - $${job.salary_max}` : 'Salary undisclosed',
//       description: await processJobDescription(job.description || ''),
//       url: job.redirect_url || '#',
//       posted: job.created ? new Date(job.created) : 'Unknown date'
//     })));
//   }
// };

// // Main endpoint handler
// router.post('/job-signals', async (req, res) => {
//   try {
//     const { linkedinUrl, companyName } = req.body;
    
//     // Input validation
//     if (!linkedinUrl && !companyName) {
//       return res.status(HTTP_STATUS.BAD_REQUEST).json(
//         formatResponse(HTTP_STATUS.BAD_REQUEST, null, MESSAGES.INVALID_INPUT)
//       );
//     }

//     // Company name resolution
//     let targetCompany = companyName;
//     if (linkedinUrl) {
//       const parsedCompany = parseLinkedInCompany(linkedinUrl);
//       if (parsedCompany) targetCompany = parsedCompany;
//     }

//     // Data fetching and processing
//     const rawJobs = await JobAPI.fetchListings(targetCompany);
//     if (!rawJobs.length) {
//       return res.status(HTTP_STATUS.NOT_FOUND).json(
//         formatResponse(HTTP_STATUS.NOT_FOUND, null, MESSAGES.NO_JOBS_FOUND)
//       );
//     }

//     const processedJobs = await jobSignalsService.processJobs(rawJobs, targetCompany);
    
//     return res.status(HTTP_STATUS.SUCCESS).json(
//       formatResponse(HTTP_STATUS.SUCCESS, processedJobs)
//     );

//   } catch (error) {
//     console.error('Endpoint Error:', error);
//     return res.status(HTTP_STATUS.SERVER_ERROR).json(
//       formatResponse(HTTP_STATUS.SERVER_ERROR, null, error.message)
//     );
//   }
// });

// module.exports = {
//   router,
//   jobSignalsService,
//   JobAPI,
//   HTTP_STATUS,
//   MESSAGES
// };