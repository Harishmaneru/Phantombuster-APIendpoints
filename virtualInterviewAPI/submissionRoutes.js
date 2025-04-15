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
const crypto = require('crypto');


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
      // Determine the folder based on file type
      const folder = file.mimetype.startsWith('video/') ? 'videos' : 'resumes';
      cb(null, `${folder}/${Date.now()}-${file.originalname}`);
    }
  }),
  fileFilter: function (req, file, cb) {
    // Accept video files and document files
    const allowedMimeTypes = [
      'video/mp4',
      'video/webm',
      'video/quicktime',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video and document files are allowed.'));
    }
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
  resume: {
    url: { type: String },
    fileName: { type: String },
    mimeType: { type: String }
  },
  videoResponses: [{
    questionIndex: { type: Number, required: true },
    question: { type: String, required: true },
    videoUrl: { type: String, required: true },
    fileName: { type: String },
    mimeType: { type: String }
  }],
  score: { type: mongoose.Schema.Types.Mixed, default: null },
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

  const mongoURI = process.env.ONEPGR_MONGO_URI

  const options = {
    serverSelectionTimeoutMS: 120000,
    socketTimeoutMS: 120000,
    connectTimeoutMS: 60000,
    maxPoolSize: 10,
    wtimeoutMS: 30000,
    keepAlive: true,
    keepAliveInitialDelay: 300000,
    dbName: 'onepgr_apps'  // Explicitly specify database name
  };

  try {
    logSubmissionActivity('DB Connection Attempt', { uri: mongoURI.replace(/\/\/.*@/, '//****@') });
    await mongoose.connect(mongoURI, options);
    logSubmissionActivity('DB Connection', { status: 'success', database: 'onepgr_apps' });
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
  // host: 'smtp.gmail.com',
  // port: 465,
  service: 'gmail',
  // secure: true,
  auth: {
    user: 'admin@recordedinterview.com',
    pass: process.env.EMAIL_PASSWORD,
  },
});


// Immediately verify transporter on module load
(async function () {
  try {
    const verification = await transporter.verify();
    console.log('Initial email transporter verification:', verification);
  } catch (error) {
    console.error('Initial email transporter verification failed:', error.message);
    console.error('This will likely cause email sending to fail');
  }
})();

// Verify transporter connection
async function verifyEmailTransporter() {
  try {
    const verification = await transporter.verify();
    console.log('Email transporter verified successfully:', verification);
    return true;
  } catch (error) {
    console.error('Email transporter verification failed:', error);
    return false;
  }
}

// Helper function to send emails (unchanged)
async function sendSubmissionEmails(submission, sendSummary) {
  try {
    // Verify email transporter first
    const isTransporterValid = await verifyEmailTransporter();
    if (!isTransporterValid) {
      console.error('Email transporter is not valid, skipping email sending');
      return { success: false, error: 'Email transporter is not valid' };
    }

    const { applicantName, email, applicationLink, hiringManagerEmail, linkedInUrl, submittedAt } = submission;

    // Get interview details to get company name
    const interview = await mongoose.model('Interview').findOne({
      applicationLink: submission.applicationLink
    });

    const companyName = (() => {
      if (interview?.companyUrl) {
        const url = interview.companyUrl;

        if (url.startsWith('@https://')) {
          // Extract domain name without TLD
          const domain = new URL(url.substring(1)).hostname;
          // Remove .com, .org, etc. and return company name
          return domain.split('.')[0];
        }

        // Handle regular URLs (without @ prefix)
        try {
          // Try to create a URL object
          const urlObj = new URL(url);
          // Extract the hostname without www. if present
          const hostname = urlObj.hostname.replace(/^www\./, '');
          // Extract the domain name without TLD (.com, .org, etc.)
          const domainParts = hostname.split('.');
          if (domainParts.length >= 1) {
            // Format the company name nicely - TalentBoxLabsInc -> TalentBoxLabs, Inc
            let name = domainParts[0];
            // Check if domain contains "Inc" at the end
            if (/Inc$/i.test(name)) {
              name = name.replace(/Inc$/i, ', Inc');
            }
            return name;
          }
        } catch (e) {
          // If URL parsing fails, just return the URL as is
          console.error('Failed to parse company URL:', e);
        }

        return url;
      }
      return "Our Team";
    })();

    console.log(`Sending emails for submission from ${applicantName} to ${hiringManagerEmail}`);

    // Email to Hiring Manager
    const hmEmailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; text-align: left;">
        <h4 style="color: #2d3748;">New Application Submission Received</h4>
        <p style="color: #4a5568;"><strong>Applicant Name:</strong> ${applicantName}</p>
        <p style="color: #4a5568;"><strong>Applicant Email:</strong> ${email}</p>
        <p style="color: #4a5568;"><strong>LinkedIn URL:</strong> <a href="${linkedInUrl}">${linkedInUrl}</a></p>
        <p style="color: #4a5568;">
        <strong>Application Link:</strong> 
        <a href="https://record.onepgr.com/InterviewPage/${applicationLink}" 
        style="word-break: break-all; color: #3182ce; text-decoration: underline;">
        https://record.onepgr.com/InterviewPage/${applicationLink}
        </a>
        </p> 
        <p style="color: #4a5568;"><strong>Submitted At:</strong> ${submittedAt.toLocaleString()}</p>
        <p style="margin-top: 20px; color: #718096;">Best regards,<br/>${companyName} Hiring Team</p>
      </div>
    `;

    const hmMailOptions = {
      from: 'RecordedInterview <admin@recordedinterview.com>',
      to: hiringManagerEmail,
      subject: `[${companyName}] New Application Received - ${applicantName}`,
      html: hmEmailBody
    };

    try {
      console.log(`Attempting to send hiring manager email to: ${hiringManagerEmail}`);
      let infoHM = await transporter.sendMail(hmMailOptions);
      console.log(`Hiring Manager Email sent: ${infoHM.messageId}`);
    } catch (error) {
      console.error(`Error sending Hiring Manager Email: ${error.message}`);
      console.error('Error details:', error);
      return { success: false, error: `Failed to send hiring manager email: ${error.message}` };
    }

    // Email to Applicant (if they opted in)
    if (sendSummary) {
      const applicantEmailBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; text-align: left;">
          <h3 style="color: #2d3748;">Thank You for Your Application!</h3>
          <p style="color: #4a5568;">Dear ${applicantName},</p>
          <p style="color: #4a5568;">Thank you for submitting your application to ${companyName}. Here's a summary of your submission:</p>
          <ul style="color: #4a5568; list-style: none; padding-left: 0;">
            <li><strong>Applicant Name:</strong> ${applicantName}</li>
            <li><strong>Email:</strong> ${email}</li>
            <li><strong>LinkedIn URL:</strong> <a href="${linkedInUrl}">${linkedInUrl}</a></li>
            <li>
            <strong>Application Link:</strong> 
            <a href="https://record.onepgr.com/InterviewPage/${applicationLink}">
            https://record.onepgr.com/InterviewPage/${applicationLink}
            </a>
            </li>
            <li><strong>Submitted At:</strong> ${submittedAt.toLocaleString()}</li>
          </ul>
          <p style="color: #4a5568;">We appreciate your interest in ${companyName} and will review your application carefully.</p>
          <p style="margin-top: 20px; color: #718096;">Best regards,<br/>${companyName} Hiring Team</p>
        </div>
      `;

      const applicantMailOptions = {
        from: 'RecordedInterview <admin@recordedinterview.com>',
        to: email,
        subject: `Application Confirmation - ${companyName}`,
        html: applicantEmailBody
      };

      try {
        console.log(`Attempting to send applicant email to: ${email}`);
        let infoApp = await transporter.sendMail(applicantMailOptions);
        console.log(`Applicant Email sent: ${infoApp.messageId}`);
      } catch (error) {
        console.error(`Error sending Applicant Email: ${error.message}`);
        console.error('Error details:', error);
        return { success: false, error: `Failed to send applicant email: ${error.message}` };
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Unexpected error in sendSubmissionEmails:', error);
    return { success: false, error: `Unexpected error: ${error.message}` };
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

async function evaluateSubmissionVideos(submission) {
  const videoResponses = submission.videoResponses;
  const evaluations = [];

  for (const videoResponse of videoResponses) {
    const videoUrl = videoResponse.videoUrl;
    const videoPath = await downloadFileFromS3(videoUrl);
    const transcription = await processAudioVideo(videoPath, videoResponse.fileName);
    const evaluation = await evaluateTranscription(transcription, videoResponse.question);
    evaluations.push({
      question: videoResponse.question,
      transcription,
      evaluation
    });
    fs.unlinkSync(videoPath);
  }
  return evaluations;
}

// router.post('/submit', ensureDbConnection, handleUpload, async (req, res) => {
//   let savedId = null;
//   let savedSubmission = null;

//   try {
//     // logSubmissionActivity('Request Received', {
//     //   userId: req.body.userId,
//     //   applicationLink: req.body.applicationLink,
//     //   hiringManagerEmail: req.body.hiringManagerEmail,
//     //   applicantName: req.body.applicantName,
//     //   email: req.body.email,
//     //   linkedInUrl: req.body.linkedInUrl,
//     //   filesCount: req?.files?.length || 0
//     // });

//     // Check database connection state
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

//     // Increment application count in Interview model
//     const interview = await mongoose.model('Interview').findOneAndUpdate(
//       { applicationLink },
//       { $inc: { applicationCount: 1 } },
//       { new: true }
//     );

//     if (!interview) {
//       throw new Error('Interview not found');
//     }

//     // Process files: separate videos and resume
//     const videoResponses = [];
//     let resume = null;

//     for (const file of req.files) {
//       if (file.mimetype.startsWith('video/')) {
//         const questionNumber = videoResponses.length + 1;
//         const question = req.body[`videoQuestion${questionNumber}`];

//         logSubmissionActivity('Processing Video File', {
//           index: questionNumber,
//           fileName: file.originalname,
//           mimeType: file.mimetype,
//           size: file.size,
//           question
//         });

//         videoResponses.push({
//           questionIndex: questionNumber,
//           question: question,
//           videoUrl: file.location,
//           fileName: file.originalname,
//           mimeType: file.mimetype
//         });
//       } else if (file.mimetype === 'application/pdf' ||
//         file.mimetype === 'application/msword' ||
//         file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {

//         // resume file size validation (50MB max)
//         const resumeSizeMB = file.size / (1024 * 1024);
//         if (resumeSizeMB > 50) {
//           return res.status(400).json({
//             success: false,
//             message: 'Resume file size exceeds 50MB limit'
//           });
//         }

//         logSubmissionActivity('Processing Resume File', {
//           fileName: file.originalname,
//           mimeType: file.mimetype,
//           size: file.size
//         });

//         resume = {
//           url: file.location,
//           fileName: file.originalname,
//           mimeType: file.mimetype
//         };
//       }
//     }

//     const submission = new Submission({
//       userId,
//       applicationLink,
//       hiringManagerEmail,
//       applicantName,
//       email,
//       linkedInUrl,
//       textQuestion,
//       textResponse,
//       videoResponses,
//       resume
//     });

//     savedSubmission = await submission.save();
//     savedId = savedSubmission._id;

//     const verifySubmission = await Submission.findById(savedId);

//     if (!verifySubmission) {
//       throw new Error('Submission verification failed');
//     }

//     logSubmissionActivity('Submission Saved', {
//       submissionId: savedId,
//       verified: !!verifySubmission,
//       hasResume: !!resume,
//       videoCount: videoResponses.length
//     });

//     // Check if the applicant requested an email summary.
//     const sendSummary = req.body.receiveEmailSummary === 'true';

//     // Send emails
//     const emailResult = await sendSubmissionEmails(savedSubmission, sendSummary);

//     // Log email status
//     if (!emailResult.success) {
//       logSubmissionActivity('Email Sending Error', { error: emailResult.error });
//       console.error('Failed to send notification emails:', emailResult.error);
//     } else {
//       logSubmissionActivity('Email Sending Success', { success: true });
//     }

//     try {
//       if (savedSubmission.videoResponses && savedSubmission.videoResponses.length > 0) {
//         const evaluations = await evaluateSubmissionVideos(savedSubmission);
//         savedSubmission.score = evaluations;
//         await savedSubmission.save();
//         logSubmissionActivity('Evaluation Completed', { submissionId: savedId, score: evaluations });
//       }
//     } catch (evalError) {
//       logSubmissionActivity('Evaluation Error', { error: evalError.message });
//       // Optionally, update the submission score field with an error message
//       savedSubmission.score = { error: evalError.message };
//       await savedSubmission.save();
//     }

//     res.status(201).json({
//       success: true,
//       message: 'Submission saved successfully',
//       data: {
//         submissionId: savedId,
//         submittedAt: new Date(),
//         emailStatus: emailResult.success ? 'sent' : 'failed',
//         emailError: emailResult.success ? null : emailResult.error,
//         applicationCount: interview.applicationCount,
//         hasResume: !!resume,
//         videoCount: videoResponses.length
//       }
//     });

//   } catch (err) {
//     logSubmissionActivity('Error', {
//       error: err.message,
//       stack: err.stack,
//       phase: savedId ? 'post-save' : 'pre-save'
//     });

//     if (!res.headersSent) {
//       res.status(500).json({
//         success: false,
//         message: 'Failed to process submission',
//         error: err.message
//       });
//     }
//   }
// });

router.post('/submit', ensureDbConnection, handleUpload, async (req, res) => {
  let savedId = null;
  let savedSubmission = null;

  try {
    logSubmissionActivity('Flow Start', { message: 'Received submission request' });

    // Check database connection state
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

    // Validate required fields
    if (
      !userId ||
      !applicationLink ||
      !hiringManagerEmail ||
      !applicantName ||
      !email ||
      !linkedInUrl ||
      !textResponse ||
      !textQuestion ||
      !req.files ||
      req.files.length === 0
    ) {
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
    logSubmissionActivity('Validation Passed', {});

    // Increment application count in Interview model
    const interview = await mongoose.model('Interview').findOneAndUpdate(
      { applicationLink },
      { $inc: { applicationCount: 1 } },
      { new: true }
    );
    if (!interview) {
      throw new Error('Interview not found');
    }
    logSubmissionActivity('Interview Updated', { applicationCount: interview.applicationCount });

    // Process files: separate videos and resume
    const videoResponses = [];
    let resume = null;
    for (const file of req.files) {
      if (file.mimetype.startsWith('video/')) {
        const questionNumber = videoResponses.length + 1;
        const question = req.body[`videoQuestion${questionNumber}`];
        logSubmissionActivity('Processing Video File', {
          index: questionNumber,
          fileName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          question
        });
        videoResponses.push({
          questionIndex: questionNumber,
          question: question,
          videoUrl: file.location,
          fileName: file.originalname,
          mimeType: file.mimetype
        });
      } else if (
        file.mimetype === 'application/pdf' ||
        file.mimetype === 'application/msword' ||
        file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        // Resume file size validation (50MB max)
        const resumeSizeMB = file.size / (1024 * 1024);
        if (resumeSizeMB > 50) {
          logSubmissionActivity('Resume File Rejected', { fileName: file.originalname, sizeMB: resumeSizeMB });
          return res.status(400).json({
            success: false,
            message: 'Resume file size exceeds 50MB limit'
          });
        }
        logSubmissionActivity('Processing Resume File', {
          fileName: file.originalname,
          mimeType: file.mimetype,
          size: file.size
        });
        resume = {
          url: file.location,
          fileName: file.originalname,
          mimeType: file.mimetype
        };
      }
    }
    logSubmissionActivity('File Processing Completed', {
      videoCount: videoResponses.length,
      hasResume: !!resume
    });

    // Create the submission record in the database
    const submission = new Submission({
      userId,
      applicationLink,
      hiringManagerEmail,
      applicantName,
      email,
      linkedInUrl,
      textQuestion,
      textResponse,
      videoResponses,
      resume
    });
    savedSubmission = await submission.save();
    savedId = savedSubmission._id;
    logSubmissionActivity('Submission Saved', { submissionId: savedId });

    const verifySubmission = await Submission.findById(savedId);
    if (!verifySubmission) {
      throw new Error('Submission verification failed');
    }
    logSubmissionActivity('Submission Verified', { submissionId: savedId });

    // Check if the applicant requested an email summary.
    const sendSummary = req.body.receiveEmailSummary === 'true';

    // Send emails
    const emailResult = await sendSubmissionEmails(savedSubmission, sendSummary);
    if (!emailResult.success) {
      logSubmissionActivity('Email Sending Error', { error: emailResult.error });
      console.error('Failed to send notification emails:', emailResult.error);
    } else {
      logSubmissionActivity('Email Sending Success', { success: true });
    }

    // Send immediate response to client so that the heavy processing doesn't hold up the response.
    res.status(201).json({
      success: true,
      message: 'Submission saved successfully. Processing in background.',
      data: {
        submissionId: savedId,
        submittedAt: new Date(),
        emailStatus: emailResult.success ? 'sent' : 'failed',
        emailError: emailResult.success ? null : emailResult.error,
        applicationCount: interview.applicationCount,
        hasResume: !!resume,
        videoCount: videoResponses.length
      }
    });
    logSubmissionActivity('Response Sent to Client', { submissionId: savedId });

    // Background processing for video evaluations
    setImmediate(async () => {
      try {
        logSubmissionActivity('Background Processing Started', { submissionId: savedId });
        if (savedSubmission.videoResponses && savedSubmission.videoResponses.length > 0) {
          const evaluations = await evaluateSubmissionVideos(savedSubmission);
          savedSubmission.score = evaluations;
          await savedSubmission.save();
          logSubmissionActivity('Evaluation Completed (Background)', {
            submissionId: savedId,
            score: evaluations
          });
        } else {
          logSubmissionActivity('No Video Responses to Evaluate', { submissionId: savedId });
        }
      } catch (evalError) {
        logSubmissionActivity('Evaluation Error (Background)', { error: evalError.message });
        // Optionally update the submission with an error message
        savedSubmission.score = { error: evalError.message };
        await savedSubmission.save();
      }
    });
  } catch (err) {
    logSubmissionActivity('Error', {
      error: err.message,
      stack: err.stack,
      phase: savedId ? 'post-save' : 'pre-save'
    });
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to process submission',
        error: err.message
      });
    }
  }
});








//=======================================================================================================

// -------------------------
// DELETE /submissions/:submissionId route
router.delete('/submissions/:submissionId', ensureDbConnection, async (req, res) => {
  try {
    const submissionId = req.params.submissionId;

    // Fetch the submission
    const submission = await Submission.findById(submissionId);
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    // Extract S3 keys from video URLs
    const keys = submission.videoResponses.map(video => {
      const videoUrl = video.videoUrl;
      const parsedUrl = new URL(videoUrl);
      // Decode URI components to handle special characters
      return decodeURIComponent(parsedUrl.pathname.substring(1));
    });

    // Delete S3 objects
    if (keys.length > 0) {
      try {
        await deleteS3Objects(keys);
      } catch (s3Error) {
        console.error('Error deleting S3 objects:', s3Error);
        return res.status(500).json({
          success: false,
          message: 'Failed to delete one or more videos from S3',
          error: s3Error.message
        });
      }
    }

    // Delete the submission from MongoDB
    await Submission.deleteOne({ _id: submissionId });

    res.status(200).json({
      success: true,
      message: 'Submission and associated videos deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting submission:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete submission',
      error: error.message
    });
  }
});

// Helper function to delete multiple S3 objects
async function deleteS3Objects(keys) {
  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Delete: {
      Objects: keys.map(key => ({ Key: key })),
      Quiet: false // Return detailed delete results
    }
  };

  const response = await s3.deleteObjects(params).promise();

  // Check for errors in the response
  if (response.Errors && response.Errors.length > 0) {
    const errors = response.Errors.map(error => ({
      key: error.Key,
      code: error.Code,
      message: error.Message
    }));
    throw new Error(`Failed to delete some S3 objects: ${JSON.stringify(errors)}`);
  }

  return response;
}

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

    // Only exclude videoResponses if includeVideos is false, always include resume
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

// Ensure logs directory exists
const ensureLogsDirectory = () => {
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    ffmpegLogger.info('Created logs directory', { path: logsDir });
  }
};

// Create logs directory when module is loaded
ensureLogsDirectory();

// Convert video to audio (.mp3) using ffmpeg
function convertVideoToAudio(videoPath, outputAudioPath) {
  return new Promise((resolve, reject) => {
    const outputPathWithExtension = outputAudioPath.endsWith('.mp3')
      ? outputAudioPath
      : `${outputAudioPath}.mp3`;

    const ffmpegArgs = ['-y', '-i', videoPath, '-vn', '-q:a', '0', '-map', 'a', outputPathWithExtension];
    console.log(`[FFMPEG] Running command: ffmpeg ${ffmpegArgs.join(' ')}`);

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    let errorData = '';
    // Collect any error messages from FFmpeg
    ffmpegProcess.stderr.on('data', (data) => {
      errorData += data.toString();
    });

    ffmpegProcess.on('close', (code) => {
      // Check if the file exists and it has a non-zero size
      if (fs.existsSync(finalAudioPath) && fs.statSync(finalAudioPath).size > 0) {
        const fileSizeBytes = fs.statSync(finalAudioPath).size;
        console.log(`[FFMPEG INFO] Audio extraction successful. Audio file size: ${fileSizeBytes} bytes`);
        resolve(finalAudioPath);
      } else {
        console.error(`[FFMPEG ERROR] Audio extraction failed with exit code ${code}. Error: ${errorData.trim()}`);
        reject(new Error(`FFmpeg failed with exit code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      console.error(`[FFMPEG ERROR] FFmpeg encountered an error: ${err.message}`);
      reject(new Error(`FFmpeg encountered an error: ${err.message}`));
    });
  });
}

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
        ffmpegLogger.info('Audio duration calculated', {
          inputPath,
          duration: { hours, minutes, seconds, totalSeconds }
        });
        resolve(totalSeconds);
      }
    });
    ffmpegProcess.on('close', (code) => {
      if (code !== 0) {
        const error = new Error(`FFmpeg process exited with code ${code}`);
        ffmpegLogger.error('Failed to get audio duration', { error: error.message, code });
        reject(error);
      }
    });
  });
}

// Split audio file into chunks based on a max size (in MB)
function splitAudioFile(inputPath, outputDir, maxChunkSizeMB = 20) {
  return new Promise(async (resolve, reject) => {
    try {
      const duration = await getAudioDuration(inputPath);
      const fileSizeMB = fs.statSync(inputPath).size / (1024 * 1024);
      const bitrate = (fileSizeMB * 8) / duration;
      const chunkDuration = (maxChunkSizeMB * 8) / bitrate;
      const outputPattern = path.join(outputDir, 'chunk_%03d.mp3');

      ffmpegLogger.info('Splitting audio file', {
        inputPath,
        duration,
        fileSizeMB,
        bitrate,
        chunkDuration,
        outputPattern
      });

      const ffmpegProcess = spawn('ffmpeg', [
        '-i', inputPath,
        '-f', 'segment',
        '-segment_time', chunkDuration.toString(),
        '-c', 'copy',
        outputPattern
      ]);

      ffmpegProcess.stderr.on('data', (data) => {
        const message = data.toString().trim();
        if (message) {
          ffmpegLogger.info('FFmpeg split progress', { message });
        }
      });

      ffmpegProcess.on('close', (code) => {
        fs.readdir(outputDir, (err, files) => {
          if (err) {
            ffmpegLogger.error('Error reading output directory', { error: err.message });
            return reject(err);
          }
          const chunkPaths = files
            .filter(file => file.startsWith('chunk_'))
            .map(file => path.join(outputDir, file));
          if (chunkPaths.length > 0) {
            ffmpegLogger.info('Audio split successful', {
              chunksCreated: chunkPaths.length,
              outputDir
            });
            resolve(chunkPaths);
          } else {
            const error = new Error(`FFmpeg process exited with code ${code} and no chunks were created.`);
            ffmpegLogger.error('Audio split failed', { error: error.message, code });
            reject(error);
          }
        });
      });

      ffmpegProcess.on('error', (err) => {
        ffmpegLogger.error('FFmpeg process error', { error: err.message });
        reject(err);
      });
    } catch (error) {
      ffmpegLogger.error('Error in splitAudioFile', { error: error.message });
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
    console.log(`[Whisper] Starting transcription for: ${audioPath}`);
    const fileStream = await getFileStream(audioPath);
    const response = await openai.audio.transcriptions.create({
      file: fileStream,
      model: "whisper-1"
    });

    const transcriptionText = response.text || (response.data && response.data.text);

    if (!transcriptionText) {
      const error = new Error("Unexpected transcription API response");
      ffmpegLogger.error('Transcription failed', { error: error.message });
      throw error;
    }

    console.log(`[Whisper] Transcription completed successfully. Length: ${transcriptionText.length} characters`);
    return transcriptionText;
  } catch (error) {
    console.error(`[Whisper ERROR] Transcription failed: ${error.message}`);
    throw error;
  }
}

// Process audio/video file by extracting audio, splitting into chunks, and transcribing each chunk
async function processAudioVideo(filePath, originalName) {
  try {
    let textContent = '';

    if (originalName.endsWith('.mp4') || originalName.endsWith('.mkv') || originalName.endsWith('.webm')) {
      const audioPath = filePath.replace(/\.[^/.]+$/, ".mp3");
      await convertVideoToAudio(filePath, audioPath);

      const fileSizeMB = fs.statSync(audioPath).size / (1024 * 1024);
      if (fileSizeMB <= 20) {
        // If the file is small, transcribe it directly
        textContent = await transcribeAudioToText(audioPath);
      } else {
        // Split the file into chunks
        const tempDir = path.join(path.dirname(audioPath), 'temp_chunks');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const audioChunks = await splitAudioFile(audioPath, tempDir, 20);
        for (const chunk of audioChunks) {
          const chunkText = await transcribeAudioToText(chunk);
          textContent += chunkText + ' ';
          fs.unlinkSync(chunk);
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
      }

      fs.unlinkSync(audioPath);
    } else {
      throw new Error('Unsupported file format for audio/video processing');
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

      const videoPath = await downloadFileFromS3(videoUrl);

      const transcription = await processAudioVideo(videoPath, videoResponse.fileName);

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

// New GET endpoint to fetch the evaluation/score for a submission
router.get('/score/:submissionId', ensureDbConnection, async (req, res) => {
  try {
    const submissionId = req.params.submissionId;
    const submission = await Submission.findById(submissionId, { score: 1 });
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }
    res.status(200).json({
      success: true,
      data: submission.score
    });
  } catch (error) {
    console.error('Error fetching score:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch score',
      error: error.message
    });
  }
});

// ===================================================
// SHARE LINK LOGIC 
// ===================================================


// 1) SharedLink schema
const SharedLinkSchema = new mongoose.Schema({
  submissionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Submission',
    required: true
  },
  token: {
    type: String,
    required: true,
    unique: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    default: null
  }
});

const SharedLink = mongoose.model('SharedLink', SharedLinkSchema);


router.post('/share/generate', ensureDbConnection, async (req, res) => {
  try {
    const { submissionId } = req.body;
    if (!submissionId) {
      return res.status(400).json({
        success: false,
        message: 'submissionId is required'
      });
    }

    const submission = await Submission.findById(submissionId);
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    const token = crypto.randomBytes(16).toString('hex');
    // const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); 

    await SharedLink.create({
      submissionId,
      token
      // expiresAt
    });

    // Construct share URL
    const shareLink = `https://record.onepgr.com/candidate_response/${token}?id=${submissionId}`;

    return res.status(200).json({
      success: true,
      shareLink
    });
  } catch (error) {
    console.error('Error generating share link:', error);
    return res.status(500).json({
      success: false,
      message: 'Error generating share link',
      error: error.message
    });
  }
});


router.get('/share/:token', ensureDbConnection, async (req, res) => {
  try {
    const { token } = req.params;
    const { id } = req.query;

    const link = await SharedLink.findOne({ token, submissionId: id });
    if (!link) {
      return res.status(404).json({
        success: false,
        message: 'Invalid or expired share link'
      });
    }


    // if (link.expiresAt && link.expiresAt < new Date()) {
    //   return res.status(410).json({ success: false, message: 'Link has expired' });
    // }

    const submission = await Submission.findById(id);
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: submission
    });
  } catch (error) {
    console.error('Error validating share token:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error validating share token',
      error: error.message
    });
  }
});

/**
 * POST /share/sendEmail
==================================
 */
router.post('/share/sendEmail', ensureDbConnection, async (req, res) => {
  try {
    const { recipients, subject, message, isPublic } = req.body;

    // Verify email transporter first
    const isTransporterValid = await verifyEmailTransporter();
    if (!isTransporterValid) {
      console.error('Email transporter is not valid, skipping email sending');
      return res.status(500).json({
        success: false,
        message: 'Email service is not available at the moment'
      });
    }

    if (!recipients || !subject || !message) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields (recipients, subject, message)'
      });
    }

    const emailList = recipients
      .split(',')
      .map((email) => email.trim())
      .filter(Boolean);

    if (emailList.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid email addresses provided'
      });
    }

    console.log("Is public?", isPublic);
    console.log(`Attempting to send shared link emails to ${emailList.length} recipients: ${emailList.join(', ')}`);

    // Define mail options
    const mailOptions = {
      from: 'admin@recordedinterview.com',
      to: emailList,
      subject,
      html: message
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      console.log("Email sent:", info.messageId);
      console.log("Email recipients:", info.accepted.join(', '));

      if (info.rejected && info.rejected.length > 0) {
        console.error("Some recipients were rejected:", info.rejected.join(', '));
      }

      return res.status(200).json({
        success: true,
        message: 'Emails sent successfully',
        details: {
          messageId: info.messageId,
          accepted: info.accepted,
          rejected: info.rejected || []
        }
      });
    } catch (error) {
      console.error('Error in transporter.sendMail:', error.message);
      console.error('Error details:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to send emails',
        error: error.message
      });
    }
  } catch (error) {
    console.error('Error sending email:', error.message);
    console.error('Error stack:', error.stack);
    return res.status(500).json({
      success: false,
      message: 'Failed to send emails',
      error: error.message
    });
  }
});

// Add route to check email service status
router.get('/email-status', async (req, res) => {
  try {
    const isValid = await verifyEmailTransporter();
    res.status(200).json({
      success: true,
      emailServiceActive: isValid,
      smtpConfig: {
        service: 'gmail',
        user: 'admin@recordedinterview.com',
        authProvided: !!process.env.EMAIL_PASSWORD
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      emailServiceActive: false,
      error: error.message
    });
  }
});

module.exports = router;