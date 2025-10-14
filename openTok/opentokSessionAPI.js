const express = require('express');
const OpenTok = require('opentok');
const mongoose = require('mongoose');

const router = express.Router();

// MongoDB Connection
mongoose.connect(process.env.ONEPGR_MONGO_URI, {
  dbName: 'onepgr_apps',
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// OpenTok Session Schema
const OpenTokSessionSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true }, // ✅ Explicit userId field
  sessionId: { type: String, required: true, unique: true, index: true },
  apiKey: { type: String, required: true },
  mediaMode: { type: String, enum: ['routed', 'relayed'], default: 'routed' },
  archiveMode: { type: String, enum: ['manual', 'always'], default: 'manual' },
  location: { type: String, default: null },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  lastUsed: { type: Date, default: Date.now },
  usageCount: { type: Number, default: 0 },
  createdBy: { type: String, default: 'system' } // Optional for admin logs
});

const OpenTokSession = mongoose.model('OpenTokSession', OpenTokSessionSchema);

// Initialize OpenTok with API key and secret from environment variables
const opentok = new OpenTok(process.env.OPENTOK_API_KEY, process.env.OPENTOK_API_SECRET);

/**
 * POST /create-session
 * Creates a new OpenTok session
 * 
 * Request Body (optional):
 * - mediaMode: 'routed' or 'relayed' (defaults to 'routed')
 * - archiveMode: 'manual' or 'always' (defaults to 'manual')
 * 
 * Response:
 * - sessionId: The generated session ID
 * - apiKey: OpenTok API key
 */
router.post('/opentok/create-session', async (req, res) => {
  try {
    const { 
      mediaMode = 'routed', 
      archiveMode = 'manual', 
      userId 
    } = req.body || {};

    // If no userId provided, return error
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId is required'
      });
    }

    // First, check if there's an existing active session in database for this user
    const existingSession = await OpenTokSession.findOne({
      userId,
      isActive: true,
      mediaMode,
      archiveMode
    });

    if (existingSession) {
      // Update usage stats and return existing session
      existingSession.lastUsed = new Date();
      existingSession.usageCount += 1;
      await existingSession.save();

      console.log('Using existing OpenTok session from DB:', existingSession.sessionId);
      
      return res.json({
        success: true,
        sessionId: existingSession.sessionId,
        apiKey: existingSession.apiKey,
        isNew: false,
        usageCount: existingSession.usageCount
      });
    }

    // If no existing session found, create new one
    const sessionOptions = {
      mediaMode,
      archiveMode
    };

    // Create the session with OpenTok
    opentok.createSession(sessionOptions, async (error, session) => {
      if (error) {
        console.error('Error creating OpenTok session:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to create session',
          message: error.message
        });
      }

      try {
        // Store new session in database
        const newSession = new OpenTokSession({
          userId, // ✅ Store userId explicitly
          sessionId: session.sessionId,
          apiKey: process.env.OPENTOK_API_KEY,
          mediaMode: session.mediaMode,
          archiveMode: session.archiveMode,
          location: session.location || null,
          createdBy: userId, // Also store in createdBy for admin logs
          usageCount: 1
        });

        await newSession.save();
        console.log('New OpenTok session created and stored in DB:', session.sessionId);
        
        res.json({
          success: true,
          sessionId: session.sessionId,
          apiKey: process.env.OPENTOK_API_KEY,
          isNew: true,
          usageCount: 1
        });
      } catch (dbError) {
        console.error('Error saving session to database:', dbError);
        res.status(500).json({
          success: false,
          error: 'Failed to save session to database',
          message: dbError.message
        });
      }
    });
  } catch (error) {
    console.error('Error in create-session endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /get-token
 * Generates a token for an OpenTok session
 * 
 * Request Body:
 * - sessionId: The OpenTok session ID (required)
 * - role: 'publisher', 'subscriber', or 'moderator' (optional, defaults to 'publisher')
 * - expireTime: Token expiration time in seconds (optional, defaults to 24 hours)
 * 
 * Response:
 * - token: The generated token
 * - sessionId: The session ID
 * - apiKey: OpenTok API key
 */
router.post('/opentok/get-token', (req, res) => {
  try {
    const { sessionId, role = 'publisher', expireTime } = req.body || {};

    // Validate required fields
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'sessionId is required'
      });
    }

    // Validate role
    const validRoles = ['publisher', 'subscriber', 'moderator'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid role. Must be one of: publisher, subscriber, moderator'
      });
    }

    // Calculate expiration time (default: 24 hours from now)
    const expirationTime = expireTime ? 
      Math.floor(Date.now() / 1000) + expireTime : 
      Math.floor(Date.now() / 1000) + (24 * 60 * 60);

    // Generate token
    const token = opentok.generateToken(sessionId, {
      role,
      expireTime: expirationTime
    });

    console.log('OpenTok token generated for session:', sessionId);

    res.json({
      success: true,
      token,
      sessionId,
      apiKey: process.env.OPENTOK_API_KEY
    });
  } catch (error) {
    console.error('Error generating OpenTok token:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});


/**
 * POST /opentok/start-archive
 * Starts recording (archive) for a given session
 * 
 * Request Body:
 * - sessionId: The OpenTok session ID (required)
 * - name: Optional name for the recording
 * - userId: Optional, for tracking
 */
router.post('/opentok/start-archive', async (req, res) => {
  try {
    const { sessionId, name = 'Recording', userId } = req.body || {};

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'sessionId is required'
      });
    }

    // Start the archive (recording)
    opentok.startArchive(sessionId, { name }, async (err, archive) => {
      if (err) {
        console.error('Error starting archive:', err);
        return res.status(500).json({
          success: false,
          error: 'Failed to start recording',
          message: err.message
        });
      }

      console.log('🎥 Recording started for session:', sessionId);

      // Optionally, store this recording in DB
      await mongoose.connection.db.collection('opentok_archives').insertOne({
        userId,
        sessionId,
        archiveId: archive.id,
        name,
        status: 'started',
        createdAt: new Date()
      });

      res.json({
        success: true,
        archiveId: archive.id,
        sessionId,
        status: archive.status,
        createdAt: archive.createdAt
      });
    });
  } catch (error) {
    console.error('Error starting archive:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});


/**
 * POST /opentok/stop-archive
 * Stops a running recording (archive)
 * 
 * Request Body:
 * - archiveId: The ID of the recording returned by start-archive
 */
router.post('/opentok/stop-archive', async (req, res) => {
  try {
    const { archiveId } = req.body || {};

    if (!archiveId) {
      return res.status(400).json({
        success: false,
        error: 'archiveId is required'
      });
    }

    opentok.stopArchive(archiveId, async (err, archive) => {
      if (err) {
        console.error('Error stopping archive:', err);
        return res.status(500).json({
          success: false,
          error: 'Failed to stop recording',
          message: err.message
        });
      }

      console.log('✅ Recording stopped:', archive.id);

      // Update archive record in DB
      await mongoose.connection.db.collection('opentok_archives').updateOne(
        { archiveId },
        { $set: { status: archive.status, url: archive.url, stoppedAt: new Date() } }
      );

      res.json({
        success: true,
        archiveId: archive.id,
        sessionId: archive.sessionId,
        status: archive.status,
        url: archive.url
      });
    });
  } catch (error) {
    console.error('Error stopping archive:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});


module.exports = router;
