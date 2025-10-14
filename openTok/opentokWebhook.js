const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');

const router = express.Router();

// MongoDB Connection
mongoose.connect(process.env.ONEPGR_MONGO_URI, {
  dbName: 'onepgr_apps',
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// OpenTok Event Schema
const OpenTokEventSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true },
  projectId: { type: String, required: true },
  event: { type: String, required: true, enum: ['connectionCreated', 'connectionDestroyed', 'streamCreated', 'streamDestroyed', 'archiveStarted', 'archiveStopped', 'archiveUpdated'] },
  timestamp: { type: Number, required: true },
  stream: {
    id: String,
    createdAt: Number,
    name: String,
    hasAudio: Boolean,
    hasVideo: Boolean,
    videoType: String
  },
  connection: {
    id: String,
    createdAt: Number,
    data: String
  },
  archive: {
    id: String,
    name: String,
    url: String,
    hasAudio: Boolean,
    hasVideo: Boolean,
    duration: Number,
    size: Number,
    status: String
  },
  rawPayload: { type: Object },
  receivedAt: { type: Date, default: Date.now },
  processed: { type: Boolean, default: false }
});

const OpenTokEvent = mongoose.model('OpenTokEvent', OpenTokEventSchema);

// Verify OpenTok webhook signature
function verifyOpenTokSignature(payload, signature, secret) {
  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch (error) {
    console.error('Error verifying OpenTok signature:', error);
    return false;
  }
}

// Process OpenTok events
async function processOpenTokEvent(eventData) {
  try {
    console.log('Processing OpenTok event:', eventData.event, 'for session:', eventData.sessionId);
    
    // Store the event in MongoDB
    const event = new OpenTokEvent({
      sessionId: eventData.sessionId,
      projectId: eventData.projectId,
      event: eventData.event,
      timestamp: eventData.timestamp,
      stream: eventData.stream || null,
      connection: eventData.connection || null,
      archive: eventData.archive || null,
      rawPayload: eventData
    });

    await event.save();
    console.log('OpenTok event saved to database:', event._id);

    // Handle specific events
    switch (eventData.event) {
      case 'streamCreated':
        await handleStreamCreated(eventData);
        break;
      case 'streamDestroyed':
        await handleStreamDestroyed(eventData);
        break;
      case 'archiveStarted':
        await handleArchiveStarted(eventData);
        break;
      case 'archiveStopped':
        await handleArchiveStopped(eventData);
        break;
      case 'connectionCreated':
        await handleConnectionCreated(eventData);
        break;
      case 'connectionDestroyed':
        await handleConnectionDestroyed(eventData);
        break;
    }

    return { success: true, eventId: event._id };
  } catch (error) {
    console.error('Error processing OpenTok event:', error);
    throw error;
  }
}

// Event handlers
async function handleStreamCreated(eventData) {
  console.log(`Stream created: ${eventData.stream?.id} in session: ${eventData.sessionId}`);
  // Add your custom logic here for when a stream is created
  // This is typically when recording starts
}

async function handleStreamDestroyed(eventData) {
  console.log(`Stream destroyed: ${eventData.stream?.id} in session: ${eventData.sessionId}`);
  // Add your custom logic here for when a stream is destroyed
  // This is typically when recording stops
}

async function handleArchiveStarted(eventData) {
  console.log(`Archive started: ${eventData.archive?.id} for session: ${eventData.sessionId}`);
  // Add your custom logic here for when archiving starts
}

async function handleArchiveStopped(eventData) {
  console.log(`Archive stopped: ${eventData.archive?.id} for session: ${eventData.sessionId}`);
  // Add your custom logic here for when archiving stops
}

async function handleConnectionCreated(eventData) {
  console.log(`Connection created: ${eventData.connection?.id} in session: ${eventData.sessionId}`);
  // Add your custom logic here for when a connection is created
}

async function handleConnectionDestroyed(eventData) {
  console.log(`Connection destroyed: ${eventData.connection?.id} in session: ${eventData.sessionId}`);
  // Add your custom logic here for when a connection is destroyed
}

// Main webhook endpoint for OpenTok events
router.post('/opentok/callback', async (req, res) => {
  try {
    console.log('Received OpenTok webhook:', req.body);
    
    // Store the event in MongoDB
    // const event = new OpenTokEvent({
    //   sessionId: req.body.sessionId,
    //   projectId: req.body.projectId,
    //   event: req.body.event,
    //   timestamp: req.body.timestamp,
    //   stream: req.body.stream || null,
    //   connection: req.body.connection || null,
    //   archive: req.body.archive || null,
    //   rawPayload: req.body
    // });

    // await event.save();
    // console.log('OpenTok event saved to database:', event._id);

    // res.status(200).json({
    //   success: true,
    //   message: 'OpenTok event received and stored successfully',
    //   eventId: event._id
    // });
    res.status(200).send("OK");
  } catch (error) {
    console.error('Error handling OpenTok webhook:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

module.exports = { router, OpenTokEvent };
