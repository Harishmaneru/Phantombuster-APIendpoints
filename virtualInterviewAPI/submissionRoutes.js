// const express = require('express');
// const router = express.Router();
// const mongoose = require('mongoose');
// const multer = require('multer');
// const storage = multer.memoryStorage();
// const upload = multer({
//     storage,
//     limits: {
//         fileSize: 500 * 1024 * 1024
//     }
// }).any();

// const logSubmissionActivity = (stage, data) => {
//     console.log(`[${new Date().toISOString()}] Submission ${stage}:`, JSON.stringify(data, null, 2));
// };

// // Verify database connection
// const verifyDbConnection = () => {
//     const state = mongoose.connection.readyState;
//     const states = {
//         0: 'disconnected',
//         1: 'connected',
//         2: 'connecting',
//         3: 'disconnecting'
//     };
//     return states[state] || 'unknown';
// };


// const SubmissionSchema = new mongoose.Schema({
//     userId: { type: String, required: true },
//     applicationLink: { type: String, required: true },
//     hiringManagerEmail: { type: String, required: true },
//     applicantName: { type: String, required: true },
//     email: { type: String, required: true },
//     linkedInUrl: { type: String, required: true },
//     textQuestion: { type: String, required: true },
//     textResponse: { type: String, required: true },
//     videoResponses: [{
//         questionIndex: { type: Number, required: true },
//         question: { type: String, required: true },
//         videoUrl: { type: String, required: true },
//         fileName: { type: String },
//         mimeType: { type: String }
//     }],
//     submittedAt: { type: Date, default: Date.now }
// }, {
//     writeConcern: { w: 1, j: false },
//     bufferCommands: false
// });


// const Submission = mongoose.model('Submission', SubmissionSchema);

// async function connectDB() {
//     if (mongoose.connection.readyState === 1) {
//         logSubmissionActivity('DB Status', { status: 'Already connected' });
//         return;
//     }

//     const mongoURI = process.env.MONGODB_URI;
//     const options = {
//         serverSelectionTimeoutMS: 60000,
//         socketTimeoutMS: 120000,
//         connectTimeoutMS: 60000,
//         maxPoolSize: 10,
//         wtimeoutMS: 30000,
//         keepAlive: true,
//         keepAliveInitialDelay: 300000
//     };

//     try {
//         logSubmissionActivity('DB Connection Attempt', { uri: mongoURI.replace(/\/\/.*@/, '//****@') });
//         await mongoose.connect(mongoURI, options);
//         logSubmissionActivity('DB Connection', { status: 'success' });
//     } catch (err) {
//         logSubmissionActivity('DB Connection Error', {
//             error: err.message,
//             stack: err.stack
//         });
//         throw err;
//     }
// }

// // Middleware to ensure database connection
// const ensureDbConnection = async (req, res, next) => {
//     try {
//         await connectDB();
//         next();
//     } catch (error) {
//         res.status(500).json({
//             success: false,
//             message: 'Database connection failed'
//         });
//     }
// };

// // Handle file upload
// const handleUpload = (req, res, next) => {
//     upload(req, res, function (err) {
//         if (err) {
//             return res.status(400).json({
//                 success: false,
//                 message: err.message
//             });
//         }
//         next();
//     });
// };

// router.post('/submit', ensureDbConnection, handleUpload, async (req, res) => {
//     const session = await mongoose.startSession();
//     let savedId = null;

//     try {
//         logSubmissionActivity('Request Received', {
//             userId: req.body.userId,
//             applicationLink: req.body.applicationLink,
//             hiringManagerEmail: req.body.hiringManagerEmail,
//             applicantName: req.body.applicantName,
//             email: req.body.email,
//             linkedInUrl: req.body.linkedInUrl,
//             filesCount: req?.files?.length || 0
//         });

//         const dbState = verifyDbConnection();
//         logSubmissionActivity('DB State Check', { state: dbState });

//         if (dbState !== 'connected') {
//             throw new Error(`Database not properly connected. Current state: ${dbState}`);
//         }

//         const { 
//             userId, 
//             applicationLink,  
//             hiringManagerEmail,
//             applicantName, 
//             email, 
//             linkedInUrl,
//             textResponse, 
//             textQuestion 
//         } = req.body;

//         // Enhanced validation
//         if (!userId || !applicationLink || !hiringManagerEmail || !applicantName || !email || !linkedInUrl || !textResponse || !textQuestion || !req.files || req.files.length === 0) {
//             logSubmissionActivity('Validation Error', { 
//                 missing: {
//                     userId: !userId,
//                     applicationLink: !applicationLink,
//                     hiringManagerEmail: !hiringManagerEmail,
//                     applicantName: !applicantName,
//                     email: !email,
//                     linkedInUrl: !linkedInUrl,
//                     textResponse: !textResponse,
//                     textQuestion: !textQuestion,
//                     files: !req.files || req.files.length === 0
//                 }
//             });
//             return res.status(400).json({
//                 success: false,
//                 message: 'Missing required fields'
//             });
//         }

//         // Process video files with questions
//         const videoResponses = req.files.map((file, index) => {
//             const questionNumber = index + 1;
//             const question = req.body[`videoQuestion${questionNumber}`];

//             logSubmissionActivity('Processing File', {
//                 index,
//                 fileName: file.originalname,
//                 mimeType: file.mimetype,
//                 size: file.size,
//                 question
//             });

//             return {
//                 questionIndex: questionNumber,
//                 question: question,
//                 videoUrl: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
//                 fileName: file.originalname,
//                 mimeType: file.mimetype
//             };
//         });

//         logSubmissionActivity('Transaction Start', { sessionId: session.id });
//         session.startTransaction();

//         const submission = new Submission({
//             userId,
//             applicationLink,   
//             hiringManagerEmail,
//             applicantName,
//             email,
//             linkedInUrl,
//             textQuestion,
//             textResponse,
//             videoResponses
//         });

//         const savedSubmission = await submission.save({ session });
//         savedId = savedSubmission._id;

//         const verifySubmission = await Submission.findById(savedId).session(session);

//         if (!verifySubmission) {
//             throw new Error('Submission verification failed');
//         }

//         logSubmissionActivity('Submission Saved', { 
//             submissionId: savedId,
//             verified: !!verifySubmission
//         });

//         await session.commitTransaction();
//         logSubmissionActivity('Transaction Committed', { submissionId: savedId });

//         res.status(201).json({
//             success: true,
//             message: 'Submission saved successfully',
//             data: {
//                 submissionId: savedId,
//                 submittedAt: new Date()
//             }
//         });

//     } catch (err) {
//         logSubmissionActivity('Error', {
//             error: err.message,
//             stack: err.stack,
//             phase: savedId ? 'post-save' : 'pre-save'
//         });

//         await session.abortTransaction();
//         logSubmissionActivity('Transaction Aborted', { error: err.message });

//         if (!res.headersSent) {
//             res.status(500).json({
//                 success: false,
//                 message: 'Failed to process submission',
//                 error: err.message
//             });
//         }
//     } finally {
//         session.endSession();
//         logSubmissionActivity('Session Ended', { 
//             submissionId: savedId,
//             success: !!savedId 
//         });
//     }
// });
// router.get('/submissions', ensureDbConnection, async (req, res) => {
//     try {
//         const { userId, applicationLink, includeVideos = false, page = 1, limit = 50 } = req.query;

//         // Input validation
//         if (!userId || !applicationLink) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Both userId and applicationLink are required'
//             });
//         }

//         // Convert pagination values to numbers
//         const pageNum = parseInt(page, 10);
//         const limitNum = parseInt(limit, 10);
//         const skip = (pageNum - 1) * limitNum;

//         // Log the incoming request details
//         logSubmissionActivity('Fetching Submissions', { userId, applicationLink, includeVideos, page, limit });

//         // Define projection to exclude video responses if not requested
//         const projection = includeVideos === 'true' ? {} : { videoResponses: 0 };

//         // Query submissions
//         const submissions = await Submission.find(
//             { userId, applicationLink }, // Query by userId and applicationLink
//             projection
//         )
//         .sort({ submittedAt: -1 })
//         .skip(skip)
//         .limit(limitNum);

//         // Log results
//         logSubmissionActivity('Fetched Submissions', { count: submissions.length });

//         // Return results
//         res.status(200).json({
//             success: true,
//             data: submissions,
//             pagination: {
//                 page: pageNum,
//                 limit: limitNum,
//                 total: submissions.length
//             }
//         });
//     } catch (err) {
//         console.error('Error fetching submissions:', err);
//         res.status(500).json({
//             success: false,
//             message: 'Failed to fetch submissions',
//             error: err.message
//         });
//     }
// });

//------------------------------------
// module.exports = router;
//-------------------------------------

// const express = require('express');
// const router = express.Router();
// const mongoose = require('mongoose');
// const multer = require('multer');
// const nodemailer = require('nodemailer'); 

// // Configure multer for file uploads
// const storage = multer.memoryStorage();
// const upload = multer({
//   storage,
//   limits: {
//     fileSize: 500 * 1024 * 1024
//   }
// }).any();

// // Logging helper
// const logSubmissionActivity = (stage, data) => {
//   console.log(`[${new Date().toISOString()}] Submission ${stage}:`, JSON.stringify(data, null, 2));
// };

// // Verify database connection
// const verifyDbConnection = () => {
//   const state = mongoose.connection.readyState;
//   const states = {
//     0: 'disconnected',
//     1: 'connected',
//     2: 'connecting',
//     3: 'disconnecting'
//   };
//   return states[state] || 'unknown';
// };

// // Define Mongoose schema and model
// const SubmissionSchema = new mongoose.Schema({
//   userId: { type: String, required: true },
//   applicationLink: { type: String, required: true },
//   hiringManagerEmail: { type: String, required: true },
//   applicantName: { type: String, required: true },
//   email: { type: String, required: true },
//   linkedInUrl: { type: String, required: true },
//   textQuestion: { type: String, required: true },
//   textResponse: { type: String, required: true },
//   videoResponses: [{
//     questionIndex: { type: Number, required: true },
//     question: { type: String, required: true },
//     videoUrl: { type: String, required: true },
//     fileName: { type: String },
//     mimeType: { type: String }
//   }],
//   submittedAt: { type: Date, default: Date.now }
// }, {
//   writeConcern: { w: 1, j: false },
//   bufferCommands: false
// });

// const Submission = mongoose.model('Submission', SubmissionSchema);

// // Connect to database if not already connected
// async function connectDB() {
//   if (mongoose.connection.readyState === 1) {
//     logSubmissionActivity('DB Status', { status: 'Already connected' });
//     return;
//   }

//   const mongoURI = process.env.MONGODB_URI;
//   const options = {
//     serverSelectionTimeoutMS: 60000,
//     socketTimeoutMS: 120000,
//     connectTimeoutMS: 60000,
//     maxPoolSize: 10,
//     wtimeoutMS: 30000,
//     keepAlive: true,
//     keepAliveInitialDelay: 300000
//   };

//   try {
//     logSubmissionActivity('DB Connection Attempt', { uri: mongoURI.replace(/\/\/.*@/, '//****@') });
//     await mongoose.connect(mongoURI, options);
//     logSubmissionActivity('DB Connection', { status: 'success' });
//   } catch (err) {
//     logSubmissionActivity('DB Connection Error', {
//       error: err.message,
//       stack: err.stack
//     });
//     throw err;
//   }
// }

// // Middleware to ensure database connection
// const ensureDbConnection = async (req, res, next) => {
//   try {
//     await connectDB();
//     next();
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: 'Database connection failed'
//     });
//   }
// };

// // Middleware to handle file upload
// const handleUpload = (req, res, next) => {
//   upload(req, res, function (err) {
//     if (err) {
//       return res.status(400).json({
//         success: false,
//         message: err.message
//       });
//     }
//     next();
//   });
// };

// // -------------------------
// // Nodemailer configuration
// // -------------------------
// const transporter = nodemailer.createTransport({
//     service: 'gmail',
//     auth: {
//       user: 'harish@onepgr.us',
//       pass: process.env.EMAIL_PASSWORD
//     }
//   });

// // Helper function to send the submission email
// async function sendSubmissionEmails(submission, sendSummary) {
//     const { applicantName, email, applicationLink, hiringManagerEmail, linkedInUrl, submittedAt } = submission;

//     // Email to Hiring Manager
//     const hmEmailBody = `
//       <h4>New Application Submission Received</h4>
//       <p><strong>Applicant Name:</strong> ${applicantName}</p>
//       <p><strong>Applicant Email:</strong> ${email}</p>
//       <p><strong>LinkedIn URL:</strong> ${linkedInUrl}</p>
//       <p><strong>Application Link:</strong> https://www.recordedinterview.com/InterviewPage${applicationLink}</p>
//       <p><strong>Submitted At:</strong> ${submittedAt}</p>
//     `;

//     const hmMailOptions = {
//       from: 'harish@onepgr.us',
//       to: hiringManagerEmail,
//     //   bcc: 'harishmaneru@gmail.com',
//       subject: 'New Application Submission Received',
//       html: hmEmailBody
//     };

//     try {
//       let infoHM = await transporter.sendMail(hmMailOptions);
//       console.log(`Hiring Manager Email sent: ${infoHM.messageId}`);
//     } catch (error) {
//       console.error(`Error sending Hiring Manager Email: ${error}`);
//     }

//     // Email to Applicant (if they opted in)
//     if (sendSummary) {
//       const applicantEmailBody = `
//         <h3>Thank You for Your Application!</h3>
//         <p>Dear ${applicantName},</p>
//         <p>Thank you for submitting your application. Here’s a summary of your submission:</p>
//         <ul>
//           <li><strong>Applicant Name:</strong> ${applicantName}</li>
//           <li><strong>Email:</strong> ${email}</li>
//           <li><strong>LinkedIn URL:</strong> ${linkedInUrl}</li>
//           <li><strong>Application Link:</strong> ${applicationLink}</li>
//           <li><strong>Submitted At:</strong> ${submittedAt}</li>
//         </ul>
//         <p>We appreciate your interest and will get back to you soon.</p>
//       `;

//       const applicantMailOptions = {
//         from: 'harish@onepgr.us',
//         to: email,
//         subject: 'Thank You for Your Application',
//         html: applicantEmailBody
//       };

//       try {
//         let infoApp = await transporter.sendMail(applicantMailOptions);
//         console.log(`Applicant Email sent: ${infoApp.messageId}`);
//       } catch (error) {
//         console.error(`Error sending Applicant Email: ${error}`);
//       }
//     }
//   }
// // -------------------------
// // POST /submit route
// // -------------------------
// router.post('/submit', ensureDbConnection, handleUpload, async (req, res) => {
//   const session = await mongoose.startSession();
//   let savedId = null;
//   let savedSubmission = null;

//   try {
//     logSubmissionActivity('Request Received', {
//       userId: req.body.userId,
//       applicationLink: req.body.applicationLink,
//       hiringManagerEmail: req.body.hiringManagerEmail,
//       applicantName: req.body.applicantName,
//       email: req.body.email,
//       linkedInUrl: req.body.linkedInUrl,
//       filesCount: req?.files?.length || 0
//     });

//     const dbState = verifyDbConnection();
//     logSubmissionActivity('DB State Check', { state: dbState });

//     if (dbState !== 'connected') {
//       throw new Error(`Database not properly connected. Current state: ${dbState}`);
//     }

//     const { 
//       userId, 
//       applicationLink,  
//       hiringManagerEmail,
//       applicantName, 
//       email, 
//       linkedInUrl,
//       textResponse, 
//       textQuestion 
//     } = req.body;

//     // Enhanced validation
//     if (!userId || !applicationLink || !hiringManagerEmail || !applicantName || !email || !linkedInUrl || !textResponse || !textQuestion || !req.files || req.files.length === 0) {
//       logSubmissionActivity('Validation Error', { 
//         missing: {
//           userId: !userId,
//           applicationLink: !applicationLink,
//           hiringManagerEmail: !hiringManagerEmail,
//           applicantName: !applicantName,
//           email: !email,
//           linkedInUrl: !linkedInUrl,
//           textResponse: !textResponse,
//           textQuestion: !textQuestion,
//           files: !req.files || req.files.length === 0
//         }
//       });
//       return res.status(400).json({
//         success: false,
//         message: 'Missing required fields'
//       });
//     }

//     // Process video files with questions
//     const videoResponses = req.files.map((file, index) => {
//       const questionNumber = index + 1;
//       const question = req.body[`videoQuestion${questionNumber}`];

//       logSubmissionActivity('Processing File', {
//         index,
//         fileName: file.originalname,
//         mimeType: file.mimetype,
//         size: file.size,
//         question
//       });

//       return {
//         questionIndex: questionNumber,
//         question: question,
//         videoUrl: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
//         fileName: file.originalname,
//         mimeType: file.mimetype
//       };
//     });

//     logSubmissionActivity('Transaction Start', { sessionId: session.id });
//     session.startTransaction();

//     const submission = new Submission({
//       userId,
//       applicationLink,   
//       hiringManagerEmail,
//       applicantName,
//       email,
//       linkedInUrl,
//       textQuestion,
//       textResponse,
//       videoResponses
//     });

//     savedSubmission = await submission.save({ session });
//     savedId = savedSubmission._id;

//     const verifySubmission = await Submission.findById(savedId).session(session);

//     if (!verifySubmission) {
//       throw new Error('Submission verification failed');
//     }

//     logSubmissionActivity('Submission Saved', { 
//       submissionId: savedId,
//       verified: !!verifySubmission
//     });

//     await session.commitTransaction();
//     logSubmissionActivity('Transaction Committed', { submissionId: savedId });

//     // Check if the applicant requested an email summary.
//     // (Assuming the VideoInterviewPage component sends "receiveEmailSummary" as "true" when checked)
//     const sendSummary = req.body.receiveEmailSummary === 'true';

//     // Send email to the hiring manager (with CC to applicant if requested and BCC to Raj)
//     await sendSubmissionEmails(savedSubmission, sendSummary);

//     res.status(201).json({
//       success: true,
//       message: 'Submission saved successfully',
//       data: {
//         submissionId: savedId,
//         submittedAt: new Date()
//       }
//     });

//   } catch (err) {
//     logSubmissionActivity('Error', {
//       error: err.message,
//       stack: err.stack,
//       phase: savedId ? 'post-save' : 'pre-save'
//     });

//     await session.abortTransaction();
//     logSubmissionActivity('Transaction Aborted', { error: err.message });

//     if (!res.headersSent) {
//       res.status(500).json({
//         success: false,
//         message: 'Failed to process submission',
//         error: err.message
//       });
//     }
//   } finally {
//     session.endSession();
//     logSubmissionActivity('Session Ended', { 
//       submissionId: savedId,
//       success: !!savedId 
//     });
//   }
// });

// // -------------------------
// // GET /submissions route
// // -------------------------
// router.get('/submissions', ensureDbConnection, async (req, res) => {
//   try {
//     const { userId, applicationLink, includeVideos = false, page = 1, limit = 50 } = req.query;

//     // Input validation
//     if (!userId || !applicationLink) {
//       return res.status(400).json({
//         success: false,
//         message: 'Both userId and applicationLink are required'
//       });
//     }

//     // Convert pagination values to numbers
//     const pageNum = parseInt(page, 10);
//     const limitNum = parseInt(limit, 10);
//     const skip = (pageNum - 1) * limitNum;

//     // Log the incoming request details
//     logSubmissionActivity('Fetching Submissions', { userId, applicationLink, includeVideos, page, limit });

//     // Define projection to exclude video responses if not requested
//     const projection = includeVideos === 'true' ? {} : { videoResponses: 0 };

//     // Query submissions
//     const submissions = await Submission.find(
//       { userId, applicationLink },
//       projection
//     )
//       .sort({ submittedAt: -1 })
//       .skip(skip)
//       .limit(limitNum);

//     // Log results
//     logSubmissionActivity('Fetched Submissions', { count: submissions.length });

//     // Return results
//     res.status(200).json({
//       success: true,
//       data: submissions,
//       pagination: {
//         page: pageNum,
//         limit: limitNum,
//         total: submissions.length
//       }
//     });
//   } catch (err) {
//     console.error('Error fetching submissions:', err);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to fetch submissions',
//       error: err.message
//     });
//   }
// });

// module.exports = router;


// require('dotenv').config();
// const express = require('express');
// const router = express.Router();
// const mongoose = require('mongoose');
// const multer = require('multer');
// const nodemailer = require('nodemailer');
// const AWS = require('aws-sdk');
// const multerS3 = require('multer-s3');
// const ffmpeg = require('fluent-ffmpeg');
// const { Whisper } = require('whisper-node');
// const fs = require('fs');

require('dotenv').config();
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');
const nodemailer = require('nodemailer');
const AWS = require('aws-sdk');
const multerS3 = require('multer-s3');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const { OpenAI } = require('openai');


const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// AWS S3 configuration
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

// Configure multer to use multer-s3 storage
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_BUCKET_NAME,
    acl: 'public-read',
    key: function (req, file, cb) {
      cb(null, `videos/${Date.now()}-${file.originalname}`);
    }
  }),
  limits: {
    fileSize: 500 * 1024 * 1024
  }
}).any();

// Logging helper function
const logSubmissionActivity = (stage, data) => {
  console.log(`[${new Date().toISOString()}] Submission ${stage}:`, JSON.stringify(data, null, 2));
};

// Database connection 
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
  applicationLink: { type: String, required: true },
  hiringManagerEmail: { type: String, required: true },
  applicantName: { type: String, required: true },
  email: { type: String, required: true },
  linkedInUrl: { type: String, required: true },
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

// Connect to database if not already connected
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

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: 'harish@onepgr.us',
    pass: process.env.EMAIL_PASSWORD,
  },
});

// Helper function to send emails (unchanged)
async function sendSubmissionEmails(submission, sendSummary) {
  const { applicantName, email, applicationLink, hiringManagerEmail, linkedInUrl, submittedAt } = submission;

  // Email to Hiring Manager
  const hmEmailBody = `
      <h4>New Application Submission Received</h4>
      <p><strong>Applicant Name:</strong> ${applicantName}</p>
      <p><strong>Applicant Email:</strong> ${email}</p>
      <p><strong>LinkedIn URL:</strong> ${linkedInUrl}</p>
      <p><strong>Application Link:</strong> https://www.recordedinterview.com/InterviewPage${applicationLink}</p>
      <p><strong>Submitted At:</strong> ${submittedAt}</p>
    `;

  const hmMailOptions = {
    from: 'harish@onepgr.us',
    to: hiringManagerEmail,
    bcc: 'rajiv@onepgr.com',
    subject: 'New Application Submission Received',
    html: hmEmailBody
  };

  try {
    let infoHM = await transporter.sendMail(hmMailOptions);
    console.log(`Hiring Manager Email sent: ${infoHM.messageId}`);
  } catch (error) {
    console.error(`Error sending Hiring Manager Email: ${error}`);
  }

  // Email to Applicant (if they opted in)
  if (sendSummary) {
    const applicantEmailBody = `
        <h3>Thank You for Your Application!</h3>
        <p>Dear ${applicantName},</p>
        <p>Thank you for submitting your application. Here’s a summary of your submission:</p>
        <ul>
          <li><strong>Applicant Name:</strong> ${applicantName}</li>
          <li><strong>Email:</strong> ${email}</li>
          <li><strong>LinkedIn URL:</strong> ${linkedInUrl}</li>
          <li><strong>Application Link:</strong> https://www.recordedinterview.com/InterviewPage${applicationLink}</li>
          <li><strong>Submitted At:</strong> ${submittedAt}</li>
        </ul>
        <p>We appreciate your interest and will get back to you soon.</p>
      `;

    const applicantMailOptions = {
      from: 'harish@onepgr.us',
      to: email,
      subject: 'Thank You for Your Application',
      html: applicantEmailBody
    };

    try {
      let infoApp = await transporter.sendMail(applicantMailOptions);
      console.log(`Applicant Email sent: ${infoApp.messageId}`);
    } catch (error) {
      console.error(`Error sending Applicant Email: ${error}`);
    }
  }
}

// -------------------------
// Middleware to handle file upload using multer-s3
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

// -------------------------
// POST /submit route (modified for S3 integration)

router.post('/submit', ensureDbConnection, handleUpload, async (req, res) => {
  const session = await mongoose.startSession();
  let savedId = null;
  let savedSubmission = null;

  try {
    logSubmissionActivity('Request Received', {
      userId: req.body.userId,
      applicationLink: req.body.applicationLink,
      hiringManagerEmail: req.body.hiringManagerEmail,
      applicantName: req.body.applicantName,
      email: req.body.email,
      linkedInUrl: req.body.linkedInUrl,
      filesCount: req?.files?.length || 0
    });


    const dbState = verifyDbConnection();
    logSubmissionActivity('DB State Check', { state: dbState });

    if (dbState !== 'connected') {
      throw new Error(`Database not properly connected. Current state: ${dbState}`);
    }

    const {
      userId,
      applicationLink,
      hiringManagerEmail,
      applicantName,
      email,
      linkedInUrl,
      textResponse,
      textQuestion
    } = req.body;


    if (!userId || !applicationLink || !hiringManagerEmail || !applicantName || !email || !linkedInUrl || !textResponse || !textQuestion || !req.files || req.files.length === 0) {
      logSubmissionActivity('Validation Error', {
        missing: {
          userId: !userId,
          applicationLink: !applicationLink,
          hiringManagerEmail: !hiringManagerEmail,
          applicantName: !applicantName,
          email: !email,
          linkedInUrl: !linkedInUrl,
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

    // Process video files: use the S3 URL returned by multer-s3
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
        videoUrl: file.location,
        fileName: file.originalname,
        mimeType: file.mimetype
      };
    });

    logSubmissionActivity('Transaction Start', { sessionId: session.id });
    session.startTransaction();

    const submission = new Submission({
      userId,
      applicationLink,
      hiringManagerEmail,
      applicantName,
      email,
      linkedInUrl,
      textQuestion,
      textResponse,
      videoResponses
    });

    savedSubmission = await submission.save({ session });
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

    // Check if the applicant requested an email summary.
    const sendSummary = req.body.receiveEmailSummary === 'true';

    // Send emails
    await sendSubmissionEmails(savedSubmission, sendSummary);

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

// -------------------------
// GET /submissions route

router.get('/submissions', ensureDbConnection, async (req, res) => {
  try {
    const { userId, applicationLink, includeVideos = false, page = 1, limit = 50 } = req.query;

    if (!userId || !applicationLink) {
      return res.status(400).json({
        success: false,
        message: 'Both userId and applicationLink are required'
      });
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    logSubmissionActivity('Fetching Submissions', { userId, applicationLink, includeVideos, page, limit });

    const projection = includeVideos === 'true' ? {} : { videoResponses: 0 };

    const submissions = await Submission.find(
      { userId, applicationLink },
      projection
    )
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(limitNum);

    logSubmissionActivity('Fetched Submissions', { count: submissions.length });

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
      message: 'Failed to fetch submissions',
      error: err.message
    });
  }
});

// -------------------------------------
// NEW Transcription Logic for Audio/Video Files
// -------------------------------------

// Convert video to audio (.mp3) using ffmpeg

function convertVideoToAudio(videoPath, outputAudioPath) {
  return new Promise((resolve, reject) => {
    const outputPathWithExtension = outputAudioPath.endsWith('.mp3')
      ? outputAudioPath
      : `${outputAudioPath}.mp3`;
      
    // Add the "-y" flag to auto-confirm overwrite and "-vn" to disable video
    const ffmpeg = spawn('ffmpeg', ['-y', '-i', videoPath, '-vn', '-q:a', '0', '-map', 'a', outputPathWithExtension]);

    ffmpeg.stderr.on('data', (data) => {
      console.log(`FFmpeg output: ${data.toString()}`);
    });

    ffmpeg.on('close', (code) => {
      // Check if the output file exists and has a non-zero size
      if (fs.existsSync(outputPathWithExtension) && fs.statSync(outputPathWithExtension).size > 0) {
        console.log('Audio extraction successful:', outputPathWithExtension);
        resolve(outputPathWithExtension);
      } else {
        reject(new Error(`FFmpeg failed with exit code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`FFmpeg encountered an error: ${err.message}`));
    });
  });
}

// function convertVideoToAudio(videoPath, outputAudioPath) {
//   return new Promise((resolve, reject) => {
//     const outputPathWithExtension = outputAudioPath.endsWith('.mp3')
//       ? outputAudioPath
//       : `${outputAudioPath}.mp3`;

//     // Add the "-y" flag to auto-confirm overwrite
//     const ffmpeg = spawn('ffmpeg', ['-y', '-i', videoPath, '-q:a', '0', '-map', 'a', outputPathWithExtension]);

//     ffmpeg.stderr.on('data', (data) => {
//       console.error(`FFmpeg error output: ${data.toString()}`);
//     });

//     ffmpeg.on('close', (code) => {
//       if (code === 0) {
//         // console.log('Audio extraction successful:', outputPathWithExtension);
//         resolve(outputPathWithExtension);
//       } else {
//         reject(new Error(`FFmpeg failed with exit code ${code}`));
//       }
//     });

//     ffmpeg.on('error', (err) => {
//       reject(new Error(`FFmpeg encountered an error: ${err.message}`));
//     });
//   });
// }


// Get duration of an audio file using ffmpeg
function getAudioDuration(inputPath) {
  return new Promise((resolve, reject) => {
    const ffmpegProcess = spawn('ffmpeg', ['-i', inputPath]);
    ffmpegProcess.stderr.on('data', (data) => {
      const output = data.toString();
      const match = output.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if (match) {
        const hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const seconds = parseFloat(match[3]);
        const totalSeconds = hours * 3600 + minutes * 60 + seconds;
        resolve(totalSeconds);
      }
    });
    ffmpegProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg process exited with code ${code}`));
      }
    });
  });
}

// Split audio file into chunks based on a max size (in MB)
// function splitAudioFile(inputPath, outputDir, maxChunkSizeMB = 20) {
//   return new Promise(async (resolve, reject) => {
//     try {
//       const duration = await getAudioDuration(inputPath);
//       const fileSizeMB = fs.statSync(inputPath).size / (1024 * 1024);
//       const bitrate = (fileSizeMB * 8) / duration;
//       const chunkDuration = (maxChunkSizeMB * 8) / bitrate;
//       const outputPattern = path.join(outputDir, 'chunk_%03d.mp3');

//       const ffmpegProcess = spawn('ffmpeg', [
//         '-i', inputPath,
//         '-f', 'segment',
//         '-segment_time', chunkDuration.toString(),
//         '-c', 'copy',
//         outputPattern
//       ]);

//       ffmpegProcess.stderr.on('data', (data) => {
//         //  console.log(`FFmpeg split output: ${data}`);
//       });

//       ffmpegProcess.on('close', (code) => {
//         if (code === 0) {
//           fs.readdir(outputDir, (err, files) => {
//             if (err) reject(err);
//             else {
//               const chunkPaths = files
//                 .filter(file => file.startsWith('chunk_'))
//                 .map(file => path.join(outputDir, file));
//               resolve(chunkPaths);
//             }
//           });
//         } else {
//           reject(new Error(`FFmpeg process exited with code ${code}`));
//         }
//       });
//     } catch (error) {
//       reject(error);
//     }
//   });
// }
function splitAudioFile(inputPath, outputDir, maxChunkSizeMB = 20) {
  return new Promise(async (resolve, reject) => {
    try {
      const duration = await getAudioDuration(inputPath);
      const fileSizeMB = fs.statSync(inputPath).size / (1024 * 1024);
      const bitrate = (fileSizeMB * 8) / duration;
      const chunkDuration = (maxChunkSizeMB * 8) / bitrate;
      const outputPattern = path.join(outputDir, 'chunk_%03d.mp3');

      const ffmpegProcess = spawn('ffmpeg', [
        '-i', inputPath,
        '-f', 'segment',
        '-segment_time', chunkDuration.toString(),
        '-c', 'copy',
        outputPattern
      ]);

      ffmpegProcess.stderr.on('data', (data) => {
        // Optionally log data for debugging
        // console.log(`FFmpeg split output: ${data.toString()}`);
      });

      ffmpegProcess.on('close', (code) => {
        // Check if output files exist regardless of exit code
        fs.readdir(outputDir, (err, files) => {
          if (err) {
            return reject(err);
          }
          const chunkPaths = files
            .filter(file => file.startsWith('chunk_'))
            .map(file => path.join(outputDir, file));
          if (chunkPaths.length > 0) {
            // Even if ffmpeg returned a non-zero code, we consider it a success if chunks exist.
            resolve(chunkPaths);
          } else {
            reject(new Error(`FFmpeg process exited with code ${code} and no chunks were created.`));
          }
        });
      });
    } catch (error) {
      reject(error);
    }
  });
}

function getFileStream(filePath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.once("open", (fd) => {
      if (fd === null) {
        reject(new Error("File descriptor is null"));
      } else {
        resolve(stream);
      }
    });
    stream.once("error", reject);
  });
}


// Transcribe an audio chunk using OpenAI's Whisper API
async function transcribeAudioToText(audioPath) {
  try {
    console.log("Sending file to OpenAI Whisper for transcription:", audioPath);
    const fileStream = await getFileStream(audioPath);
    const response = await openai.audio.transcriptions.create({
      file: fileStream,
      model: "whisper-1"
    });
    //console.log("Transcription API response:", response);

    // Adjust response extraction: use response.text if available
    const transcriptionText = response.text || (response.data && response.data.text);

    if (!transcriptionText) {
      throw new Error("Unexpected transcription API response");
    }
    return transcriptionText;
  } catch (error) {
    console.error("Error transcribing audio:", error);
    throw error;
  }
}

// Process audio/video file by extracting audio, splitting into chunks, and transcribing each chunk
async function processAudioVideo(filePath, originalName) {
  try {
    let textContent = '';

    // Include .webm as a supported video format
    if (originalName.endsWith('.mp4') || originalName.endsWith('.mkv') || originalName.endsWith('.webm')) {
      const audioPath = filePath.replace(/\.[^/.]+$/, ".mp3");
      await convertVideoToAudio(filePath, audioPath);

      const tempDir = path.join(path.dirname(audioPath), 'temp_chunks');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      const audioChunks = await splitAudioFile(audioPath, tempDir, 20);

      for (const chunk of audioChunks) {
        const chunkText = await transcribeAudioToText(chunk);
        textContent += chunkText + ' ';
        fs.unlinkSync(chunk);
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.unlinkSync(audioPath);
    } else if (originalName.endsWith('.mp3') || originalName.endsWith('.wav')) {
      const tempDir = path.join(path.dirname(filePath), 'temp_chunks');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      const audioChunks = await splitAudioFile(filePath, tempDir, 20);

      for (const chunk of audioChunks) {
        const chunkText = await transcribeAudioToText(chunk);
        textContent += chunkText + ' ';
        fs.unlinkSync(chunk);
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    } else {
      throw new Error('Unsupported file format for audio/video processing');
    }

    if (!textContent || textContent.trim().length === 0) {
      throw new Error('Transcription resulted in empty text');
    }
    return textContent;
  } catch (error) {
    console.error('Error processing audio/video file:', error);
    throw error;
  }
}


// -------------------------------------
// Endpoint for Video Evaluation using New Transcription Logic
router.post('/evaluate-videos', ensureDbConnection, async (req, res) => {
  try {
    const { submissionId } = req.body;

    if (!submissionId) {
      return res.status(400).json({
        success: false,
        message: 'submissionId is required'
      });
    }

    // Fetch the submission
    const submission = await Submission.findById(submissionId);
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    const videoResponses = submission.videoResponses;
    const evaluations = [];

    // Process each video response using the new transcription logic
    for (const videoResponse of videoResponses) {
      const videoUrl = videoResponse.videoUrl;

      // Step 1: Download the video file from S3
      const videoPath = await downloadFileFromS3(videoUrl);

      // Step 2: Transcribe the video using the new processAudioVideo function
      const transcription = await processAudioVideo(videoPath, videoResponse.fileName);

      // Step 3: Call the AI API to evaluate the transcription
      const evaluation = await evaluateTranscription(transcription, videoResponse.question);

      evaluations.push({
        question: videoResponse.question,
        transcription,
        evaluation
      });

      // Clean up: Delete the downloaded video file
      fs.unlinkSync(videoPath);
    }

    res.status(200).json({
      success: true,
      data: evaluations
    });
  } catch (err) {
    console.error('Error evaluating videos:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to evaluate videos',
      error: err.message
    });
  }
});

// Helper: Download file from S3
const downloadFileFromS3 = async (fileUrl) => {
  // Ensure the local 'temp' directory exists
  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Use the basename for the local file name
  const fileName = path.basename(fileUrl);
  const filePath = path.join(tempDir, fileName);

  // Extract the S3 key using URL parsing (this works regardless of region info)
  const urlObj = new URL(fileUrl);
  const key = urlObj.pathname.substring(1);

  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: key,
  };

  return new Promise((resolve, reject) => {
    s3.getObject(params)
      .createReadStream()
      .on('error', (err) => {
        console.error("Error in S3 getObject:", err);
        reject(err);
      })
      .pipe(fs.createWriteStream(filePath))
      .on('finish', () => resolve(filePath))
      .on('error', (err) => reject(err));
  });
};


// Function to evaluate transcription using the AI API
async function evaluateTranscription(transcription, question) {
  const scorePrompt = `Based on the provided transcription, please evaluate the candidate on the following criteria and return the evaluation in plain text using the format specified below.

  Criteria:
  1. Articulation and Clarity – Provide a score out of 5 and a brief insight.
  2. Technical Knowledge – Provide a score out of 5 and a brief insight.
  3. Depth and Detail – Provide a score out of 5 and a brief insight.
  4. Conversational Effectiveness – Provide a score out of 5 and a brief insight.
  
  Return the output exactly in this format:
  
  Articulation and Clarity: [score]/5
  Insight: [insight for articulation and clarity]
  
  Technical Knowledge: [score]/5
  Insight: [insight for technical knowledge]
  
  Depth and Detail: [score]/5
  Insight: [insight for depth and detail]
  
  Conversational Effectiveness: [score]/5
  Insight: [insight for conversational effectiveness]
  
  Text: ${transcription}`;
  
  const payload = {
    prompt: scorePrompt,
    subject: 0
  };
  

  const response = await axios.post('https://app.onepgr.com/session/generateAiResponse', payload, {
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    }

  });
  console.log(response.data.message)
  return response.data;

}

module.exports = router;