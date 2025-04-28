const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
require('dotenv').config();

// Simple logging function for RB2B events
const logRB2B = (message, data = null) => {
    const logPrefix = '[rb2b ri evnts]';
    if (data) {
        console.log(`${logPrefix} ${message}`, data);
    } else {
        console.log(`${logPrefix} ${message}`);
    }
};

// Connect to MongoDB
const connectToMongoDB = async () => {
    try {
        if (mongoose.connection.readyState === 1) {
            logRB2B('MongoDB already connected');
            return;
        }

        await mongoose.connect(process.env.ONEPGR_MONGO_URI, {
            // useNewUrlParser: true,
            // useUnifiedTopology: true,
            dbName: 'onepgr_apps'
        });
        logRB2B('Connected to MongoDB onepgr_apps database for RB2B events');
    } catch (error) {
        logRB2B('MongoDB connection error:', error);
        throw error;
    }
};

// Define RB2B event schema
const rb2bEventSchema = new mongoose.Schema({
    "LinkedIn URL": { type: String, required: true },
    "First Name": { type: String, required: true },
    "Last Name": { type: String },
    "Title": { type: String },
    "Company Name": { type: String },
    "Business Email": { type: String },
    "Website": { type: String },
    "Industry": { type: String },
    "Employee Count": { type: String },
    "Estimate Revenue": { type: String },
    "City": { type: String },
    "State": { type: String },
    "Zipcode": { type: String },
    "Seen At": { type: Date },
    "Referrer": { type: String },
    "Captured URL": { type: String },
    "Tags": { type: String },
    "receivedAt": { type: Date, default: Date.now }
}, { collection: 'rb2b_ri_events' });

// Create the model
const RB2BEvent = mongoose.model('RB2BEvent', rb2bEventSchema);

// Middleware to ensure database connection
const ensureDbConnection = async (req, res, next) => {
    try {
        await connectToMongoDB();
        next();
    } catch (error) {
        logRB2B('Database connection failed', error);
        return res.status(500).json({
            success: false,
            message: 'Database connection failed',
            error: error.message
        });
    }
};

// Webhook endpoint for RB2B events
router.post('/rb2b/webhook', ensureDbConnection, async (req, res) => {
    logRB2B('Received webhook event');

    try {
        const eventData = req.body;
        logRB2B('Event data received', {
            linkedInUrl: eventData["LinkedIn URL"],
            firstName: eventData["First Name"],
            company: eventData["Company Name"] || 'N/A'
        });

        // Validate required fields
        if (!eventData["LinkedIn URL"] || !eventData["First Name"]) {
            logRB2B('Missing required fields');
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: LinkedIn URL and First Name are required'
            });
        }

        // Format date field if present
        if (eventData["Seen At"] && typeof eventData["Seen At"] === 'string') {
            eventData["Seen At"] = new Date(eventData["Seen At"]);
        }

        // Create and save the event
        const newEvent = new RB2BEvent(eventData);
        const savedEvent = await newEvent.save();
        logRB2B('Event saved successfully', { id: savedEvent._id });

        return res.status(200).json({
            success: true,
            message: 'RB2B event data received and stored successfully',
            eventId: newEvent._id
        });
    } catch (error) {
        logRB2B('Error processing webhook:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to process RB2B event data',
            error: error.message
        });
    }
});

// Health check endpoint for the webhook
router.get('/rb2b/health', (req, res) => {
    logRB2B('Health check performed');
    res.status(200).json({
        status: 'healthy',
        message: 'RB2B webhook is operational'
    });
});

module.exports = router;
