const express = require('express');
const router = express.Router();
const multer = require('multer');
const mongoose = require('mongoose');

// Database connection
const mongoURI = process.env.ONEPGR_MONGO_URI
mongoose.connect(mongoURI, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
    dbName: 'onepgr_apps'  // Explicitly specify database name
})
    .then(() => console.log('createVI: MongoDB connected to onepgr_apps database'))
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
    companyLogoUrl: String,
    questions: { type: [String], required: true },
    applicationLink: { type: String, unique: true, required: true },
    createdAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['active', 'deleted'], default: 'active' },
    viewCount: { type: Number, default: 0 },
    lastViewed: { type: Date },
    applicationCount: { type: Number, default: 0 }
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
        const { userId, interviewTitle, email, jobPostingUrl, companyUrl, questions, applicationLink: providedApplicationLink } = req.body;

        if (!userId || !interviewTitle || !email || !jobPostingUrl || !questions) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const applicationLink = providedApplicationLink || generateUniqueLink();
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
            applicationLink
        });

        await interview.save();

        res.status(201).json({
            success: true,
            message: 'Interview created successfully',
            data: {
                applicationLink: `https://record.onepgr.com/InterviewPage/${applicationLink}`,
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

// Update interview questions
router.post('/editinterview/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { questions, email, interviewTitle } = req.body;

        // Create update object
        const updateObject = {};

        // Add fields to update object if they exist
        if (questions && Array.isArray(questions)) {
            updateObject.questions = questions;
        } else if (questions) {
            return res.status(400).json({ success: false, message: "Invalid questions data" });
        }

        if (email) updateObject.email = email;
        if (interviewTitle) updateObject.interviewTitle = interviewTitle;

        // Check if there's anything to update
        if (Object.keys(updateObject).length === 0) {
            return res.status(400).json({ success: false, message: "No valid fields to update" });
        }

        const updatedInterview = await Interview.findByIdAndUpdate(
            id,
            updateObject,
            { new: true }
        );

        if (!updatedInterview) {
            return res.status(404).json({ success: false, message: "Interview not found" });
        }

        res.status(200).json({
            success: true,
            message: "Interview updated successfully",
            data: updatedInterview
        });
    } catch (err) {
        console.error("Error updating interview:", err);
        res.status(500).json({ success: false, message: "Failed to update interview" });
    }
});

// Delete interview
router.delete('/deleteinterview/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const deletedInterview = await Interview.findByIdAndDelete(id);

        if (!deletedInterview) {
            return res.status(404).json({ success: false, message: "Interview not found" });
        }

        res.status(200).json({
            success: true,
            message: "Interview deleted successfully"
        });
    } catch (err) {
        console.error("Error deleting interview:", err);
        res.status(500).json({ success: false, message: "Failed to delete interview" });
    }
});

router.get('/allinterviews', async (req, res) => {
    try {
        // Extract query parameters
        const userId = req.query.userId;
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);

        // Build the filter object
        const filter = {};
        if (userId) {
            filter.userId = userId;
        }
        // Add status filter only if specifically requested
        if (req.query.status) {
            filter.status = req.query.status;
        }

        // Calculate skip value for pagination
        const skip = (page - 1) * limit;

        // Fetch paginated interviews
        const interviews = await Interview.find(filter)
            .select('-companyLogoUrl')
            .sort({ createdAt: -1 })
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
            companyUrl: interview.companyUrl,
            companyLogoUrl: interview.companyLogoUrl,
            questions: interview.questions,
            applicationLink: `https://record.onepgr.com/InterviewPage/${interview.applicationLink}`,
            createdAt: interview.createdAt,
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

        const interview = await Interview.findOne({
            applicationLink: linkId,
            status: 'active'
        });

        if (!interview) {
            return res.status(404).json({ success: false, message: 'Interview not found' });
        }

        res.status(200).json({
            success: true,
            data: {
                userId: interview.userId,
                interviewTitle: interview.interviewTitle,
                hiringManagerEmail: interview.email,
                jobPostingUrl: interview.jobPostingUrl,
                companyUrl: interview.companyUrl,
                questions: interview.questions || [],
                applicationLink: interview.applicationLink,
                companyLogoUrl: interview.companyLogoUrl,
                viewCount: interview.viewCount,
                applicationCount: interview.applicationCount
            }
        });
    } catch (err) {
        console.error('Error fetching interview:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch interview details' });
    }
});

// Get view count for an interview
router.get('/interview/:interviewCode/views', async (req, res) => {
    try {
        const { interviewCode } = req.params;
        const interview = await Interview.findOne({ applicationLink: interviewCode });

        if (!interview) {
            return res.status(404).json({
                success: false,
                message: 'Interview not found'
            });
        }

        res.json({
            success: true,
            viewCount: interview.viewCount || 0,
            applicationCount: interview.applicationCount || 0
        });
    } catch (error) {
        console.error('Error fetching counts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch counts'
        });
    }
});

// Increment view count
router.post('/interview/:interviewCode/views', async (req, res) => {
    try {
        const { interviewCode } = req.params;
        const interview = await Interview.findOneAndUpdate(
            { applicationLink: interviewCode },
            {
                $inc: { viewCount: 1 },
                lastViewed: new Date()
            },
            { new: true }
        );

        if (!interview) {
            return res.status(404).json({
                success: false,
                message: 'Interview not found'
            });
        }

        res.json({
            success: true,
            viewCount: interview.viewCount
        });
    } catch (error) {
        console.error('Error updating view count:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update view count'
        });
    }
});

// Health check endpoint
router.get('/health', (req, res) => {
    res.json({ success: true, dbStatus: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

module.exports = { router, Interview };