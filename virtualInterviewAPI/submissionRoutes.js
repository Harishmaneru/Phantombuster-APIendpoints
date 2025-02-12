const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: {
        fileSize: 500 * 1024 * 1024 
    }
}).any();

const logSubmissionActivity = (stage, data) => {
    console.log(`[${new Date().toISOString()}] Submission ${stage}:`, JSON.stringify(data, null, 2));
};

// Verify database connection
const verifyDbConnection = () => {
    const state = mongoose.connection.readyState;
    const states = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
    };
    return states[state] || 'unknown';
};

 
const SubmissionSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    applicantName: { type: String, required: true },
    email: { type: String, required: true },
    textQuestion: { type: String, required: true },
    textResponse: { type: String, required: true },
    videoResponses: [{
        questionIndex: { type: Number, required: true },
        question: { type: String, required: true },
        videoUrl: { type: String, required: true },
        fileName: { type: String },
        mimeType: { type: String }
    }],
    submittedAt: { type: Date, default: Date.now }
}, {
    writeConcern: { w: 1, j: false },
    bufferCommands: false
});


const Submission = mongoose.model('Submission', SubmissionSchema);

async function connectDB() {
    if (mongoose.connection.readyState === 1) {
        logSubmissionActivity('DB Status', { status: 'Already connected' });
        return;
    }

    const mongoURI = process.env.MONGODB_URI;
    const options = {
        serverSelectionTimeoutMS: 60000,
        socketTimeoutMS: 120000,
        connectTimeoutMS: 60000,
        maxPoolSize: 10,
        wtimeoutMS: 30000,
        keepAlive: true,
        keepAliveInitialDelay: 300000
    };

    try {
        logSubmissionActivity('DB Connection Attempt', { uri: mongoURI.replace(/\/\/.*@/, '//****@') });
        await mongoose.connect(mongoURI, options);
        logSubmissionActivity('DB Connection', { status: 'success' });
    } catch (err) {
        logSubmissionActivity('DB Connection Error', { 
            error: err.message,
            stack: err.stack
        });
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

// Handle file upload
const handleUpload = (req, res, next) => {
    upload(req, res, function (err) {
        if (err) {
            return res.status(400).json({
                success: false,
                message: err.message
            });
        }
        next();
    });
};

router.post('/submit', ensureDbConnection, handleUpload, async (req, res) => {
    const session = await mongoose.startSession();
    let savedId = null;

    try {
        logSubmissionActivity('Request Received', {
            userId: req.body.userId,
            applicantName: req.body.applicantName,
            email: req.body.email,
            filesCount: req?.files?.length || 0
        });

        const dbState = verifyDbConnection();
        logSubmissionActivity('DB State Check', { state: dbState });
        
        if (dbState !== 'connected') {
            throw new Error(`Database not properly connected. Current state: ${dbState}`);
        }

        const { 
            userId, 
            applicantName, 
            email, 
            textResponse, 
            textQuestion 
        } = req.body;

        // Enhanced validation
        if (!userId || !applicantName || !email || !textResponse || !textQuestion || !req.files || req.files.length === 0) {
            logSubmissionActivity('Validation Error', { 
                missing: {
                    userId: !userId,
                    applicantName: !applicantName,
                    email: !email,
                    textResponse: !textResponse,
                    textQuestion: !textQuestion,
                    files: !req.files || req.files.length === 0
                }
            });
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        // Process video files with questions
        const videoResponses = req.files.map((file, index) => {
            const questionNumber = index + 1;
            const question = req.body[`videoQuestion${questionNumber}`];

            logSubmissionActivity('Processing File', {
                index,
                fileName: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
                question
            });

            return {
                questionIndex: questionNumber,
                question: question,
                videoUrl: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
                fileName: file.originalname,
                mimeType: file.mimetype
            };
        });

        logSubmissionActivity('Transaction Start', { sessionId: session.id });
        session.startTransaction();

        const submission = new Submission({
            userId,
            applicantName,
            email,
            textQuestion,
            textResponse,
            videoResponses
        });

        const savedSubmission = await submission.save({ session });
        savedId = savedSubmission._id;
        
        const verifySubmission = await Submission.findById(savedId).session(session);
        
        if (!verifySubmission) {
            throw new Error('Submission verification failed');
        }

        logSubmissionActivity('Submission Saved', { 
            submissionId: savedId,
            verified: !!verifySubmission
        });

        await session.commitTransaction();
        logSubmissionActivity('Transaction Committed', { submissionId: savedId });

        res.status(201).json({
            success: true,
            message: 'Submission saved successfully',
            data: {
                submissionId: savedId,
                submittedAt: new Date()
            }
        });

    } catch (err) {
        logSubmissionActivity('Error', {
            error: err.message,
            stack: err.stack,
            phase: savedId ? 'post-save' : 'pre-save'
        });

        await session.abortTransaction();
        logSubmissionActivity('Transaction Aborted', { error: err.message });

        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: 'Failed to process submission',
                error: err.message
            });
        }
    } finally {
        session.endSession();
        logSubmissionActivity('Session Ended', { 
            submissionId: savedId,
            success: !!savedId 
        });
    }
});

router.get('/submissions/:userId', ensureDbConnection, async (req, res) => {
    try {
        const { userId } = req.params;
        const { includeVideos, page = 1, limit = 50 } = req.query;

        // Add input validation
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        // Convert page and limit to numbers
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        // Add logging for debugging
        console.log('Query params:', { userId, includeVideos, page, limit });
        console.log('Skip:', skip);

 
        const projection = includeVideos === 'true' ? {} : { videoResponses: 0 };

        
        const submissions = await Submission.collection.find(
            { userId: userId.toString() },  
            { projection }
        )
            .sort({ submittedAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .allowDiskUse(true)   
            .toArray();

        // Add logging for debugging
        console.log('Found submissions:', submissions.length);

        // Send response with more details
        res.status(200).json({
            success: true,
            data: submissions,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: submissions.length
            }
        });
    } catch (err) {
        console.error('Error fetching submissions:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Failed to fetch submissions'
        });
    }
});

module.exports = router;