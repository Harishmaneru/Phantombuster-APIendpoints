require('dotenv').config();
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
// const jwt = require('jsonwebtoken');

// Connect to MongoDB using the ONEPGR_MONGO_URI from .env
const connectToMongoDB = async () => {
    try {
        if (mongoose.connection.readyState === 1) {
            console.log('MongoDB already connected');
            return;
        }

        await mongoose.connect(process.env.ONEPGR_MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        throw error;
    }
};

// Define user schema
const userSchema = new mongoose.Schema({
    userId: { type: String, default: () => new mongoose.Types.ObjectId().toString(), unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    password: { type: String, required: true },
    appType: { type: String, required: true },
    subscriptionType: { type: String, default: 'FreeTrial' },
    signupDate: { type: Date, default: Date.now },
    trialEndDate: {
        type: Date, default: function () {
            // Set trial end date to 14 days from signup
            const date = new Date();
            date.setDate(date.getDate() + 14);
            return date;
        }
    }
}, { collection: 'signup_data' });

// Create the User model
const User = mongoose.model('User', userSchema, 'signup_data');

// Middleware to ensure database connection
const ensureDbConnection = async (req, res, next) => {
    try {
        await connectToMongoDB();
        next();
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Database connection failed'
        });
    }
};

// Signup API endpoint
router.post('/api/signup', ensureDbConnection, async (req, res) => {
    try {
        const { name, email, phone, password, appType } = req.body;

        // Validate required fields
        if (!name || !email || !phone || !password || !appType) {
            return res.status(400).json({
                success: false,
                message: 'All fields are required: name, email, phone, password'
            });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: 'User with this email already exists'
            });
        }

        // Hash the password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create new user
        const newUser = new User({
            name,
            email,
            phone,
            password: hashedPassword,
            appType,
        });

        // Save user to database
        await newUser.save();

        // Return success response
        return res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: {
                userId: newUser.userId,
                name: newUser.name,
                email: newUser.email,
                subscriptionType: newUser.subscriptionType,
                trialEndDate: newUser.trialEndDate
            }
        });
    } catch (error) {
        console.error('Signup error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error during signup',
            error: error.message
        });
    }
});

// Login API endpoint
router.post('/api/login', ensureDbConnection, async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate required fields
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        // Find user by email
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        // Compare password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        // Check if trial has expired
        const currentDate = new Date();
        const trialStatus = currentDate <= user.trialEndDate ? 'active' : 'expired';

        // Return success with user data
        return res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
                userId: user.userId,
                name: user.name,
                email: user.email,
                subscriptionType: user.subscriptionType,
                trialStatus: trialStatus,
                trialEndDate: user.trialEndDate
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error during login',
            error: error.message
        });
    }
});

module.exports = router;
