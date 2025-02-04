const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');

// Configure multer for handling video uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: {
        fileSize: 500 * 1024 * 1024 // 500MB limit for video files
    }
});

// Schema definitions
const SubmissionSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    interviewId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Interview',
        required: true 
    },
    applicationLink: { type: String, required: true },
    textAnswer: { type: String, required: true },
    videoResponses: [{
        questionIndex: { type: Number, required: true },
        videoUrl: { type: String, required: true },
        duration: { type: Number },
        mimeType: { type: String }
    }],
    submittedAt: { type: Date, default: Date.now },
    status: { 
        type: String, 
        enum: ['pending', 'reviewed', 'shortlisted', 'rejected'], 
        default: 'pending' 
    }
});

// Create index for faster querying
SubmissionSchema.index({ userId: 1, interviewId: 1 });
SubmissionSchema.index({ applicationLink: 1 });

const Submission = mongoose.model('Submission', SubmissionSchema);

// MongoDB connection function
async function connectDB() {
    if (mongoose.connection.readyState === 1) {
        return; // Already connected
    }

    const mongoURI = process.env.MONGODB_URI;
    try {
        await mongoose.connect(mongoURI, {
            serverSelectionTimeoutMS: 15000,
            socketTimeoutMS: 45000,
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('submissionRoutes: MongoDB connected');
    } catch (err) {
        console.error('MongoDB connection error:', err);
        throw err;
    }
}

// Middleware to ensure database connection
const ensureDbConnection = async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Database connection failed'
        });
    }
};

// Create submission endpoint
router.post('/submit', ensureDbConnection, upload.array('videoResponses', 3), async (req, res) => {
    try {
        const { userId, applicationLink, textAnswer } = req.body;

        if (!userId || !applicationLink || !textAnswer || !req.files || req.files.length !== 3) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields or videos'
            });
        }

        // Find the associated interview
        const interview = await mongoose.model('Interview').findOne({
            applicationLink,
            status: 'active',
            expiresAt: { $gt: new Date() }
        });

        if (!interview) {
            return res.status(404).json({
                success: false,
                message: 'Interview not found or expired'
            });
        }

        // Process video files
        const videoResponses = req.files.map((file, index) => ({
            questionIndex: index,
            videoUrl: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
            duration: req.body[`duration${index}`],
            mimeType: file.mimetype
        }));

        // Create submission
        const submission = new Submission({
            userId,
            interviewId: interview._id,
            applicationLink,
            textAnswer,
            videoResponses
        });

        await submission.save();

        res.status(201).json({
            success: true,
            message: 'Submission created successfully',
            data: {
                submissionId: submission._id,
                submittedAt: submission.submittedAt
            }
        });
    } catch (err) {
        console.error('Error creating submission:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to create submission'
        });
    }
});

// Get submissions list
router.get('/submissions/:userId', ensureDbConnection, async (req, res) => {
    try {
        const { userId } = req.params;
        const { status, page = 1, limit = 10 } = req.query;

        const query = { userId };
        if (status) {
            query.status = status;
        }

        const skip = (page - 1) * limit;

        const submissions = await Submission.find(query)
            .populate('interviewId', 'interviewTitle companyUrl jobPostingUrl')
            .sort({ submittedAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .select('-videoResponses');

        const total = await Submission.countDocuments(query);

        res.status(200).json({
            success: true,
            data: {
                submissions,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalSubmissions: total
                }
            }
        });
    } catch (err) {
        console.error('Error fetching submissions:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch submissions'
        });
    }
});

// Get single submission
router.get('/submission/:submissionId', ensureDbConnection, async (req, res) => {
    try {
        const { submissionId } = req.params;

        const submission = await Submission.findById(submissionId)
            .populate('interviewId', 'interviewTitle companyUrl jobPostingUrl questions');

        if (!submission) {
            return res.status(404).json({
                success: false,
                message: 'Submission not found'
            });
        }

        res.status(200).json({
            success: true,
            data: submission
        });
    } catch (err) {
        console.error('Error fetching submission details:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch submission details'
        });
    }
});

module.exports = router;