// const express = require('express');
// const puppeteer = require('puppeteer');
// const router = express.Router();
// const { OpenAI } = require('openai');

// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// // Platform-specific selectors
// const PLATFORM_SELECTORS = {
//     linkedin: {
//         selectors: [
//             '.description__text',
//             '.show-more-less-html__markup',
//             '[data-job-description]',
//         ],
//         waitForSelector: '.description__text'
//     },
//     indeed: {
//         selectors: [
//             '#jobDescriptionText',
//             '.jobsearch-JobComponent-description',
//             '[data-testid="jobDescriptionText"]'
//         ],
//         waitForSelector: '#jobDescriptionText'
//     },
//     glassdoor: {
//         selectors: [
//             '.jobDescriptionContent',
//             '.desc',
//             '[data-test="description"]'
//         ],
//         waitForSelector: '.jobDescriptionContent'
//     },
//     greenhouse: {
//         selectors: [
//             '#content',
//             '#gh-job-content',
//             '.content-block'
//         ],
//         waitForSelector: '#content'
//     },
//     lever: {
//         selectors: [
//             '.posting-description',
//             '.content'
//         ],
//         waitForSelector: '.posting-description'
//     },
//     // Add more platforms as needed
// };

// // Helper function to identify the platform from URL
// const identifyPlatform = (url) => {
//     const domain = new URL(url).hostname.toLowerCase();
//     if (domain.includes('linkedin')) return 'linkedin';
//     if (domain.includes('indeed')) return 'indeed';
//     if (domain.includes('glassdoor')) return 'glassdoor';
//     if (domain.includes('greenhouse')) return 'greenhouse';
//     if (domain.includes('lever')) return 'lever';
//     return 'unknown';
// };

// // Enhanced scraping function
// const scrapeJobDescription = async (jobPostingUrl) => {
//     const browser = await puppeteer.launch({
//         headless: true,
//         args: ['--no-sandbox', '--disable-setuid-sandbox']
//     });
//     const page = await browser.newPage();

//     try {
//         // Set default user agent and viewport
//         await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
//         await page.setViewport({ width: 1920, height: 1080 });

//         // Navigate to the page with timeout and wait until network is idle
//         await page.goto(jobPostingUrl, {
//             waitUntil: 'networkidle0',
//             timeout: 30000
//         });

//         // Identify the platform
//         const platform = identifyPlatform(jobPostingUrl);
        
//         // Get platform-specific selectors
//         const platformConfig = PLATFORM_SELECTORS[platform] || {
//             selectors: [
//                 // Generic selectors that might work across different platforms
//                 '[class*="job-description"]',
//                 '[class*="description"]',
//                 '[id*="job-description"]',
//                 '[id*="description"]',
//                 'article',
//                 '.job-posting',
//                 '.job-details'
//             ]
//         };

//         // Wait for content to load
//         if (platformConfig.waitForSelector) {
//             try {
//                 await page.waitForSelector(platformConfig.waitForSelector, { timeout: 5000 });
//             } catch (error) {
//                 console.log(`Couldn't find primary selector for ${platform}, continuing with alternatives`);
//             }
//         }

//         // Try all selectors until we find one that works
//         let jobDescription = '';
//         for (const selector of platformConfig.selectors) {
//             try {
//                 const element = await page.$(selector);
//                 if (element) {
//                     jobDescription = await page.evaluate(el => el.innerText, element);
//                     if (jobDescription && jobDescription.length > 100) {
//                         break;
//                     }
//                 }
//             } catch (error) {
//                 console.log(`Selector ${selector} failed, trying next`);
//             }
//         }

//         // If no selector worked, try getting all text from the body
//         if (!jobDescription) {
//             jobDescription = await page.evaluate(() => {
//                 const body = document.body;
//                 const scriptTags = document.getElementsByTagName('script');
//                 const styleTags = document.getElementsByTagName('style');
                
//                 // Clone body to remove script and style tags
//                 const clone = body.cloneNode(true);
//                 for (const tag of [...scriptTags, ...styleTags]) {
//                     if (tag.parentNode === clone) {
//                         clone.removeChild(tag);
//                     }
//                 }
                
//                 return clone.innerText;
//             });

//             // Basic cleaning of the text
//             jobDescription = jobDescription
//                 .replace(/\s+/g, ' ')
//                 .trim()
//                 .split('\n')
//                 .filter(line => line.length > 30)
//                 .join('\n');
//         }

//         if (!jobDescription) {
//             throw new Error('No job description found on the page');
//         }

//         await browser.close();
//         return jobDescription;
//     } catch (error) {
//         await browser.close();
//         throw new Error(`Failed to scrape job description: ${error.message}`);
//     }
// };

// // Modified question generation function


// const generateQuestions = async (jobDescription) => {
//     const prompt = `As an experienced technical interviewer, generate exactly 3 relevant and challenging technical interview questions based on this job description. Avoid including behavioral or general questions:\n\n${jobDescription}`;

//     const response = await openai.chat.completions.create({
//         model: 'gpt-3.5-turbo',
//         messages: [
//             {
//                 role: 'system',
//                 content: 'You are an expert technical interviewer who creates relevant and challenging technical questions for candidates.'
//             },
//             {
//                 role: 'user',
//                 content: prompt
//             }
//         ],
//         temperature: 0.7,
//     });

//     return response.choices[0].message.content.split('\n').filter(q => q.trim());
// };
// Function to clean the generated questions
// const cleanQuestions = (questions) => {
//     let cleanedQuestions = [];
//     let questionNumber = 1;

//     for (let question of questions) {
      
//         let cleanedQuestion = question.replace(/\*\*/g, '').trim();

     
//         cleanedQuestion = cleanedQuestion.replace(/^Technical Question \d+:/, `Question ${questionNumber}:`);
//         cleanedQuestions.push(cleanedQuestion);

//         questionNumber++;
//     }

//     return cleanedQuestions;
// };

// // Main route handler
// router.post('/generate-questions', async (req, res) => {
//     const { name, email, jobPostingUrl } = req.body;

//     if (!name || !email || !jobPostingUrl) {
//         return res.status(400).json({ error: 'Name, email, and job posting URL are required.' });
//     }

//     try {
//         console.log(`Generating questions for ${name} (${email}) using job posting URL: ${jobPostingUrl}`);
        
//         // Scrape the job description
//         const jobDescription = await scrapeJobDescription(jobPostingUrl);

//         // Generate the raw questions
//         const rawQuestions = await generateQuestions(jobDescription);

//         // Clean the questions for UI display
//         const questions = cleanQuestions(rawQuestions);

//         console.log(`Generated questions: ${questions}`);
        
//         res.json({ 
//             questions,
//             // jobDescription  
//         });
//     } catch (error) {
//         console.error('Error in /generate-questions:', error.message);
//         res.status(500).json({ error: error.message });
//     }
// });

// module.exports = router;



// const express = require('express');
// const multer = require('multer');
// const fs = require('fs');
// const nodemailer = require('nodemailer');
// const { OpenAI } = require('openai');
// const { MongoClient } = require('mongodb');
// const puppeteer = require('puppeteer');
// const ffmpeg = require('fluent-ffmpeg');

// const router = express.Router();
// const upload = multer({ dest: 'uploads/' });
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// const mongoUri = 'mongodb+srv://harishmaneru:Xe2Mz13z83IDhbPW@cluster0.bu3exkw.mongodb.net/?retryWrites=true&w=majority&tls=true';
// const dbName = 'interviewApp';
// const collectionName = 'applicantResponses';

// // Configure nodemailer
// const transporter = nodemailer.createTransport({
//     service: 'gmail',
//     auth: {
//         user: process.env.EMAIL_USER, 
//         pass: process.env.EMAIL_PASSWORD 
//     }
// });

// // Platform-specific selectors
// const PLATFORM_SELECTORS = {
//     linkedin: {
//         selectors: [
//             '.description__text',
//             '.show-more-less-html__markup',
//             '[data-job-description]',
//         ],
//         waitForSelector: '.description__text'
//     },
//     indeed: {
//         selectors: [
//             '#jobDescriptionText',
//             '.jobsearch-JobComponent-description',
//             '[data-testid="jobDescriptionText"]'
//         ],
//         waitForSelector: '#jobDescriptionText'
//     },
//     glassdoor: {
//         selectors: [
//             '.jobDescriptionContent',
//             '.desc',
//             '[data-test="description"]'
//         ],
//         waitForSelector: '.jobDescriptionContent'
//     },
//     greenhouse: {
//         selectors: [
//             '#content',
//             '#gh-job-content',
//             '.content-block'
//         ],
//         waitForSelector: '#content'
//     },
//     lever: {
//         selectors: [
//             '.posting-description',
//             '.content'
//         ],
//         waitForSelector: '.posting-description'
//     },
//     // Add more platforms as needed
// };

// // Helper function to identify the platform from URL
// const identifyPlatform = (url) => {
//     const domain = new URL(url).hostname.toLowerCase();
//     if (domain.includes('linkedin')) return 'linkedin';
//     if (domain.includes('indeed')) return 'indeed';
//     if (domain.includes('glassdoor')) return 'glassdoor';
//     if (domain.includes('greenhouse')) return 'greenhouse';
//     if (domain.includes('lever')) return 'lever';
//     return 'unknown';
// };

// // Enhanced scraping function
// const scrapeJobDescription = async (jobPostingUrl) => {
//     const browser = await puppeteer.launch({
//         headless: true,
//         args: ['--no-sandbox', '--disable-setuid-sandbox']
//     });
//     const page = await browser.newPage();

//     try {
//         // Set default user agent and viewport
//         await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
//         await page.setViewport({ width: 1920, height: 1080 });

//         // Navigate to the page with timeout and wait until network is idle
//         await page.goto(jobPostingUrl, {
//             waitUntil: 'networkidle0',
//             timeout: 30000
//         });

//         // Identify the platform
//         const platform = identifyPlatform(jobPostingUrl);

//         // Get platform-specific selectors
//         const platformConfig = PLATFORM_SELECTORS[platform] || {
//             selectors: [
//                 // Generic selectors that might work across different platforms
//                 '[class*="job-description"]',
//                 '[class*="description"]',
//                 '[id*="job-description"]',
//                 '[id*="description"]',
//                 'article',
//                 '.job-posting',
//                 '.job-details'
//             ]
//         };

//         // Wait for content to load
//         if (platformConfig.waitForSelector) {
//             try {
//                 await page.waitForSelector(platformConfig.waitForSelector, { timeout: 5000 });
//             } catch (error) {
//                 console.log(`Couldn't find primary selector for ${platform}, continuing with alternatives`);
//             }
//         }

//         // Try all selectors until we find one that works
//         let jobDescription = '';
//         for (const selector of platformConfig.selectors) {
//             try {
//                 const element = await page.$(selector);
//                 if (element) {
//                     jobDescription = await page.evaluate(el => el.innerText, element);
//                     if (jobDescription && jobDescription.length > 100) {
//                         break;
//                     }
//                 }
//             } catch (error) {
//                 console.log(`Selector ${selector} failed, trying next`);
//             }
//         }

//         // If no selector worked, try getting all text from the body
//         if (!jobDescription) {
//             jobDescription = await page.evaluate(() => {
//                 const body = document.body;
//                 const scriptTags = document.getElementsByTagName('script');
//                 const styleTags = document.getElementsByTagName('style');

//                 // Clone body to remove script and style tags
//                 const clone = body.cloneNode(true);
//                 for (const tag of [...scriptTags, ...styleTags]) {
//                     if (tag.parentNode === clone) {
//                         clone.removeChild(tag);
//                     }
//                 }

//                 return clone.innerText;
//             });

//             // Basic cleaning of the text
//             jobDescription = jobDescription
//                 .replace(/\s+/g, ' ')
//                 .trim()
//                 .split('\n')
//                 .filter(line => line.length > 30)
//                 .join('\n');
//         }

//         if (!jobDescription) {
//             throw new Error('No job description found on the page');
//         }

//         await browser.close();
//         return jobDescription;
//     } catch (error) {
//         await browser.close();
//         throw new Error(`Failed to scrape job description: ${error.message}`);
//     }
// };

// // Helper function to convert video to text using Whisper API or similar
// const transcribeVideo = async (filePath) => {
//     // Use OpenAI Whisper API or another transcription service here
//     // For demonstration, return placeholder text
//     return `Transcribed text for video: ${filePath}`;
// };

// // Function to generate a rating based on OpenAI analysis
// const generateRating = async (jobDescription, responses) => {
//     const prompt = `Evaluate the following applicant's video responses against the job description. Provide a score for:
//     1. Relevance: How relevant is the applicant's response to the job description?
//     2. Level of Detail: Does the applicant provide detailed and thorough answers?
//     3. Communication: How well does the applicant articulate their responses?

//     Provide a final rating and short notes on performance.

//     Job Description:
//     ${jobDescription}

//     Applicant Responses:
//     ${responses.join('\n\n')}`;

//     const response = await openai.chat.completions.create({
//         model: 'gpt-3.5-turbo',
//         messages: [
//             {
//                 role: 'system',
//                 content: 'You are an expert interviewer providing evaluations of applicant responses based on the given job description.'
//             },
//             {
//                 role: 'user',
//                 content: prompt
//             }
//         ],
//         temperature: 0.7,
//     });

//     return response.choices[0].message.content;
// };

// // Route for processing applicant responses
// router.post('/submit-responses', upload.fields([
//     { name: 'videoResponse1', maxCount: 1 },
//     { name: 'videoResponse2', maxCount: 1 },
//     { name: 'videoResponse3', maxCount: 1 }
// ]), async (req, res) => {
//     const { textAnswer, jobPostingUrl, emails } = req.body;
//     const videos = req.files;
//     const userId = 'hardcodedUserId123'; // Replace with dynamic user ID if needed

//     if (!textAnswer || !jobPostingUrl || !emails || !videos) {
//         return res.status(400).json({ error: 'Text answer, job posting URL, emails, and videos are required.' });
//     }

//     try {
//         // Scrape the job description
//         const jobDescription = await scrapeJobDescription(jobPostingUrl);

//         // Transcribe video responses
//         const videoResponses = [];
//         for (const key of ['videoResponse1', 'videoResponse2', 'videoResponse3']) {
//             if (videos[key]) {
//                 const filePath = videos[key][0].path;
//                 const transcription = await transcribeVideo(filePath);
//                 videoResponses.push(transcription);

//                 // Remove the video file after transcription
//                 fs.unlinkSync(filePath);
//             }
//         }

//         // Generate rating based on responses
//         const rating = await generateRating(jobDescription, [textAnswer, ...videoResponses]);

//         // Store data in MongoDB
//         const client = new MongoClient(mongoUri, { useUnifiedTopology: true });
//         await client.connect();
//         const db = client.db(dbName);
//         const collection = db.collection(collectionName);

//         const applicantData = {
//             userId,
//             textAnswer,
//             videoResponses,
//             jobDescription,
//             rating,
//             submittedAt: new Date()
//         };

//         await collection.insertOne(applicantData);
//         await client.close();

//         // Send emails with the evaluation link
//         const emailRecipients = emails.split(',').map(email => email.trim());
//         const evaluationLink = `https://yourapp.com/evaluation/${userId}`;
//         const emailContent = `The applicant has completed their interview. You can view the evaluation here: ${evaluationLink}`;

//         const mailOptions = {
//             from: process.env.EMAIL_USER,
//             to: emailRecipients,
//             subject: 'Applicant Evaluation Available',
//             text: emailContent
//         };

//         await transporter.sendMail(mailOptions);

//         res.json({ message: 'Responses submitted and evaluated successfully.', evaluationLink });
//     } catch (error) {
//         console.error('Error processing responses:', error.message);
//         res.status(500).json({ error: error.message });
//     }
// });

// module.exports = router;

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const nodemailer = require('nodemailer');
const puppeteer = require('puppeteer');
const { MongoClient } = require('mongodb');
const { convertVideoToAudio, transcribeAudio } = require('../virtualInterviewAPI/videoTotext');
const { OpenAI } = require('openai');

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
const PLATFORM_SELECTORS = {
    linkedin: {
        selectors: ['.description__text', '.show-more-less-html__markup', '[data-job-description]'],
        waitForSelector: '.description__text'
    },
    indeed: {
        selectors: ['#jobDescriptionText', '.jobsearch-JobComponent-description', '[data-testid="jobDescriptionText"]'],
        waitForSelector: '#jobDescriptionText'
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

// Scrape job description
const scrapeJobDescription = async (jobPostingUrl) => {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();

    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.goto(jobPostingUrl, { waitUntil: 'networkidle0', timeout: 30000 });

        const platform = identifyPlatform(jobPostingUrl);
        const platformConfig = PLATFORM_SELECTORS[platform] || {
            selectors: ['[class*="job-description"]', '[class*="description"]', '[id*="job-description"]', 'article']
        };

        for (const selector of platformConfig.selectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    const jobDescription = await page.evaluate((el) => el.innerText, element);
                    if (jobDescription.length > 100) return jobDescription;
                }
            } catch {
                continue;
            }
        }

        throw new Error('No job description found');
    } finally {
        await browser.close();
    }
};

const generateQuestions = async (jobDescription) => {
    const prompt = `As an experienced technical interviewer, generate exactly 3 relevant and challenging technical interview questions based on this job description. Avoid including behavioral or general questions:\n\n${jobDescription}`;

    const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
            {
                role: 'system',
                content: 'You are an expert technical interviewer who creates relevant and challenging technical questions for candidates.'
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
    const { name, email, jobPostingUrl } = req.body;

    if (!name || !email || !jobPostingUrl) {
        return res.status(400).json({ error: 'Name, email, and job posting URL are required.' });
    }

    try {
        console.log(`Generating questions for ${name} (${email}) using job posting URL: ${jobPostingUrl}`);
        
        // Scrape the job description
        const jobDescription = await scrapeJobDescription(jobPostingUrl);

        // Generate the raw questions
        const rawQuestions = await generateQuestions(jobDescription);

        // Clean the questions for UI display
        const questions = cleanQuestions(rawQuestions);

        console.log(`Generated questions: ${questions}`);
        
        res.json({ 
            questions,
            // jobDescription  
        });
    } catch (error) {
        console.error('Error in /generate-questions:', error.message);
        res.status(500).json({ error: error.message });
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
