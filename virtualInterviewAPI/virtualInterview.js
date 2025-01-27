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
        await page.goto(jobPostingUrl, { waitUntil: 'networkidle0', timeout: 60000 });

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
    const { jobPostingUrl } = req.body;

    if (!jobPostingUrl) {
        return res.status(400).json({ error: 'Job posting URL is required.' });
    }

    try {
        console.log(`Generating questions using job posting URL: ${jobPostingUrl}`);

        // Scrape the job description
        const jobDescription = await scrapeJobDescription(jobPostingUrl);
        console.log('raw job description',jobDescription)
  
        // Generate raw questions based on the structured description
        const rawQuestions = await generateQuestions(jobDescription);

        // Clean the questions for UI display
        const questions = cleanQuestions(rawQuestions);

        console.log(`Generated questions: ${questions}`);

        // Respond with questions and the structured job description
        res.json({
            questions,
            JobDescription: jobDescription 
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



// const express = require('express');
// const multer = require('multer');
// const fs = require('fs');
// const nodemailer = require('nodemailer');
// const puppeteer = require('puppeteer');
// const { MongoClient } = require('mongodb');
// const { convertVideoToAudio, transcribeAudio } = require('../virtualInterviewAPI/videoTotext');
// const { OpenAI } = require('openai');

// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// const router = express.Router();

// const storage = multer.diskStorage({
//     destination: function (req, file, cb) {
//         cb(null, 'uploads/')
//     },
//     filename: function (req, file, cb) {
//         cb(null, file.fieldname + '-' + Date.now() + '.mp4')
//     }
// });

// const upload = multer({ 
//     storage: storage,
//     fileFilter: function (req, file, cb) {
//         if (file.mimetype === 'video/mp4') {
//             cb(null, true);
//         } else {
//             cb(new Error('Only MP4 videos are allowed'), false);
//         }
//     }
// });

// const mongoUri = 'mongodb+srv://harishmaneru:Xe2Mz13z83IDhbPW@cluster0.bu3exkw.mongodb.net/?retryWrites=true&w=majority&tls=true';
// const dbName = 'interviewApp';
// const collectionName = 'applicantResponses';

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
//         selectors: ['.description__text', '.show-more-less-html__markup', '[data-job-description]'],
//         waitForSelector: '.description__text'
//     },
//     indeed: {
//         selectors: ['#jobDescriptionText', '.jobsearch-JobComponent-description', '[data-testid="jobDescriptionText"]'],
//         waitForSelector: '#jobDescriptionText'
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

// // Helper to identify platform from URL
// const identifyPlatform = (url) => {
//     const domain = new URL(url).hostname.toLowerCase();
//     if (domain.includes('linkedin')) return 'linkedin';
//     if (domain.includes('indeed')) return 'indeed';
//     if (domain.includes('glassdoor')) return 'glassdoor';
//     if (domain.includes('greenhouse')) return 'greenhouse';
//     if (domain.includes('lever')) return 'lever';
//     return 'unknown';
// };

// // Scrape job description
// const scrapeJobDescription = async (jobPostingUrl) => {
//     const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
//     const page = await browser.newPage();

//     try {
//         await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
//         await page.goto(jobPostingUrl, { waitUntil: 'networkidle0', timeout: 30000 });

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
// // Function to clean the generated questions
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


// router.post('/submit-responses', upload.fields([
//     { name: 'videoResponse1', maxCount: 1 },
//     { name: 'videoResponse2', maxCount: 1 },
//     { name: 'videoResponse3', maxCount: 1 }
// ]), async (req, res) => {
//     console.log('Incoming request body:', req.body);
//     console.log('Incoming files:', req.files);

//     const { 
//         textAnswer, 
//         jobPostingUrl, 
//         replyEmails,  // Change from 'emails' to 'replyEmails'
//         linkType,
//         passcode 
//     } = req.body;
//     const videos = req.files;

//     // Validate that all required fields are present
//     if (
//         !textAnswer ||
//         !jobPostingUrl ||
//         !replyEmails ||  // Use replyEmails instead of emails
//         !videos.videoResponse1 ||
//         !videos.videoResponse2 ||
//         !videos.videoResponse3
//     ) {
//         return res.status(400).json({ 
//             error: 'Required fields are missing.',
//             details: {
//                 textAnswer: !!textAnswer,
//                 jobPostingUrl: !!jobPostingUrl,
//                 replyEmails: !!replyEmails,
//                 videoResponse1: !!videos.videoResponse1,
//                 videoResponse2: !!videos.videoResponse2,
//                 videoResponse3: !!videos.videoResponse3
//             }
//         });
//     }


//     try {
//         console.log('Scraping job description...');
//         const jobDescription = await scrapeJobDescription(jobPostingUrl);

//         console.log('Processing video responses...');
//         const videoResponses = [];
//         for (const key of ['videoResponse1', 'videoResponse2', 'videoResponse3']) {
//             if (videos[key]) {
//                 try {
//                     const videoPath = videos[key][0].path;
//                     const audioPath = await convertVideoToAudio(videoPath);
//                     const transcription = await transcribeAudio(audioPath);
//                     videoResponses.push(transcription);

//                     fs.unlinkSync(audioPath);
//                     fs.unlinkSync(videoPath);
//                 } catch (error) {
//                     console.error(`Error processing video ${key}:`, error);
//                 }
//             }
//         }

//         console.log('Generating rating...');
//         const rating = await generateRating(jobDescription, [textAnswer, ...videoResponses]);

//         console.log('Saving to MongoDB...');
//         const client = new MongoClient(mongoUri, { useUnifiedTopology: true });
//         await client.connect();
//         const db = client.db(dbName);
//         const collection = db.collection(collectionName);

//         await collection.insertOne({
//             textAnswer,
//             videoResponses,
//             jobDescription,
//             rating,
//             submittedAt: new Date()
//         });
//         await client.close();

//         console.log('Sending email...');
//         const emailRecipients = emails.split(',').map((email) => email.trim());
//         const emailContent = `Applicant responses and ratings have been completed. View them here: [Link to Application]`;

//         await transporter.sendMail({
//             from: process.env.EMAIL_USER,
//             to: emailRecipients,
//             subject: 'Applicant Evaluation Available',
//             text: emailContent
//         });

//         res.json({ message: 'Responses submitted and evaluated successfully.' });
//     } catch (error) {
//         console.error('Error in /submit-responses:', error);
//         res.status(500).json({ error: error.message });
//     }
// });

// module.exports = router;
