const express = require('express');
const multer = require('multer');
const fs = require('fs');
const nodemailer = require('nodemailer');
const puppeteer = require('puppeteer');
const { MongoClient } = require('mongodb');
const { convertVideoToAudio, transcribeAudio } = require('../virtualInterviewAPI/videoTotext');
const { OpenAI } = require('openai');

const axios = require('axios');
const cheerio = require('cheerio');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

const mongoUri = 'mongodb+srv://harishmaneru:Xe2Mz13z83IDhbPW@cluster0.bu3exkw.mongodb.net/?retryWrites=true&w=majority&tls=true';
const dbName = 'interviewApp';
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

// Scrape job description
// const scrapeJobDescription = async (jobPostingUrl) => {
//     const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
//     const page = await browser.newPage();

//     try {
//         await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
//         await page.goto(jobPostingUrl, { waitUntil: 'networkidle0', timeout: 60000 });

//         const platform = identifyPlatform(jobPostingUrl);
//         const platformConfig = PLATFORM_SELECTORS[platform] || {
//             selectors: ['[class*="job-description"]', '[class*="description"]', '[id*="job-description"]', 'article']
//         };

//         for (const selector of platformConfig.selectors) {
//             try {
//                 const element = await page.$(selector);
//                 if (element) {
//                     const jobDescription = await page.evaluate((el) => el.innerText, element);
//                     if (jobDescription.length > 100) return jobDescription;
//                 }
//             } catch {
//                 continue;
//             }
//         }

//         throw new Error('No job description found');
//     } finally {
//         await browser.close();
//     }
// };

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
    page.on('console', msg => console.log('PAGE CONSOLE:', msg.text()));

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
            timeout: 120000 // Longer timeout for EC2
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



const generateQuestions = async (JobDescription, JobTitle = null) => {
    // Check if the job description is meaningful or just navigation/menu text
    const isMenuText = JobDescription.includes('Popular Jobs') &&
        JobDescription.includes('Top job titles') &&
        JobDescription.includes('Top job types') &&
        JobDescription.includes('Top companies');

    let prompt;

    if (isMenuText && JobTitle) {
        console.log('Job description appears to be menu text, using job title instead:', JobTitle);
        prompt = `Generate exactly 3 relevant and challenging interview questions for a "${JobTitle}" position. The questions should focus on skills and knowledge relevant to this role. Provide only the questions, without any introductory text, explanations, or formatting.`;
    } else {
        prompt = `Generate exactly 3 relevant and challenging technical interview questions based on the following job description. The questions should focus on conceptual understanding and require detailed verbal explanations, not code-writing tasks. Avoid asking questions that involve solving problems by writing code. Provide only the questions, without any introductory text, explanations, or formatting:\n\n${JobDescription}`;
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

// Main route handler

router.post('/generate-questions', async (req, res) => {
    const { jobPostingUrl, jobTitle, manualJobDescription, rayId } = req.body;

    if (!jobPostingUrl && !jobTitle && !manualJobDescription) {
        return res.status(400).json({
            status: "-1",
            message: "Either job posting URL, job title, or manual job description is required",
            data: {}
        });
    }

    try {
        console.log(`Generating questions using provided data`);

        // Initialize variables
        let jobData;
        let jobDescription;
        let extractedJobTitle = jobTitle;

        // If manual job description is provided, use it directly
        if (manualJobDescription) {
            console.log('Using manually provided job description');
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
            console.log(`Attempting to scrape job posting URL: ${jobPostingUrl}`);

            // If it's Indeed and we have a Ray ID, store it
            if (jobPostingUrl.includes('indeed.com') && rayId) {
                const jobKey = extractIndeedJobKey(jobPostingUrl);
                if (jobKey) {
                    console.log('Storing Ray ID for Indeed job:', rayId);
                    cloudflareStore.rayIds[jobKey] = rayId;
                }
            }

            try {
                jobData = await scrapeJobDescription(jobPostingUrl, rayId);
                console.log('Raw job data:', typeof jobData === 'object' ? 'Object with properties' : 'Text string');

                // Handle both structured and unstructured job data
                if (typeof jobData === 'object') {
                    jobDescription = jobData.Job_Description;
                    extractedJobTitle = jobData.Job_Title || extractedJobTitle;
                    console.log('Using structured job data with title:', jobData.Job_Title);
                } else {
                    jobDescription = jobData;
                    console.log('Using unstructured job data');
                }

                // Check if the job description is just navigation/menu text
                const isMenuText = jobDescription.includes('Popular Jobs') &&
                    jobDescription.includes('Top job titles') &&
                    jobDescription.includes('Top job types');

                if (isMenuText && extractedJobTitle) {
                    console.log('Detected menu text in job description, will rely on job title for questions');
                }
            } catch (error) {
                console.error('Error scraping job description:', error.message);

                // If scraping fails but jobTitle is provided, use that as fallback
                if (jobTitle) {
                    console.log('Using provided job title as fallback:', jobTitle);
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
            console.log('Using only job title:', jobTitle);
            jobData = {
                Job_Title: jobTitle,
                Job_Description: `Position for ${jobTitle}`,
            };
            jobDescription = jobData.Job_Description;
            extractedJobTitle = jobTitle;
        }

        console.log('Final job description length:', jobDescription.length);

        // Generate raw questions based on the description and title
        const rawQuestions = await generateQuestions(jobDescription, extractedJobTitle);

        // Clean the questions for UI display
        const questions = cleanQuestions(rawQuestions);

        console.log(`Generated ${questions.length} questions`);

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
        console.error('Error in /generate-questions:', error.message);
        res.status(500).json({
            status: "-1",
            message: error.message,
            error: error.message,
            data: {}
        });
    }
});

// Process applicant responses
router.post('/submit-responses', upload.fields([
    { name: 'videoResponse1', maxCount: 1 },
    { name: 'videoResponse2', maxCount: 1 },
    { name: 'videoResponse3', maxCount: 1 }
]), async (req, res) => {
    const { textAnswer, jobPostingUrl, emails } = req.body;
    console.log(req.body)
    const videos = req.files;
    console.log(videos)
    if (!textAnswer || !jobPostingUrl || !emails || !videos) {
        return res.status(400).json({ error: 'Required fields are missing.' });
    }

    try {
        const jobDescription = await scrapeJobDescription(jobPostingUrl);

        const videoResponses = [];
        for (const key of ['videoResponse1', 'videoResponse2', 'videoResponse3']) {
            if (videos[key]) {
                const videoPath = videos[key][0].path;
                const audioPath = await convertVideoToAudio(videoPath);
                const transcription = await transcribeAudio(audioPath);
                videoResponses.push(transcription);
                fs.unlinkSync(audioPath);
                fs.unlinkSync(videoPath);
            }
        }

        const rating = await generateRating(jobDescription, [textAnswer, ...videoResponses]);

        const client = new MongoClient(mongoUri, { useUnifiedTopology: true });
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

        res.json({ message: 'Responses submitted and evaluated successfully.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

