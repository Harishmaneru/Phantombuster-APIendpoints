// const express = require('express');
// const router = express.Router();
// const multer = require('multer');
// const mongoose = require('mongoose');

// // Database connection
// const mongoURI = process.env.MONGODB_URI;
// mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 15000, socketTimeoutMS: 45000 })
//     .then(() => console.log('createVI: MongoDB connected'))
//     .catch(err => console.error('MongoDB connection error:', err));

// // Configure multer for handling file uploads
// const storage = multer.memoryStorage();
// const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// // Schema for storing interview details
// const InterviewSchema = new mongoose.Schema({
//     userId: { type: String, required: true },
//     email: { type: String, required: true },
//     interviewTitle: { type: String, required: true },
//     jobPostingUrl: { type: String, required: true },
//     companyUrl: String,
//     companyLogoUrl: String, // Store logo as a URL or base64 string
//     questions: { type: [String], required: true },
//     replyEmails: { type: [String], validate: v => Array.isArray(v) && v.every(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) },
//     applicationLink: { type: String, unique: true, required: true },
//     createdAt: { type: Date, default: Date.now },
//     expiresAt: { type: Date, required: true },
//     status: { type: String, enum: ['active', 'expired', 'deleted'], default: 'active' }
// });

// const Interview = mongoose.model('Interview', InterviewSchema);

// // Helper function to generate a unique application link
// function generateUniqueLink() {
//     const timestamp = Date.now().toString(36);
//     const randomString = Math.random().toString(36).substr(2, 6);
//     return `${timestamp}-${randomString}`;
// }

// // Create interview link route

// router.post('/interviewlink', upload.single('companyLogo'), async (req, res) => {
//     try {
//         const { userId, interviewTitle, email, jobPostingUrl, companyUrl, questions, replyEmails } = req.body;

//         if (!userId || !interviewTitle || !email || !jobPostingUrl || !questions) {
//             return res.status(400).json({ success: false, message: 'Missing required fields' });
//         }

//         const applicationLink = generateUniqueLink();
//         const expiresAt = new Date();
//         expiresAt.setDate(expiresAt.getDate() + 15);

//         const companyLogoUrl = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null;

//         const parsedQuestions = Array.isArray(questions) ? questions : JSON.parse(questions);

//         const interview = new Interview({
//             userId,
//             interviewTitle,
//             email,
//             jobPostingUrl,
//             companyUrl,
//             companyLogoUrl,
//             questions: parsedQuestions,
//             replyEmails: replyEmails ? replyEmails.split(',').map(email => email.trim()) : [],
//             applicationLink,
//             expiresAt
//         });

//         await interview.save();

//         res.status(201).json({
//             success: true,
//             message: 'Interview created successfully',
//             data: {
//                 applicationLink: `https://www.recordedinterview.com/InterviewPage/${applicationLink}`,
//                 expiresAt,
//                 interviewTitle,
//                 email,
//                 jobPostingUrl,
//                 companyUrl,
//                 questions: parsedQuestions,
//                 numberOfQuestions: parsedQuestions.length
//             }
//         });
//     } catch (err) {
//         console.error('Error creating interview:', err);
//         res.status(500).json({ success: false, message: 'Failed to create interview' });
//     }
// });


// // Fetch interview details route
// router.get('/interview/:linkId', async (req, res) => {
//     try {
//         const { linkId } = req.params;

//         const interview = await Interview.findOne({ applicationLink: linkId, status: 'active', expiresAt: { $gt: new Date() } });
//         if (!interview) {
//             return res.status(404).json({ success: false, message: 'Interview not found or expired' });
//         }

//         res.status(200).json({
//             success: true,
//             data: {
//                 userId: interview.userId,
//                 interviewTitle: interview.interviewTitle,
//                 email: interview.email,
//                 jobPostingUrl: interview.jobPostingUrl,
//                 companyUrl: interview.companyUrl,
//                 questions: interview.questions,
//                 companyLogoUrl: interview.companyLogoUrl,
//                 replyEmails: interview.replyEmails,
//                 expiresAt: interview.expiresAt
//             }
//         });
//     } catch (err) {
//         console.error('Error fetching interview:', err);
//         res.status(500).json({ success: false, message: 'Failed to fetch interview details' });
//     }
// });

// // Health check endpoint
// router.get('/health', (req, res) => {
//     res.json({ success: true, dbStatus: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
// });

// module.exports = router;


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
    email: { type: String, required: true },
    interviewTitle: { type: String, required: true },
    jobPostingUrl: { type: String, required: true },
    companyUrl: String,
    companyLogoUrl: String, // Store logo as a URL or base64 string
    questions: { type: [String], required: true },
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
        const { userId, interviewTitle, email, jobPostingUrl, companyUrl, questions } = req.body;

        if (!userId || !interviewTitle || !email || !jobPostingUrl || !questions) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const applicationLink = generateUniqueLink();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 15);

        const companyLogoUrl = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null;

        const parsedQuestions = Array.isArray(questions) ? questions : JSON.parse(questions);

        const interview = new Interview({
            userId,
            interviewTitle,
            email,
            jobPostingUrl,
            companyUrl,
            companyLogoUrl,
            questions: parsedQuestions,
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
                email,
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


// Add this endpoint to your existing router file

// router.get('/allinterviews', async (req, res) => {
//     try {
//         // Extract query parameters with default values
//         const page = parseInt(req.query.page) || 1;
//         const limit = parseInt(req.query.limit) || 10;
//         const status = req.query.status || 'active';
//         const userId = req.query.userId;
        
//         // Calculate skip value for pagination
//         const skip = (page - 1) * limit;
        
//         // Build the filter object
//         const filter = { status };
        
//         // Add userId filter if provided
//         if (userId) {
//             filter.userId = userId;
//         }
        
//         // Add date filter to exclude expired interviews if status is active
//         if (status === 'active') {
//             filter.expiresAt = { $gt: new Date() };
//         }
        
//         // Execute the query with pagination
//         const interviews = await Interview.find(filter)
//             .select('-companyLogoUrl') // Exclude large binary data
//             .sort({ createdAt: -1 }) // Sort by creation date, newest first
//             .skip(skip)
//             .limit(limit);
            
//         // Get total count for pagination
//         const totalCount = await Interview.countDocuments(filter);
        
//         // Calculate pagination metadata
//         const totalPages = Math.ceil(totalCount / limit);
//         const hasNextPage = page < totalPages;
//         const hasPreviousPage = page > 1;
        
//         // Transform the data for response
//         const transformedInterviews = interviews.map(interview => ({
//             id: interview._id,
//             userId: interview.userId,
//             interviewTitle: interview.interviewTitle,
//             email: interview.email,
//             jobPostingUrl: interview.jobPostingUrl,
//             questions: interview.questions,
//             applicationLink: `https://www.recordedinterview.com/InterviewPage/${interview.applicationLink}`,
//             createdAt: interview.createdAt,
//             expiresAt: interview.expiresAt,
//             status: interview.status,
//             numberOfQuestions: interview.questions.length
//         }));
        
//         res.status(200).json({
//             success: true,
//             data: {
//                 interviews: transformedInterviews,
//                 pagination: {
//                     currentPage: page,
//                     totalPages,
//                     totalItems: totalCount,
//                     hasNextPage,
//                     hasPreviousPage,
//                     pageSize: limit
//                 }
//             }
//         });
//     } catch (err) {
//         console.error('Error fetching interviews:', err);
//         res.status(500).json({ 
//             success: false, 
//             message: 'Failed to fetch interviews',
//             error: process.env.NODE_ENV === 'development' ? err.message : undefined
//         });
//     }
// });
router.get('/allinterviews', async (req, res) => {
    try {
        // Extract query parameters
        const status = req.query.status || 'active';
        const userId = req.query.userId;
        const page = Math.max(parseInt(req.query.page) || 1, 1); // Ensure page is at least 1
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100); // Limit between 1 and 100

        // Build the filter object
        const filter = { status };
        if (userId) {
            filter.userId = userId;
        }
        if (status === 'active') {
            filter.expiresAt = { $gt: new Date() };
        }

        // Calculate skip value for pagination
        const skip = (page - 1) * limit;

        // Fetch paginated interviews
        const interviews = await Interview.find(filter)
            .select('-companyLogoUrl') // Exclude large binary data
            .sort({ createdAt: -1 }) // Sort by newest first
            .skip(skip)
            .limit(limit);

        // Get total count for pagination
        const totalCount = await Interview.countDocuments(filter);
        const totalPages = Math.ceil(totalCount / limit);
        const hasNextPage = page < totalPages;
        const hasPreviousPage = page > 1;

        // Transform the data
        const transformedInterviews = interviews.map(interview => ({
            id: interview._id,
            userId: interview.userId,
            interviewTitle: interview.interviewTitle,
            email: interview.email,
            jobPostingUrl: interview.jobPostingUrl,
            questions: interview.questions,
            applicationLink: `https://www.recordedinterview.com/InterviewPage/${interview.applicationLink}`,
            createdAt: interview.createdAt,
            expiresAt: interview.expiresAt,
            status: interview.status,
            numberOfQuestions: interview.questions.length
        }));

        // Send paginated response
        res.status(200).json({
            success: true,
            data: {
                interviews: transformedInterviews,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems: totalCount,
                    hasNextPage,
                    hasPreviousPage,
                    pageSize: limit
                }
            }
        });

    } catch (err) {
        console.error('Error fetching interviews:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch interviews',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
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
                email: interview.email,
                jobPostingUrl: interview.jobPostingUrl,
                companyUrl: interview.companyUrl,
                questions: interview.questions,
                companyLogoUrl: interview.companyLogoUrl,
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
