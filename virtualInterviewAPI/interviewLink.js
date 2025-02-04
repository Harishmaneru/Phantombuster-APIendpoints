const express = require('express');
const router = express.Router();
const multer = require('multer');
const mongoose = require('mongoose');

// Database connection
const mongoURI = process.env.MONGODB_URI;
mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 15000, socketTimeoutMS: 45000 })
    .then(() => console.log('createVI: MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err));

// Configure multer for handling file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Schema for storing interview details
const InterviewSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    interviewTitle: { type: String, required: true },
    jobPostingUrl: { type: String, required: true },
    companyUrl: String,
    companyLogoUrl: String, // Store logo as a URL or base64 string
    questions: { type: [String], required: true },
    replyEmails: { type: [String], validate: v => Array.isArray(v) && v.every(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) },
    applicationLink: { type: String, unique: true, required: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    status: { type: String, enum: ['active', 'expired', 'deleted'], default: 'active' }
});

const Interview = mongoose.model('Interview', InterviewSchema);

// Helper function to generate a unique application link
function generateUniqueLink() {
    const timestamp = Date.now().toString(36);
    const randomString = Math.random().toString(36).substr(2, 6);
    return `${timestamp}-${randomString}`;
}

// Create interview link route

router.post('/interviewlink', upload.single('companyLogo'), async (req, res) => {
    try {
        const { userId, interviewTitle, jobPostingUrl, companyUrl, questions, replyEmails } = req.body;

        if (!userId || !interviewTitle || !jobPostingUrl || !questions) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const applicationLink = generateUniqueLink();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        const companyLogoUrl = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null;

        const parsedQuestions = Array.isArray(questions) ? questions : JSON.parse(questions);

        const interview = new Interview({
            userId,
            interviewTitle,
            jobPostingUrl,
            companyUrl,
            companyLogoUrl,
            questions: parsedQuestions,
            replyEmails: replyEmails ? replyEmails.split(',').map(email => email.trim()) : [],
            applicationLink,
            expiresAt
        });

        await interview.save();

        res.status(201).json({
            success: true,
            message: 'Interview created successfully',
            data: {
                applicationLink: `https://www.recordedinterview.com/InterviewPage/${applicationLink}`,
                expiresAt,
                interviewTitle,
                jobPostingUrl,
                companyUrl,
                questions: parsedQuestions,
                numberOfQuestions: parsedQuestions.length
            }
        });
    } catch (err) {
        console.error('Error creating interview:', err);
        res.status(500).json({ success: false, message: 'Failed to create interview' });
    }
});


// Fetch interview details route
router.get('/interview/:linkId', async (req, res) => {
    try {
        const { linkId } = req.params;

        const interview = await Interview.findOne({ applicationLink: linkId, status: 'active', expiresAt: { $gt: new Date() } });
        if (!interview) {
            return res.status(404).json({ success: false, message: 'Interview not found or expired' });
        }

        res.status(200).json({
            success: true,
            data: {
                userId: interview.userId,
                interviewTitle: interview.interviewTitle,
                jobPostingUrl: interview.jobPostingUrl,
                companyUrl: interview.companyUrl,
                questions: interview.questions,
                companyLogoUrl: interview.companyLogoUrl,
                replyEmails: interview.replyEmails,
                expiresAt: interview.expiresAt
            }
        });
    } catch (err) {
        console.error('Error fetching interview:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch interview details' });
    }
});

// Health check endpoint
router.get('/health', (req, res) => {
    res.json({ success: true, dbStatus: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

module.exports = router;
