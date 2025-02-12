const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');
const storage = multer.memoryStorage();
const compression = require('compression');

router.use(compression());

const upload = multer({
    storage,
    limits: {
        fileSize: 200 * 1024 * 1024 
    }
}).any();

 
const SubmissionSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    applicantName: { type: String, required: true },
    email: { type: String, required: true },
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
    writeConcern: { w: 1, j: true },  
    timestamps: true
    
});
SubmissionSchema.index({ userId: 1, submittedAt: -1 });
const Submission = mongoose.model('Submission', SubmissionSchema);

const connectDB = async () => {
    if (mongoose.connection.readyState === 1) return;

    const mongoURI = process.env.MONGODB_URI;
    const options = {
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 30000,
        maxPoolSize: 50,
        minPoolSize: 10,
        wtimeoutMS: 2500,
        keepAlive: true,
        keepAliveInitialDelay: 300000,
        retryWrites: true,
        useNewUrlParser: true,
        useUnifiedTopology: true
    };

    try {
        await mongoose.connect(mongoURI, options);
        console.log('MongoDB connected successfully');
    } catch (err) {
        console.error('MongoDB connection error:', err);
        throw err;
    }
};

const processedRequests = new Set();
const DEDUP_TIMEOUT = 3600000; // 1 hour

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


router.post('/submit', async (req, res) => {
    const requestId = req.headers['x-request-id'];
    
    if (processedRequests.has(requestId)) {
        return res.status(200).json({
            success: true,
            message: 'Submission already processed',
            duplicate: true
        });
    }

    let session;
    try {
        session = await mongoose.startSession();
        session.startTransaction();

        const { userId, applicantName, email, textResponse } = req.body;
        const questions = JSON.parse(req.body.questions);
        const videoMetadata = JSON.parse(req.body.videoMetadata);

        const videoResponses = req.files.map((file, index) => ({
            questionIndex: videoMetadata[index].index + 1,
            question: videoMetadata[index].question,
            videoUrl: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
            fileName: file.originalname,
            mimeType: file.mimetype
        }));

        const submission = new Submission({
            userId,
            applicantName,
            email,
            textResponse,
            videoResponses
        });

        await submission.save({ session });
        await session.commitTransaction();

        processedRequests.add(requestId);
        setTimeout(() => processedRequests.delete(requestId), DEDUP_TIMEOUT);

        res.status(201).json({
            success: true,
            message: 'Submission saved successfully',
            submissionId: submission._id
        });

    } catch (error) {
        if (session) {
            await session.abortTransaction();
        }
        console.error('Submission error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to process submission'
        });
    } finally {
        if (session) {
            session.endSession();
        }
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

        // Projection based on query parameter
        const projection = includeVideos === 'true' ? {} : { videoResponses: 0 };

        // Execute query with disk-based sorting enabled
        const submissions = await Submission.collection.find(
            { userId: userId.toString() }, // Ensure userId is string
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
