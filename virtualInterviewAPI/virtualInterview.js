const express = require('express');
const multer = require('multer');
const fs = require('fs');
const nodemailer = require('nodemailer');
const puppeteer = require('puppeteer');
const { MongoClient } = require('mongodb');
const { convertVideoToAudio, transcribeAudio } = require('../virtualInterviewAPI/videoTotext');
const { OpenAI } = require('openai');
const { Interview } = require('./interviewLink');

const axios = require('axios');
const cheerio = require('cheerio');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const router = express.Router();
const upload = multer({ dest: 'uploads/' });


const mongoUri = process.env.ONEPGR_MONGO_URI
const dbName = 'onepgr_apps';
const collectionName = 'applicantResponses';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

const PLATFORM_SELECTORS = {
    linkedin: {
        selectors: ['.description__text', '.show-more-less-html__markup', '[data-job-description]'],
        waitForSelector: '.description__text'
    },
    indeed: {
        selectors: [
            '#jobDescriptionText',
            '[data-testid="jobDescriptionText"]',
            '.jobsearch-JobComponent-description',
            '[class*="jobsearch-JobComponent"]',
            '.jobDescriptionText',
            '[id*="jobDescriptionText"]',
            '[class*="job-description"]',
            '[class*="JobDescription"]',
            'div[class*="jobs-description"]',
            'div#jobDescriptionText-content'
        ],
        titleSelectors: [
            'h1.jobsearch-JobInfoHeader-title',
            '[data-testid="jobsTitle"]',
            '.jobsearch-JobInfoHeader-title'
        ],
        waitForSelector: 'body',
        consentSelector: '[id^="onetrust-accept-btn-handler"]',
        readMoreSelector: 'button[aria-label="Read more"]',
        scrollIntoView: true
    },
    glassdoor: {
        selectors: ['.jobDescriptionContent', '.desc', '[data-test="description"]'],
        waitForSelector: '.jobDescriptionContent'
    },
    greenhouse: {
        selectors: ['#content', '#gh-job-content', '.content-block'],
        waitForSelector: '#content'
    },
    lever: {
        selectors: ['.posting-description', '.content'],
        waitForSelector: '.posting-description'
    }
};


// Helper to identify platform from URL
const identifyPlatform = (url) => {
    const domain = new URL(url).hostname.toLowerCase();
    if (domain.includes('linkedin')) return 'linkedin';
    if (domain.includes('indeed')) return 'indeed';
    if (domain.includes('glassdoor')) return 'glassdoor';
    if (domain.includes('greenhouse')) return 'greenhouse';
    if (domain.includes('lever')) return 'lever';
    return 'unknown';
};



// Function to extract job key from Indeed URL
const extractIndeedJobKey = (url) => {
    const match = url.match(/jk=([^&]+)/);
    return match ? match[1] : null;
};

// Direct fetch method for Indeed jobs
const fetchIndeedJobDirectly = async (jobKey) => {
    try {
        console.log('Attempting direct API fetch for Indeed job:', jobKey);

        // Use a more realistic user agent
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.google.com/',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        };

        // Use a more direct mobile view URL which is often less protected
        const mobileUrl = `https://www.indeed.com/m/viewjob?jk=${jobKey}`;
        console.log('Fetching mobile URL:', mobileUrl);

        const response = await axios.get(mobileUrl, { headers });

        if (response.status === 200) {
            console.log('Successfully fetched Indeed job page');
            const $ = cheerio.load(response.data);

            // Get job title
            const jobTitle = $('h1.icl-u-xs-mb--xs').text().trim() ||
                $('.jobsearch-JobInfoHeader-title').text().trim() ||
                $('h1').first().text().trim();

            console.log('Found job title:', jobTitle);

            // Get job description
            const jobDescription = $('#jobDescriptionText').text().trim() ||
                $('.jobsearch-jobDescriptionText').text().trim() ||
                $('[data-testid="jobDescriptionText"]').text().trim();

            if (jobDescription && jobDescription.length > 100) {
                console.log(`Found job description: ${jobDescription.substring(0, 100)}...`);

                return {
                    Job_Title: jobTitle || 'Unknown Position',
                    Job_Description: jobDescription,
                    Platform: 'indeed',
                    URL: `https://www.indeed.com/viewjob?jk=${jobKey}`
                };
            } else {
                // Try a more aggressive approach to find the description
                const bodyText = $('body').text();
                const descriptionChunks = bodyText.split('\n\n')
                    .map(chunk => chunk.trim())
                    .filter(chunk => chunk.length > 200);

                if (descriptionChunks.length > 0) {
                    console.log('Found description in body text chunks');
                    return {
                        Job_Title: jobTitle || 'Unknown Position',
                        Job_Description: descriptionChunks[0],
                        Platform: 'indeed',
                        URL: `https://www.indeed.com/viewjob?jk=${jobKey}`
                    };
                }
            }
        }

        console.log('Failed to get job description via direct fetch');
        return null;
    } catch (error) {
        console.error('Error in direct Indeed fetch:', error.message);
        return null;
    }
};


// Add a storage for Cloudflare Ray IDs and clearance cookies
const cloudflareStore = {
    rayIds: {},
    clearanceCookies: {}
};

// Function to extract Cloudflare Ray ID from HTML content
const extractCloudflareRayId = (html) => {
    const rayIdMatch = html.match(/Your Ray ID for this request is ([a-zA-Z0-9]+)/);
    return rayIdMatch ? rayIdMatch[1] : null;
};

// Enhanced scrapeJobDescription function for EC2 and cloud environments
const scrapeJobDescription = async (jobPostingUrl, rayId = null) => {
    console.log('Starting job description scraping for URL:', jobPostingUrl);

    // Special case for Indeed - try direct fetch first
    if (jobPostingUrl.includes('indeed.com')) {
        const jobKey = extractIndeedJobKey(jobPostingUrl);
        if (jobKey) {
            console.log('Detected Indeed job with key:', jobKey);

            // If we have a Ray ID for this job key, use it
            const storedRayId = rayId || cloudflareStore.rayIds[jobKey];
            if (storedRayId) {
                console.log('Using stored Ray ID:', storedRayId);
            }

            const directResult = await fetchIndeedJobDirectly(jobKey, storedRayId);
            if (directResult) {
                console.log('Successfully fetched Indeed job directly');
                return directResult;
            }
            console.log('Direct fetch failed, trying enhanced browser scraping');
        }
    }

    // Try direct fetch for Adzuna
    if (jobPostingUrl.includes('adzuna.com')) {
        try {
            console.log('Attempting direct API fetch for Adzuna job');

            // Use a more realistic user agent
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.google.com/',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            };

            const response = await axios.get(jobPostingUrl, {
                headers,
                timeout: 30000,
                maxRedirects: 5
            });

            if (response.status === 200) {
                console.log('Successfully fetched Adzuna job page');
                const $ = cheerio.load(response.data);

                // Get job title - more specific selectors for Adzuna
                const jobTitle = $('h1.job-title').text().trim() ||
                    $('h1').first().text().trim() ||
                    $('.job-title').text().trim() ||
                    $('title').text().replace(' | Adzuna', '').trim();

                console.log('Found job title:', jobTitle);

                // Get job description - more specific selectors for Adzuna
                // First try the main job description container
                let jobDescription = '';

                // Try the specific job description container first
                const descriptionElement = $('.job-description');
                if (descriptionElement.length > 0) {
                    jobDescription = descriptionElement.text().trim();
                    console.log('Found job description in .job-description');
                }

                // If that fails, try the details section
                if (!jobDescription || jobDescription.length < 100) {
                    const detailsElement = $('#details');
                    if (detailsElement.length > 0) {
                        jobDescription = detailsElement.text().trim();
                        console.log('Found job description in #details');
                    }
                }

                // If that fails, try the app-description section
                if (!jobDescription || jobDescription.length < 100) {
                    const appDescriptionElement = $('.app-description');
                    if (appDescriptionElement.length > 0) {
                        jobDescription = appDescriptionElement.text().trim();
                        console.log('Found job description in .app-description');
                    }
                }

                // If that fails, try to find the main content area and exclude navigation/footer
                if (!jobDescription || jobDescription.length < 100) {
                    // Remove navigation, footer, and other non-content elements
                    $('nav, header, footer, .navigation, .footer, .menu, .popular-jobs, .top-jobs, .top-locations').remove();
                    $('script, style, link, meta').remove();

                    // Get the main content
                    const mainContent = $('.job-details, .job-content, main, #main, .main-content, .content');
                    if (mainContent.length > 0) {
                        jobDescription = mainContent.text().trim();
                        console.log('Found job description in main content area');
                    }
                }

                // If we still don't have a good description, try a more aggressive approach
                if (!jobDescription || jobDescription.length < 100) {
                    // Get all text from the body, excluding common navigation elements
                    const bodyText = $('body').text();

                    // Remove common header/footer/navigation text
                    const cleanedText = bodyText
                        .replace(/Popular Jobs|Top job titles|Top job types|Top companies|Top locations/gi, '')
                        .replace(/Jobseekers|Recruiters|Adzuna|Browse jobs|Post a job|About|Careers|Contact|Privacy|Terms/gi, '')
                        .replace(/Work From Home|Remote|Online|Part Time|Entry Level|Freelance|Weekend|Summer|Full Time|Seasonal/gi, '')
                        .replace(/Amazon jobs|UPS jobs|Walmart jobs|Starbucks jobs|Target jobs|Costco jobs|FedEx jobs|Apple jobs/gi, '')
                        .replace(/New York City|Atlanta|Denver|Dallas|Orlando|Chicago|Nashville|San Antonio|Tucson|Las Vegas/gi, '')
                        .replace(/© \d+ ADZUNA LTD/gi, '')
                        .replace(/Country selection/gi, '')
                        .trim();

                    // Split into paragraphs and find meaningful chunks
                    const paragraphs = cleanedText.split('\n')
                        .map(p => p.trim())
                        .filter(p => p.length > 50);

                    if (paragraphs.length > 0) {
                        // Join the paragraphs that are likely part of the job description
                        jobDescription = paragraphs.join('\n\n');
                        console.log('Found job description using text extraction');
                    }
                }

                // If we have a job description, return it
                if (jobDescription && jobDescription.length > 100) {
                    console.log(`Found Adzuna job description: ${jobDescription.substring(0, 100)}...`);

                    return {
                        Job_Title: jobTitle || 'Unknown Position',
                        Job_Description: jobDescription,
                        Platform: 'adzuna',
                        URL: jobPostingUrl
                    };
                }
            }
        } catch (error) {
            console.error('Error in direct Adzuna fetch:', error.message);
            // Continue to browser-based scraping
        }
    }

    // Configure browser for EC2 environment
    const launchOptions = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Important for EC2/Docker environments
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-blink-features=AutomationControlled',
            '--disable-extensions',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--disable-breakpad',
            '--disable-sync',
            '--disable-translate',
            '--metrics-recording-only',
            '--disable-hang-monitor',
            '--disable-features=site-per-process,TranslateUI,BlinkGenPropertyTrees',
            '--disable-ipc-flooding-protection',
            '--enable-features=NetworkService,NetworkServiceInProcess',
            '--mute-audio',
            '--hide-scrollbars'
        ],
        ignoreHTTPSErrors: true,
        timeout: 60000
    };

    // Check if we're running in EC2 (you can add more specific detection if needed)
    const isEC2 = process.env.AWS_EXECUTION_ENV || process.env.EC2_INSTANCE_ID;
    if (isEC2) {
        console.log('Detected EC2 environment, using optimized settings');
        // Add EC2-specific settings
        launchOptions.args.push('--single-process'); // Helps with memory issues
    }

    const browser = await puppeteer.launch(launchOptions);
    console.log('Browser launched with optimized settings for cloud environment');

    const page = await browser.newPage();

    // Add page console logs for debugging
    // page.on('console', msg => console.log('PAGE CONSOLE:', msg.text()));

    try {
        // Set realistic headers and viewport
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Referer': 'https://www.google.com/',
            'sec-ch-ua': '"Google Chrome";v="91", " Not;A Brand";v="99", "Chromium";v="91"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'cross-site',
            'sec-fetch-user': '?1',
            'upgrade-insecure-requests': '1'
        });
        await page.setViewport({ width: 1920, height: 1080 });
        console.log('Set user agent, headers, and viewport');

        // Optimize page load by blocking unnecessary resources
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            const url = req.url();

            // Block analytics, ads, and unnecessary resources
            if (
                ['image', 'stylesheet', 'font', 'media'].includes(resourceType) ||
                url.includes('google-analytics') ||
                url.includes('googletagmanager') ||
                url.includes('facebook') ||
                url.includes('analytics') ||
                url.includes('tracker') ||
                url.includes('advertisement') ||
                url.includes('ads')
            ) {
                req.abort();
            } else {
                // Add cookies if needed for Cloudflare
                if (url.includes('indeed.com') && rayId && cloudflareStore.clearanceCookies[rayId]) {
                    const headers = req.headers();
                    headers['Cookie'] = cloudflareStore.clearanceCookies[rayId];
                    req.continue({ headers });
                } else {
                    req.continue();
                }
            }
        });

        console.log('Navigating to job posting URL...');
        // Navigate with networkidle2 wait and longer timeout for EC2
        await page.goto(jobPostingUrl, {
            waitUntil: 'networkidle2',
            timeout: 120000
        });
        console.log('Successfully loaded the page');

        // Take a screenshot for debugging
        await page.screenshot({ path: 'debug-screenshot.png' });
        console.log('Took debug screenshot');

        // Check for Cloudflare challenge
        const isCloudflare = await page.evaluate(() => {
            return document.body.textContent.includes('Cloudflare') ||
                document.body.textContent.includes('Verifying') ||
                document.body.textContent.includes('security challenge');
        });

        if (isCloudflare) {
            console.log('Cloudflare detected, checking for Ray ID...');

            // Extract Ray ID from the page
            const extractedRayId = await page.evaluate(() => {
                const rayIdMatch = document.body.textContent.match(/Your Ray ID for this request is ([a-zA-Z0-9]+)/);
                return rayIdMatch ? rayIdMatch[1] : null;
            });

            if (extractedRayId) {
                console.log('Found Ray ID in Cloudflare challenge:', extractedRayId);

                // Store the Ray ID for this job URL
                cloudflareStore.rayIds[jobPostingUrl] = extractedRayId;

                // Try to extract any cookies that might help bypass Cloudflare
                const cookies = await page.cookies();
                const cfCookies = cookies.filter(cookie =>
                    cookie.name.includes('cf_') ||
                    cookie.name.includes('__cf')
                );

                if (cfCookies.length > 0) {
                    console.log('Found Cloudflare cookies:', cfCookies.map(c => c.name).join(', '));

                    // Store the cookies for this Ray ID
                    const cookieString = cfCookies.map(c => `${c.name}=${c.value}`).join('; ');
                    cloudflareStore.clearanceCookies[extractedRayId] = cookieString;
                }
            }
        }

        const platform = identifyPlatform(jobPostingUrl);
        console.log('Identified platform:', platform);

        const platformConfig = PLATFORM_SELECTORS[platform] || {};
        console.log('Using platform config for:', platform);

        // Handle cookie consent if present
        if (platformConfig.consentSelector) {
            console.log('Checking for cookie consent modal...');
            try {
                await page.waitForSelector(platformConfig.consentSelector, { timeout: 5000 });
                console.log('Found cookie consent button, clicking...');
                await page.click(platformConfig.consentSelector);
                await page.waitForTimeout(1000);
                console.log('Cookie consent handled');
            } catch (e) {
                console.log('No consent modal found or error handling it:', e.message);
            }
        }

        // Special handling for Adzuna
        if (jobPostingUrl.includes('adzuna.com')) {
            console.log('Applying Adzuna-specific scraping logic');

            // Try to get job title
            const jobTitle = await page.evaluate(() => {
                const titleElement = document.querySelector('h1.job-title') ||
                    document.querySelector('h1') ||
                    document.querySelector('.job-title');
                return titleElement ? titleElement.innerText.trim() :
                    document.title.replace(' | Adzuna', '').trim();
            });

            console.log('Found job title:', jobTitle);

            // Try to get job description with more specific targeting
            const jobDescription = await page.evaluate(() => {
                // First try specific job description containers
                const descriptionSelectors = [
                    '.job-description',
                    '#details',
                    '.app-description',
                    '.description-container',
                    '.job-details',
                    '.job-content'
                ];

                for (const selector of descriptionSelectors) {
                    const element = document.querySelector(selector);
                    if (element && element.innerText.trim().length > 100) {
                        return element.innerText.trim();
                    }
                }

                // If specific selectors fail, try to clean the page and extract content
                // Remove navigation, header, footer elements
                const elementsToRemove = document.querySelectorAll(
                    'nav, header, footer, .navigation, .footer, .menu, ' +
                    '.popular-jobs, .top-jobs, .top-locations, ' +
                    'script, style, link, meta'
                );

                elementsToRemove.forEach(el => {
                    if (el && el.parentNode) {
                        el.parentNode.removeChild(el);
                    }
                });

                // Get the main content
                const mainContent = document.querySelector('.job-details, .job-content, main, #main, .main-content, .content');
                if (mainContent && mainContent.innerText.trim().length > 100) {
                    return mainContent.innerText.trim();
                }

                // If all else fails, get the body text and clean it
                const bodyText = document.body.innerText;

                // Remove common navigation text patterns
                const cleanedText = bodyText
                    .replace(/Popular Jobs|Top job titles|Top job types|Top companies|Top locations/gi, '')
                    .replace(/Jobseekers|Recruiters|Adzuna|Browse jobs|Post a job|About|Careers|Contact|Privacy|Terms/gi, '')
                    .replace(/Work From Home|Remote|Online|Part Time|Entry Level|Freelance|Weekend|Summer|Full Time|Seasonal/gi, '')
                    .replace(/Amazon jobs|UPS jobs|Walmart jobs|Starbucks jobs|Target jobs|Costco jobs|FedEx jobs|Apple jobs/gi, '')
                    .replace(/New York City|Atlanta|Denver|Dallas|Orlando|Chicago|Nashville|San Antonio|Tucson|Las Vegas/gi, '')
                    .replace(/© \d+ ADZUNA LTD/gi, '')
                    .replace(/Country selection/gi, '')
                    .trim();

                // Split into paragraphs and find meaningful chunks
                const paragraphs = cleanedText.split('\n')
                    .map(p => p.trim())
                    .filter(p => p.length > 50);

                if (paragraphs.length > 0) {
                    // Join the paragraphs that are likely part of the job description
                    return paragraphs.join('\n\n');
                }

                return null;
            });

            if (jobDescription && jobDescription.length > 100) {
                console.log(`Found Adzuna job description: ${jobDescription.substring(0, 100)}...`);

                return {
                    Job_Title: jobTitle || 'Unknown Position',
                    Job_Description: jobDescription,
                    Platform: 'adzuna',
                    URL: jobPostingUrl
                };
            }
        }

        // Special handling for Indeed pages
        if (platform === 'indeed') {
            // ... existing Indeed-specific code ...
        }

        // Standard approach for other platforms or as fallback
        console.log('Using standard scraping approach with selectors');
        const selectors = platformConfig.selectors || ['body'];

        // Try each selector
        for (const selector of selectors) {
            try {
                console.log('Trying selector:', selector);
                const element = await page.$(selector);
                if (element) {
                    console.log('Found element with selector:', selector);
                    const text = await page.evaluate(el => {
                        el.querySelectorAll('script, style').forEach(node => node.remove());
                        return el.innerText.trim();
                    }, element);

                    if (text && text.length > 100) {
                        console.log(`Successfully extracted text (${text.length} chars) with selector: ${selector}`);
                        return text;
                    } else {
                        console.log(`Selector ${selector} returned too short text (${text?.length || 0} chars)`);
                    }
                } else {
                    console.log(`No element found with selector: ${selector}`);
                }
            } catch (e) {
                console.log(`Error with selector ${selector}:`, e.message);
            }
        }

        // Last resort: try to extract any meaningful text from the page
        console.log('Trying last resort extraction from entire page');
        const bodyText = await page.evaluate(() => {
            // Remove script, style and hidden elements
            document.querySelectorAll('script, style, [style*="display:none"], [style*="display: none"]').forEach(el => el.remove());

            // Get all text chunks
            const textNodes = [];
            const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            while (walk.nextNode()) {
                const node = walk.currentNode;
                if (node.textContent.trim().length > 50) {
                    textNodes.push(node.textContent.trim());
                }
            }

            // Find the longest chunk
            return textNodes.sort((a, b) => b.length - a.length)[0] || document.body.innerText;
        });

        if (bodyText && bodyText.length > 200) {
            console.log(`Last resort found text (${bodyText.length} chars)`);
            return bodyText;
        }

        console.log('All extraction attempts failed');
        throw new Error('No job description found');
    } catch (error) {
        console.error('Scraping failed with error:', error.message);
        throw error;
    } finally {
        console.log('Closing browser...');
        await browser.close();
        console.log('Browser closed');
    }
};



const generateQuestions = async (JobDescription, JobTitle = null, numQuestions = 3) => {
    // Check if the job description is meaningful or just navigation/menu text
    const isMenuText = JobDescription.includes('Popular Jobs') &&
        JobDescription.includes('Top job titles') &&
        JobDescription.includes('Top job types');

    let prompt;

    if (isMenuText && JobTitle) {
        console.log('Job description appears to be menu text, using job title instead:', JobTitle);
        prompt = `Generate exactly ${numQuestions} relevant and challenging interview questions for a "${JobTitle}" position. The questions should focus on skills and knowledge relevant to this role. Provide only the questions, without any introductory text, explanations, or formatting.`;
    } else {
        prompt = `Generate exactly ${numQuestions} relevant and challenging technical interview questions based on the following job description. The questions should focus on conceptual understanding and require detailed verbal explanations, not code-writing tasks. Avoid asking questions that involve solving problems by writing code. Provide only the questions, without any introductory text, explanations, or formatting:\n\n${JobDescription}`;
    }

    const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
            {
                role: 'system',
                content: 'You are an expert technical interviewer who creates concise, challenging technical questions for candidates.'
            },
            {
                role: 'user',
                content: prompt
            }
        ],
        temperature: 0.7,
    });

    return response.choices[0].message.content.split('\n').filter(q => q.trim());
};


// Function to clean the generated questions
const cleanQuestions = (questions) => {
    let cleanedQuestions = [];
    let questionNumber = 1;

    for (let question of questions) {

        let cleanedQuestion = question.replace(/\*\*/g, '').trim();


        cleanedQuestion = cleanedQuestion.replace(/^Technical Question \d+:/, `Question ${questionNumber}:`);
        cleanedQuestions.push(cleanedQuestion);

        questionNumber++;
    }

    return cleanedQuestions;
};

// Add a cache to store job data
const jobDataCache = new Map();

// Add a temporary storage for job data with user isolation
const tempJobDataStore = new Map();

// Helper function to generate a unique key for the user's job data
const generateUserJobKey = (userId, jobPostingUrl) => {
    return `${userId}_${jobPostingUrl || 'manual'}`;
};

// Helper function to get all keys for a specific user
const getUserJobKeys = (userId) => {
    return Array.from(tempJobDataStore.keys()).filter(key => key.startsWith(`${userId}_`));
};

router.post('/generate-questions', async (req, res) => {
    const { jobPostingUrl, jobTitle, manualJobDescription, rayId, numQuestions = 3, isAdditionalRequest = false, userId } = req.body;

    if (!jobPostingUrl && !jobTitle && !manualJobDescription) {
        return res.status(400).json({
            status: "-1",
            message: "Either job posting URL, job title, or job description is required",
            data: {}
        });
    }

    if (!userId) {
        return res.status(400).json({
            status: "-1",
            message: "User ID is required",
            data: {}
        });
    }

    try {
        console.log(`Generating questions for user ${userId}`);

        // Initialize variables
        let jobData;
        let jobDescription;
        let extractedJobTitle = jobTitle;

        // Generate a unique key for this user's job data
        const userJobKey = generateUserJobKey(userId, jobPostingUrl);

        // If this is an additional request, use the stored data
        if (isAdditionalRequest && tempJobDataStore.has(userJobKey)) {
            console.log(`Using stored job data for additional questions for user ${userId}`);
            const storedData = tempJobDataStore.get(userJobKey);
            jobData = storedData.jobData;
            jobDescription = storedData.jobDescription;
            extractedJobTitle = storedData.extractedJobTitle;
        } else {
            // If manual job description is provided, use it directly
            if (manualJobDescription) {
                console.log(`Using manually provided job description for user ${userId}`);
                jobData = {
                    Job_Title: jobTitle || 'Unknown Position',
                    Job_Description: manualJobDescription,
                    Platform: jobPostingUrl ? identifyPlatform(jobPostingUrl) : 'manual',
                    URL: jobPostingUrl || 'Manual Entry'
                };
                jobDescription = manualJobDescription;
            }
            // Otherwise try to scrape
            else if (jobPostingUrl) {
                console.log(`Attempting to scrape job posting URL for user ${userId}: ${jobPostingUrl}`);

                // If it's Indeed and we have a Ray ID, store it
                if (jobPostingUrl.includes('indeed.com') && rayId) {
                    const jobKey = extractIndeedJobKey(jobPostingUrl);
                    if (jobKey) {
                        console.log(`Storing Ray ID for Indeed job for user ${userId}:`, rayId);
                        cloudflareStore.rayIds[jobKey] = rayId;
                    }
                }

                try {
                    jobData = await scrapeJobDescription(jobPostingUrl, rayId);
                    console.log(`Raw job data for user ${userId}:`, typeof jobData === 'object' ? 'Object with properties' : 'Text string');

                    // Handle both structured and unstructured job data
                    if (typeof jobData === 'object') {
                        jobDescription = jobData.Job_Description;
                        extractedJobTitle = jobData.Job_Title || extractedJobTitle;
                        console.log(`Using structured job data with title for user ${userId}:`, jobData.Job_Title);
                    } else {
                        jobDescription = jobData;
                        console.log(`Using unstructured job data for user ${userId}`);
                    }

                    // Check if the job description is just navigation/menu text
                    const isMenuText = jobDescription.includes('Popular Jobs') &&
                        jobDescription.includes('Top job titles') &&
                        jobDescription.includes('Top job types');

                    if (isMenuText && extractedJobTitle) {
                        console.log(`Detected menu text in job description for user ${userId}, will rely on job title for questions`);
                    }
                } catch (error) {
                    console.error(`Error scraping job description for user ${userId}:`, error.message);

                    // If scraping fails but jobTitle is provided, use that as fallback
                    if (jobTitle) {
                        console.log(`Using provided job title as fallback for user ${userId}:`, jobTitle);
                        jobData = {
                            Job_Title: jobTitle,
                            Job_Description: `Position for ${jobTitle}`,
                            Platform: jobPostingUrl.includes('indeed.com') ? 'indeed' :
                                jobPostingUrl.includes('adzuna.com') ? 'adzuna' :
                                    identifyPlatform(jobPostingUrl),
                            URL: jobPostingUrl
                        };
                        jobDescription = jobData.Job_Description;
                    } else {
                        throw new Error('Failed to get job description and no job title provided. Please provide a job description.');
                    }
                }
            }
            // Use just the job title if that's all we have
            else if (jobTitle) {
                console.log(`Using only job title for user ${userId}:`, jobTitle);
                jobData = {
                    Job_Title: jobTitle,
                    Job_Description: `Position for ${jobTitle}`,
                };
                jobDescription = jobData.Job_Description;
                extractedJobTitle = jobTitle;
            }

            // Store the data for potential additional requests
            tempJobDataStore.set(userJobKey, {
                jobData,
                jobDescription,
                extractedJobTitle,
                userId, // Store userId with the data for additional validation
                timestamp: Date.now() // Store timestamp for potential cleanup
            });
        }

        console.log(`Final job description length for user ${userId}:`, jobDescription.length);

        // Generate raw questions based on the description and title
        const rawQuestions = await generateQuestions(jobDescription, extractedJobTitle, numQuestions);

        // Clean the questions for UI display
        const questions = cleanQuestions(rawQuestions);

        console.log(`Generated ${questions.length} questions for user ${userId}`);

        // Get the Ray ID if available
        let responseRayId = null;
        if (jobPostingUrl && jobPostingUrl.includes('indeed.com')) {
            const jobKey = extractIndeedJobKey(jobPostingUrl);
            if (jobKey && cloudflareStore.rayIds[jobKey]) {
                responseRayId = cloudflareStore.rayIds[jobKey];
            }
        }

        // Respond with questions and the job description
        res.json({
            questions,
            JobDescription: jobDescription
        })
    } catch (error) {
        console.error(`Error in /generate-questions for user ${userId}:`, error.message);
        res.status(500).json({
            status: "-1",
            message: error.message,
            error: error.message,
            data: {}
        });
    }
});

// Add a cleanup function to be called from the /interviewlink endpoint
const cleanupJobData = (userId, jobPostingUrl) => {
    if (!userId) {
        console.error('Cannot cleanup job data: userId is required');
        return;
    }

    const userJobKey = generateUserJobKey(userId, jobPostingUrl);

    // Verify the data belongs to the correct user before deleting
    if (tempJobDataStore.has(userJobKey)) {
        const storedData = tempJobDataStore.get(userJobKey);
        if (storedData.userId === userId) {
            tempJobDataStore.delete(userJobKey);
            console.log(`Cleaned up job data for user ${userId} and job ${jobPostingUrl}`);
        } else {
            console.error(`Attempted to cleanup data for wrong user. Expected ${userId}, found ${storedData.userId}`);
        }
    }
};

// Add a function to cleanup all data for a specific user
const cleanupAllUserData = (userId) => {
    if (!userId) {
        console.error('Cannot cleanup user data: userId is required');
        return;
    }

    const userKeys = getUserJobKeys(userId);
    userKeys.forEach(key => {
        const storedData = tempJobDataStore.get(key);
        if (storedData.userId === userId) {
            tempJobDataStore.delete(key);
            console.log(`Cleaned up job data for user ${userId} with key ${key}`);
        }
    });
};

// Export the cleanup functions
module.exports.cleanupJobData = cleanupJobData;
module.exports.cleanupAllUserData = cleanupAllUserData;

// Process applicant responses
router.post('/submit-responses', upload.any(), async (req, res) => {
    const { textAnswer, jobPostingUrl, emails } = req.body;
    console.log('Request body:', req.body);
    console.log('Files:', req.files);

    if (!textAnswer || !jobPostingUrl || !emails) {
        return res.status(400).json({
            status: "-1",
            message: "Required fields are missing.",
            data: {}
        });
    }

    try {
        const jobDescription = await scrapeJobDescription(jobPostingUrl);

        const videoResponses = [];
        // Process all video files
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                if (file.mimetype.startsWith('video/')) {
                    const videoPath = file.path;
                    const audioPath = await convertVideoToAudio(videoPath);
                    const transcription = await transcribeAudio(audioPath);
                    videoResponses.push(transcription);

                    // Clean up temporary files
                    fs.unlinkSync(audioPath);
                    fs.unlinkSync(videoPath);
                }
            }
        }

        const rating = await generateRating(jobDescription, [textAnswer, ...videoResponses]);

        const client = new MongoClient(mongoUri);
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        await collection.insertOne({
            textAnswer,
            videoResponses,
            jobDescription,
            rating,
            submittedAt: new Date()
        });
        await client.close();

        const emailRecipients = emails.split(',').map((email) => email.trim());
        const emailContent = `Applicant responses and ratings have been completed. View them here: [Link to Application]`;

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: emailRecipients,
            subject: 'Applicant Evaluation Available',
            text: emailContent
        });

        res.json({
            status: "1",
            message: "Responses submitted and evaluated successfully.",
            data: {
                textAnswer,
                videoResponsesCount: videoResponses.length,
                rating
            }
        });
    } catch (error) {
        console.error('Error in /submit-responses:', error);
        res.status(500).json({
            status: "-1",
            message: error.message,
            error: error.message,
            data: {}
        });
    }
});

// Add these MongoDB schema definitions at the top of the file
const jobSchema = {
    applicationLink: String,
    Job_Title: String,
    Company: String,
    Company_URL: String,
    Company_Logo: String,
    Location: String,
    Compensation: String,
    Employment_Type: String,
    Portal: String,
    Job_URL: String,
    Posted_At: String,
    Job_Description: String,
    interviewPageLink: String
};

const subcategorySchema = {
    name: String,
    jobs: [jobSchema]
};

const categorySchema = {
    name: String,
    subcategories: [subcategorySchema]
};


router.post('/create-interview-page/:category/:subcategory/:applicationLink', async (req, res) => {
    console.log('=== Starting create interview page endpoint ===');
    let client;

    try {
        client = new MongoClient(mongoUri);
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('jobCategories');

        // Find the specific job using applicationLink
        const category = await collection.findOne({
            name: req.params.category,
            'subcategories.name': req.params.subcategory,
            'subcategories.jobs.applicationLink': req.params.applicationLink
        });

        if (!category) {
            throw new Error('Category or subcategory not found');
        }

        const subcategory = category.subcategories.find(sub => sub.name === req.params.subcategory);
        const job = subcategory.jobs.find(job => job.applicationLink === req.params.applicationLink);

        if (!job) {
            throw new Error('Job not found');
        }

        // Check if interview page already exists
        if (job.interviewPageLink) {
            return res.json({
                status: "1",
                message: "Interview page already exists",
                data: {
                    interviewPageLink: job.interviewPageLink,
                    isExisting: true
                }
            });
        }

        // Generate questions using job description
        console.log('Generating questions for job:', job.Job_Title);
        const questions = await generateQuestions(job.Job_Description, job.Job_Title);

        if (!questions || questions.length === 0) {
            throw new Error('Failed to generate questions');
        }

        // Add custom question to the questions array
        const customQuestion = `Tell us about your relevant experience and past work that aligns with this job posting.`;
        const allQuestions = [customQuestion, ...questions];

        // auto Create interview link using /interviewlink endpoint logic
        const applicationLink = req.params.applicationLink;
        const interviewData = {
            userId: 'admin',
            email: 'admin@recordedinterview.com',
            interviewTitle: job.Job_Title,
            jobPostingUrl: job.Job_URL,
            companyUrl: job.Company_URL,
            companyLogoUrl: job.Company_Logo,
            questions: allQuestions,
            applicationLink: applicationLink,
            expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
        };

        // Create new interview document using Interview model
        const interview = new Interview(interviewData);
        await interview.save();

        const interviewPageLink = `https://record.onepgr.com/InterviewPage/${applicationLink}`;

        // Update the job with interview page link - modified query
        await collection.updateOne(
            {
                name: req.params.category,
                'subcategories.name': req.params.subcategory,
                'subcategories.jobs.applicationLink': req.params.applicationLink
            },
            {
                $set: {
                    'subcategories.$[sub].jobs.$[job].interviewPageLink': interviewPageLink
                }
            },
            {
                arrayFilters: [
                    { 'sub.name': req.params.subcategory },
                    { 'job.applicationLink': req.params.applicationLink }
                ]
            }
        );

        console.log('Interview page created successfully for:', job.Job_Title);

        res.json({
            status: "1",
            message: "Interview page created successfully",
            data: {
                interviewPageLink,
                isExisting: false,
                questions
            }
        });

    } catch (error) {
        console.error('Error creating interview page:', error);
        res.status(500).json({
            status: "-1",
            message: error.message,
            data: {}
        });
    } finally {
        if (client) {
            await client.close();
            console.log('MongoDB connection closed');
        }
    }
});




//_____________________________open Jobs API_____________________________ 
router.post('/store-jobs', async (req, res) => {
    console.log('=== Starting /store-jobs endpoint ===');
    console.log('Request received at:', new Date().toISOString());
    let client;

    try {
        // Validate input
        if (!req.body.categories || !Array.isArray(req.body.categories)) {
            console.error('Invalid input: categories array is missing or not an array');
            return res.status(400).json({
                status: "-1",
                message: "Invalid input: categories array is required",
                data: {}
            });
        }

        console.log('Attempting to connect to MongoDB...');
        client = new MongoClient(mongoUri);
        await client.connect();
        console.log('Successfully connected to MongoDB');

        const db = client.db(dbName);
        const collection = db.collection('jobCategories');

        // Fetch existing categories
        console.log('Fetching existing categories...');
        const existingCategories = await collection.find({}).toArray();
        console.log('Found existing categories:', existingCategories.length);

        // Process new categories and merge with existing ones
        console.log('Processing new categories and merging with existing ones...');
        const processedCategories = await Promise.all(req.body.categories.map(async (newCategory) => {
            // Find existing category
            const existingCategory = existingCategories.find(ec => ec.name === newCategory.name);

            if (existingCategory) {
                // Merge subcategories
                const mergedSubcategories = await Promise.all(newCategory.subcategories.map(async (newSubcategory) => {
                    const existingSubcategory = existingCategory.subcategories.find(es => es.name === newSubcategory.name);

                    if (existingSubcategory) {
                        // Merge jobs, avoiding duplicates based on applicationLink
                        const existingJobLinks = new Set(existingSubcategory.jobs.map(j => j.applicationLink));
                        const newJobs = newSubcategory.jobs.filter(job => !existingJobLinks.has(job.applicationLink));

                        // Generate applicationLinks for new jobs that don't have one
                        const processedNewJobs = await Promise.all(newJobs.map(async (job) => {
                            if (!job.applicationLink) {
                                return {
                                    ...job,
                                    applicationLink: generateUniqueId()
                                };
                            }
                            return job;
                        }));

                        return {
                            ...existingSubcategory,
                            jobs: [...existingSubcategory.jobs, ...processedNewJobs]
                        };
                    } else {
                        // New subcategory, process its jobs
                        const processedJobs = await Promise.all(newSubcategory.jobs.map(async (job) => {
                            if (!job.applicationLink) {
                                return {
                                    ...job,
                                    applicationLink: generateUniqueId()
                                };
                            }
                            return job;
                        }));

                        return {
                            ...newSubcategory,
                            jobs: processedJobs
                        };
                    }
                }));

                return {
                    ...existingCategory,
                    subcategories: mergedSubcategories
                };
            } else {
                // New category, process all its jobs
                const processedSubcategories = await Promise.all(newCategory.subcategories.map(async (subcategory) => {
                    const processedJobs = await Promise.all(subcategory.jobs.map(async (job) => {
                        if (!job.applicationLink) {
                            return {
                                ...job,
                                applicationLink: generateUniqueId()
                            };
                        }
                        return job;
                    }));
                    return {
                        ...subcategory,
                        jobs: processedJobs
                    };
                }));

                return {
                    ...newCategory,
                    subcategories: processedSubcategories
                };
            }
        }));

        // Update or insert categories
        console.log('Updating/inserting categories...');
        const updatePromises = processedCategories.map(async (category) => {
            const result = await collection.updateOne(
                { name: category.name },
                { $set: category },
                { upsert: true }
            );
            return result;
        });

        const results = await Promise.all(updatePromises);
        const modifiedCount = results.reduce((acc, result) => acc + (result.modifiedCount || 0), 0);
        const upsertedCount = results.reduce((acc, result) => acc + (result.upsertedCount || 0), 0);

        await client.close();
        console.log('MongoDB connection closed');

        console.log('=== Endpoint completed successfully ===');
        res.json({
            status: "1",
            message: "Jobs data merged successfully",
            data: {
                modifiedCount,
                upsertedCount,
                categoriesCount: processedCategories.length
            }
        });
    } catch (error) {
        console.error('=== Error in /store-jobs endpoint ===');
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });

        if (client) {
            await client.close();
            console.log('MongoDB connection closed after error');
        }

        res.status(500).json({
            status: "-1",
            message: error.message,
            data: {}
        });
    }
});

// Endpoint to fetch all job data
router.get('/fetch-jobs', async (req, res) => {
    try {
        const client = new MongoClient(mongoUri);
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('jobCategories');

        // Fetch all categories
        const categories = await collection.find({}).toArray();

        await client.close();

        res.json({
            status: "1",
            message: "Jobs data fetched successfully",
            data: { categories }
        });
    } catch (error) {
        console.error('Error fetching jobs:', error);
        res.status(500).json({
            status: "-1",
            message: error.message,
            data: {}
        });
    }
});

// Endpoint to fetch jobs by category
router.get('/fetch-jobs/:category', async (req, res) => {
    try {
        const client = new MongoClient(mongoUri);
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('jobCategories');

        const category = await collection.findOne({ name: req.params.category });

        await client.close();

        if (!category) {
            return res.status(404).json({
                status: "-1",
                message: "Category not found",
                data: {}
            });
        }

        res.json({
            status: "1",
            message: "Category jobs fetched successfully",
            data: { category }
        });
    } catch (error) {
        console.error('Error fetching category jobs:', error);
        res.status(500).json({
            status: "-1",
            message: error.message,
            data: {}
        });
    }
});

// Endpoint to fetch jobs by category and subcategory
router.get('/fetch-jobs/:category/:subcategory', async (req, res) => {
    try {
        const client = new MongoClient(mongoUri);
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('jobCategories');

        const category = await collection.findOne({
            name: req.params.category,
            'subcategories.name': req.params.subcategory
        });

        await client.close();

        if (!category) {
            return res.status(404).json({
                status: "-1",
                message: "Category or subcategory not found",
                data: {}
            });
        }

        const subcategory = category.subcategories.find(sub => sub.name === req.params.subcategory);

        res.json({
            status: "1",
            message: "Subcategory jobs fetched successfully",
            data: { subcategory }
        });
    } catch (error) {
        console.error('Error fetching subcategory jobs:', error);
        res.status(500).json({
            status: "-1",
            message: error.message,
            data: {}
        });
    }
});

function generateUniqueId() {
    const timestamp = Date.now().toString(36);
    const randomString = Math.random().toString(36).substr(2, 6);
    return `${timestamp}-${randomString}`;
}

module.exports = router;