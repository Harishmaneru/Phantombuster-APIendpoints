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

 
const SubmissionSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    applicantName: { type: String, required: true },
    email: { type: String, required: true },
    textResponse: { type: String, required: true },
    videoResponses: [{
        questionIndex: { type: Number, required: true },
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

// MongoDB connection with optimized settings
async function connectDB() {
    if (mongoose.connection.readyState === 1) return;

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
        await mongoose.connect(mongoURI, options);
        console.log('MongoDB connected');
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

// Submit endpoint with optimized saving
router.post('/submit', ensureDbConnection, handleUpload, async (req, res) => {
    const session = await mongoose.startSession();
    let savedId = null;

    try {
        const { userId, applicantName, email, textResponse } = req.body;

        if (!userId || !applicantName || !email || !textResponse || !req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        // Process video files
        const videoResponses = req.files.map((file, index) => ({
            questionIndex: index + 1,
            videoUrl: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
            fileName: file.originalname,
            mimeType: file.mimetype
        }));

        // Start transaction
        session.startTransaction();

        // Create submission
        const submission = new Submission({
            userId,
            applicantName,
            email,
            textResponse,
            videoResponses
        });

        // Save with transaction
        await submission.save({ session });
        savedId = submission._id;
        // Send success response
        res.status(201).json({
            success: true,
            message: 'Submission saved successfully',
            data: {
                submissionId: savedId,
                submittedAt: new Date()
            }
        });

    } catch (err) {
        console.error('Error in submission:', err);
        await session.abortTransaction();

        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: 'Failed to process submission'
            });
        }
    } finally {
        session.endSession();
    }
});
// Get submissions list with pagination and optional video data
router.get('/submissions/:userId', ensureDbConnection, async (req, res) => {
    try {
        const { userId } = req.params;
        const { includeVideos, page = 1, limit = 50 } = req.query;

        const skip = (page - 1) * limit;

        // Projection based on query parameter
        const projection = includeVideos === 'true' ? {} : { videoResponses: 0 };

        // Execute query with disk-based sorting enabled
        const submissions = await Submission.collection.find(
            { userId },
            { projection }
        )
            .sort({ submittedAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .allowDiskUse(true)  // Enable disk-based sorting
            .toArray();

        res.status(200).json({
            success: true,
            data: submissions
        });
    } catch (err) {
        console.error('Error fetching submissions:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch submissions'
        });
    }
});

module.exports = router;
