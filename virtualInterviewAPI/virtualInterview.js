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

// Platform-specific selectors
// const PLATFORM_SELECTORS = {
//     linkedin: {
//         selectors: ['.description__text', '.show-more-less-html__markup', '[data-job-description]'],
//         waitForSelector: '.description__text'
//     },
//     indeed: {
//         selectors: [
//             '#jobDescriptionText',
//             '.jobsearch-JobComponent-description',
//             '[data-testid="jobDescriptionTitleHeading"]',
//             '.jobDescriptionText',
//             '.Full job description',
//             '[id*="jobDescriptionTitleHeading"]'
//         ],
//         waitForSelector: '#jobDescriptionTitleHeading',
//         consentSelector: '[id^="onetrust-accept-btn-handler"]',
//         scrollIntoView: true
//     },
//     glassdoor: {
//         selectors: ['.jobDescriptionContent', '.desc', '[data-test="description"]'],
//         waitForSelector: '.jobDescriptionContent'
//     },
//     greenhouse: {
//         selectors: ['#content', '#gh-job-content', '.content-block'],
//         waitForSelector: '#content'
//     },
//     lever: {
//         selectors: ['.posting-description', '.content'],
//         waitForSelector: '.posting-description'
//     }
// };

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

const scrapeJobDescription = async (jobPostingUrl) => {
    console.log('Starting job description scraping for URL:', jobPostingUrl);

    // Special case for Indeed - try direct fetch first
    if (jobPostingUrl.includes('indeed.com')) {
        const jobKey = extractIndeedJobKey(jobPostingUrl);
        if (jobKey) {
            console.log('Detected Indeed job with key:', jobKey);
            const directResult = await fetchIndeedJobDirectly(jobKey);
            if (directResult) {
                console.log('Successfully fetched Indeed job directly');
                return directResult;
            }
            console.log('Direct fetch failed, falling back to browser scraping');
        }
    }

    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--window-size=1920,1080',
            '--user-agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"'
        ]
    });
    console.log('Browser launched with headless mode');

    const page = await browser.newPage();

    // Add page console logs for debugging
    page.on('console', msg => console.log('PAGE CONSOLE:', msg.text()));

    try {
        // Set realistic headers and viewport
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Referer': 'https://www.google.com/'
        });
        await page.setViewport({ width: 1920, height: 1080 });
        console.log('Set user agent, headers, and viewport');

        // Optimize page load by blocking unnecessary resources
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log('Navigating to job posting URL...');
        // Navigate with networkidle2 wait
        await page.goto(jobPostingUrl, {
            waitUntil: 'networkidle2',
            timeout: 90000
        });
        console.log('Successfully loaded the page');

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

        // Take a screenshot for debugging
        await page.screenshot({ path: 'debug-screenshot.png' });
        console.log('Took debug screenshot');

        // Special handling for Indeed pages
        if (platform === 'indeed') {
            console.log('Applying Indeed-specific scraping logic');

            // Try to get job title
            let jobTitle = '';
            for (const titleSelector of platformConfig.titleSelectors) {
                try {
                    console.log('Looking for job title with selector:', titleSelector);
                    const titleElement = await page.$(titleSelector);
                    if (titleElement) {
                        jobTitle = await page.evaluate(el => el.innerText, titleElement);
                        console.log('Found job title:', jobTitle);
                        break;
                    }
                } catch (e) {
                    console.log(`Failed to get title with selector ${titleSelector}:`, e.message);
                }
            }

            // Check for and click "read more" button
            try {
                console.log('Looking for "Read more" button');
                const readMoreSelector = platformConfig.readMoreSelector || 'button[aria-label="Read more"]';
                const readMoreBtn = await page.$(readMoreSelector);
                if (readMoreBtn) {
                    console.log('Found "Read more" button, clicking...');
                    await readMoreBtn.click();
                    await page.waitForTimeout(2000);
                    console.log('Expanded job description');
                } else {
                    console.log('No "Read more" button found');
                }
            } catch (e) {
                console.log('Error handling "Read more" button:', e.message);
            }

            // Try the direct approach with all selectors
            console.log('Trying all Indeed selectors in sequence');
            for (const selector of platformConfig.selectors) {
                try {
                    console.log('Trying selector:', selector);
                    const element = await page.$(selector);
                    if (element) {
                        console.log('Found element with selector:', selector);

                        // Try scrolling to make sure it's in view
                        await page.evaluate(el => {
                            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, element);
                        await page.waitForTimeout(1000);

                        const text = await page.evaluate(el => {
                            // Remove script and style tags
                            el.querySelectorAll('script, style').forEach(node => node.remove());
                            return el.innerText.trim();
                        }, element);

                        if (text && text.length > 100) {
                            console.log(`Successfully extracted text (${text.length} chars) with selector: ${selector}`);
                            console.log('Preview:', text.substring(0, 100) + '...');

                            // If we have a title and description, format a structured response
                            if (jobTitle) {
                                return {
                                    Job_Title: jobTitle,
                                    Job_Description: text,
                                    Platform: 'indeed',
                                    URL: jobPostingUrl
                                };
                            }
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

            // Try an alternative approach with page.evaluate for dynamic content
            console.log('Trying alternative approach with full page evaluation');
            const fullPageExtract = await page.evaluate(() => {
                // Try to find the job description div by common patterns
                const possibleContainers = [
                    document.querySelector('#jobDescriptionText'),
                    document.querySelector('[data-testid="jobDescriptionText"]'),
                    document.querySelector('.jobsearch-JobComponent-description'),
                    document.querySelector('div[class*="jobsearch-JobComponent"]'),
                    // Look for any div with job description in the text or ID
                    ...Array.from(document.querySelectorAll('div')).filter(el =>
                        el.id.toLowerCase().includes('description') ||
                        el.className.toLowerCase().includes('description')
                    )
                ].filter(Boolean);

                // Try to extract meaningful text from each container
                for (const container of possibleContainers) {
                    // Skip tiny elements
                    if (container.offsetWidth < 200 || container.offsetHeight < 100) continue;

                    // Get the text
                    const text = container.innerText.trim();
                    if (text.length > 300) {
                        return text;
                    }
                }

                // As a last resort, try to get all meaningful text from the page
                const bodyText = document.body.innerText;
                // Look for a chunk of text that might be the job description
                const chunks = bodyText.split('\n\n').filter(c => c.trim().length > 300);
                if (chunks.length > 0) {
                    return chunks[0];
                }

                return null;
            });

            if (fullPageExtract) {
                console.log(`Alternative approach found text (${fullPageExtract.length} chars)`);
                console.log('Preview:', fullPageExtract.substring(0, 100) + '...');

                // If we have a title, format a structured response
                if (jobTitle) {
                    return {
                        Job_Title: jobTitle,
                        Job_Description: fullPageExtract,
                        Platform: 'indeed',
                        URL: jobPostingUrl
                    };
                }
                return fullPageExtract;
            }

            // If we found a title but no description, return a basic structure
            if (jobTitle) {
                console.log('Found title but no description, returning basic info');
                return {
                    Job_Title: jobTitle,
                    Job_Description: `This is a job posting for ${jobTitle} position. The full description could not be extracted.`,
                    Platform: 'indeed',
                    URL: jobPostingUrl
                };
            }
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



const generateQuestions = async (JobDescription) => {


    const prompt = `Generate exactly 3 relevant and challenging technical interview questions based on the following job description. The questions should focus on conceptual understanding and require detailed verbal explanations, not code-writing tasks. Avoid asking questions that involve solving problems by writing code. Provide only the questions, without any introductory text, explanations, or formatting:\n\n${JobDescription}`;


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
    const { jobPostingUrl, jobTitle } = req.body;

    if (!jobPostingUrl && !jobTitle) {
        return res.status(400).json({
            status: "-1",
            message: "Either job posting URL or job title is required",
            data: {}
        });
    }

    try {
        console.log(`Generating questions using job posting URL: ${jobPostingUrl}`);

        // Scrape the job description
        let jobData;
        let jobDescription;

        try {
            jobData = await scrapeJobDescription(jobPostingUrl);
            console.log('Raw job data:', typeof jobData === 'object' ? 'Object with properties' : 'Text string');

            // Handle both structured and unstructured job data
            if (typeof jobData === 'object') {
                jobDescription = jobData.Job_Description;
                console.log('Using structured job data with title:', jobData.Job_Title);
            } else {
                jobDescription = jobData;
                console.log('Using unstructured job data');
            }
        } catch (error) {
            console.error('Error scraping job description:', error.message);

            // If scraping fails but jobTitle is provided, use that as fallback
            if (jobTitle) {
                console.log('Using provided job title as fallback:', jobTitle);
                jobData = {
                    Job_Title: jobTitle,
                    Job_Description: `Position for ${jobTitle}`,
                };
                jobDescription = jobData.Job_Description;
            } else {
                throw new Error('Failed to get job description and no job title provided');
            }
        }

        console.log('Final job description length:', jobDescription.length);

        // Generate raw questions based on the description
        const rawQuestions = await generateQuestions(jobDescription);

        // Clean the questions for UI display
        const questions = cleanQuestions(rawQuestions);

        console.log(`Generated ${questions.length} questions`);

        // Respond with questions and the job description
        res.json({
            questions,
            JobDescription: jobDescription
        });
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

