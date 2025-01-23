const { spawn } = require('child_process');
const fs = require('fs');
const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Main function to process video responses
const processVideoResponses = async ({ videoFiles }) => {
    if (!videoFiles || !Array.isArray(videoFiles) || videoFiles.length === 0) {
        throw new Error("videoFiles array is required.");
    }
    console.log('Processing video files:', videoFiles.length);

    const transcriptions = await processVideos(videoFiles);
    if (!transcriptions.length) {
        return { status: "0", message: "No transcriptions generated from videos" };
    }

    return { 
        status: "1", 
        message: "Video responses processed successfully", 
        data: transcriptions 
    };
};

// Process multiple videos
const processVideos = async (videoFiles) => {
    const transcriptions = [];
    
    for (const videoFile of videoFiles) {
        try {
            console.log('Processing video:', videoFile.path);
            const audioPath = await convertVideoToAudio(videoFile.path);
            const transcription = await transcribeAudio(audioPath);
            
            transcriptions.push({
                originalName: videoFile.originalname,
                transcription: transcription
            });

            // Cleanup temporary files
            cleanupFiles([audioPath, videoFile.path]);
        } catch (error) {
            console.error('Error processing video:', error.message);
        }
    }

    return transcriptions;
};

// Convert video to audio using FFmpeg
const convertVideoToAudio = async (videoPath) => {
    const audioPath = videoPath.replace(/\.[^/.]+$/, ".mp3");
    
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
            '-i', videoPath,
            '-q:a', '0',
            '-map', 'a',
            audioPath
        ]);

        ffmpeg.stderr.on('data', (data) => {
            console.log(`FFmpeg output: ${data}`);
        });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                console.log('Audio extraction successful:', audioPath);
                resolve(audioPath);
            } else {
                reject(new Error(`FFmpeg process failed with code ${code}`));
            }
        });

        ffmpeg.on('error', (err) => {
            reject(new Error(`FFmpeg error: ${err.message}`));
        });
    });
};

// Transcribe audio using OpenAI Whisper API
const transcribeAudio = async (audioPath) => {
    try {
        if (!fs.existsSync(audioPath)) {
            throw new Error(`Audio file not found: ${audioPath}`);
        }

        const response = await openai.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            model: 'whisper-1',
        });

        return response.text;
    } catch (error) {
        console.error('Transcription error:', error);
        throw error;
    }
};

// Helper function to cleanup temporary files
const cleanupFiles = (filePaths) => {
    for (const filePath of filePaths) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log('Cleaned up file:', filePath);
            }
        } catch (error) {
            console.error('Error cleaning up file:', filePath, error);
        }
    }
};

// Example router implementation
const express = require('express');
const multer = require('multer');
const router = express.Router();

// Configure multer for video uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + '.mp4');
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Only video files are allowed'));
        }
    }
});

// Route handler
router.post('/process-videos', 
    upload.array('videos', 3),
    async (req, res) => {
        try {
            console.log('Received request with files:', req.files);
            const response = await processVideoResponses({ videoFiles: req.files });
            res.status(200).json(response);
        } catch (error) {
            console.error('Error in route handler:', error);
            res.status(500).json({ status: "-1", message: error.message });
        }
    }
);

module.exports = { 
    router,
    processVideoResponses,
    processVideos,
    convertVideoToAudio,
    transcribeAudio
};