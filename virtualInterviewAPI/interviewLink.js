// const express = require('express');
// const router = express.Router();
// const multer = require('multer');
// const crypto = require('crypto');
// const mongoose = require('mongoose');

// // First, let's set up our MongoDB connection with proper configuration
// const mongooseOptions = {
//     serverSelectionTimeoutMS: 15000,
//     socketTimeoutMS: 45000,
// };


// // Establish database connection before proceeding with routes
// const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/vdoqo';
// mongoose.connect(mongoURI, mongooseOptions)
//     .then(() => console.log('MongoDB connection established successfully'))
//     .catch(err => {
//         console.error('MongoDB connection error:', err);
//         process.exit(1);
//     });

// // Handle connection events for better error monitoring
// mongoose.connection.on('error', (err) => {
//     console.error('MongoDB connection error:', err);
// });

// mongoose.connection.on('disconnected', () => {
//     console.log('MongoDB disconnected. Attempting to reconnect...');
// });

// // Configure multer for handling file uploads in memory
// const storage = multer.memoryStorage();
// const upload = multer({ 
//     storage,
//     limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit for company logos
// });

// // Interview Link Schema with improved indexing and validation
// const InterviewLinkSchema = new mongoose.Schema({
//     userId: {
//         type: String,
//         required: [true, 'User ID is required'],
//         index: true
//     },
//     interviewTitle: {
//         type: String,
//         required: [true, 'Interview title is required'],
//         trim: true
//     },
//     jobPostingUrl: {
//         type: String,
//         required: [true, 'Job posting URL is required'],
//         trim: true,
//         validate: {
//             validator: function(v) {
//                 try {
//                     new URL(v);
//                     return true;
//                 } catch (err) {
//                     return false;
//                 }
//             },
//             message: 'Please enter a valid URL'
//         }
//     },
//     companyUrl: {
//         type: String,
//         trim: true,
//         validate: {
//             validator: function(v) {
//                 if (!v) return true; // Optional field
//                 try {
//                     new URL(v);
//                     return true;
//                 } catch (err) {
//                     return false;
//                 }
//             },
//             message: 'Please enter a valid URL'
//         }
//     },
//     companyLogo: {
//         data: Buffer,
//         contentType: String
//     },
//     questions: [{
//         type: String,
//         required: true,
//         validate: {
//             validator: function(v) {
//                 return v.length > 0;
//             },
//             message: 'Questions cannot be empty'
//         }
//     }],
//     replyEmails: [{
//         type: String,
//         trim: true,
//         validate: {
//             validator: function(v) {
//                 return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
//             },
//             message: 'Please enter valid email addresses'
//         }
//     }],
//     applicationLink: {
//         type: String,
//         unique: true,
//         required: true,
//         index: true // Add index for faster lookups
//     },
//     createdAt: {
//         type: Date,
//         default: Date.now,
//         index: true // Add index for sorting and filtering
//     },
//     expiresAt: {
//         type: Date,
//         required: true,
//         index: true // Add index for expiration queries
//     },
//     status: {
//         type: String,
//         enum: ['active', 'expired', 'deleted'],
//         default: 'active',
//         index: true // Add index for status filtering
//     }
// });

// // Add compound index for common query patterns
// InterviewLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });


// const InterviewLink = mongoose.model('InterviewLink', InterviewLinkSchema);

// // Helper function to generate unique application link
// async function generateUniqueLink() {
//     const timestamp = Date.now().toString(36);
//     const randomString = crypto.randomBytes(3).toString('hex');
//     const linkId = `${timestamp}-${randomString}`;
    
//     const existing = await InterviewLink.findOne({ applicationLink: linkId });
//     if (existing) {
//         return generateUniqueLink(); // Try again if collision occurs
//     }
    
//     return linkId;
// }

// // Route handler for creating interview links
// router.post('/interviewlink', upload.single('companyLogo'), async (req, res) => {
//     try {
//         // Verify database connection
//         if (mongoose.connection.readyState !== 1) {
//             throw new Error('Database connection is not ready');
//         }

//         const {
//             userId,
//             interviewTitle,
//             jobPostingUrl,
//             companyUrl,
//             questions,
//             replyEmails
//         } = req.body;

//         // Input validation
//         if (!userId || !interviewTitle || !jobPostingUrl || !questions) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Missing required fields'
//             });
//         }

//         // Parse questions array if needed
//         let parsedQuestions;
//         try {
//             parsedQuestions = typeof questions === 'string' ? JSON.parse(questions) : questions;
//         } catch (err) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Invalid questions format. Must be a JSON array.'
//             });
//         }
        
//         // Generate unique link
//         const applicationLink = await generateUniqueLink();

//         // Set expiration (30 days)
//         const expiresAt = new Date();
//         expiresAt.setDate(expiresAt.getDate() + 30);

//         // Handle company logo
//         let companyLogoData = null;
//         if (req.file) {
//             companyLogoData = {
//                 data: req.file.buffer,
//                 contentType: req.file.mimetype
//             };
//         }

//         // Create interview link document
//         const interviewLink = new InterviewLink({
//             userId,
//             interviewTitle,
//             jobPostingUrl,
//             companyUrl,
//             companyLogo: companyLogoData,
//             questions: parsedQuestions,
//             replyEmails: replyEmails ? replyEmails.split(',').map(email => email.trim()) : [],
//             applicationLink,
//             expiresAt
//         });

//         // Save to database with validation
//         await interviewLink.save();

//         // Construct application URL
//         const applicationUrl = `https://vdoqo.vercel.app/application/${applicationLink}`;

//         // Return success response
//         res.status(201).json({
//             success: true,
//             message: 'Interview link created successfully',
//             data: {
//                 interviewId: interviewLink._id,
//                 applicationUrl,
//                 expiresAt,
//                 preview: {
//                     title: interviewTitle,
//                     questions: parsedQuestions.length,
//                     expiryDate: expiresAt.toLocaleDateString()
//                 }
//             }
//         });

//     } catch (error) {
//         console.error('Error creating interview link:', error);
//         res.status(500).json({
//             success: false,
//             message: error.message || 'Error creating interview link'
//         });
//     }
// });

// // Route to get interview link details
// router.get('/interviewlink/:linkId', async (req, res) => {
//     try {
//         const { linkId } = req.params;

//         // Find active, non-expired interview
//         const interview = await InterviewLink.findOne({
//             applicationLink: linkId,
//             status: 'active',
//             expiresAt: { $gt: new Date() }
//         });

//         if (!interview) {
//             return res.status(404).json({
//                 success: false,
//                 message: 'Interview link not found or has expired'
//             });
//         }

//         // Return interview details
//         res.status(200).json({
//             success: true,
//             data: {
//                 interviewTitle: interview.interviewTitle,
//                 jobPostingUrl: interview.jobPostingUrl,
//                 companyUrl: interview.companyUrl,
//                 questions: interview.questions,
//                 companyLogo: interview.companyLogo ? {
//                     contentType: interview.companyLogo.contentType,
//                     data: interview.companyLogo.data.toString('base64')
//                 } : null
//             }
//         });

//     } catch (error) {
//         console.error('Error fetching interview link:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Error retrieving interview details'
//         });
//     }
// });

// // Health check endpoint
// router.get('/health', (req, res) => {
//     res.json({
//         success: true,
//         dbStatus: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
//     });
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

        const interview = new Interview({
            userId,
            interviewTitle,
            jobPostingUrl,
            companyUrl,
            companyLogoUrl,
            questions: Array.isArray(questions) ? questions : JSON.parse(questions),
            replyEmails: replyEmails ? replyEmails.split(',').map(email => email.trim()) : [],
            applicationLink,
            expiresAt
        });

        await interview.save();

        res.status(201).json({
            success: true,
            message: 'Interview created successfully',
            data: {
                applicationLink: `https://vdoqo.vercel.app/application/${applicationLink}`,
                expiresAt
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
