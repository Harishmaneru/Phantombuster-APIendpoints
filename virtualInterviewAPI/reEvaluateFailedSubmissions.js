require('dotenv').config();
const mongoose = require('mongoose');
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');

// AWS S3 configuration
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

const SubmissionSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  applicationLink: { type: String, required: true },
  hiringManagerEmail: { type: String, required: true },
  applicantName: { type: String, required: true },
  email: { type: String, required: true },
  linkedInUrl: { type: String, required: true },
  textQuestions: [{ type: String, required: true }],
  textResponses: [{ type: String, required: true }],
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
});

const Submission = mongoose.models.Submission || mongoose.model('Submission', SubmissionSchema);

async function downloadFileFromS3(fileUrl) {
  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const fileName = path.basename(fileUrl);
  const filePath = path.join(tempDir, fileName);

  const urlObj = new URL(fileUrl);
  const key = urlObj.pathname.substring(1);

  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: key,
  };

  return new Promise((resolve, reject) => {
    s3.getObject(params)
      .createReadStream()
      .on('error', (err) => reject(err))
      .pipe(fs.createWriteStream(filePath))
      .on('finish', () => resolve(filePath))
      .on('error', (err) => reject(err));
  });
}

function convertVideoToAudio(videoPath, audioPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', videoPath,
      '-vn',
      '-ar', '44100',
      '-ac', '2',
      '-b:a', '192k',
      audioPath
    ]);
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
    ffmpeg.on('error', reject);
  });
}

async function transcribeAudioToText(audioPath) {
  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (groqKey) {
    console.log(`  [Groq Whisper] Transcribing: ${audioPath}`);
    const form = new FormData();
    form.append('file', fs.createReadStream(audioPath));
    form.append('model', process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3');

    const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${groqKey}`
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    return response.data?.text || '';
  } else if (openaiKey) {
    console.log(`  [OpenAI Whisper] Transcribing: ${audioPath}`);
    const form = new FormData();
    form.append('file', fs.createReadStream(audioPath));
    form.append('model', 'whisper-1');

    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${openaiKey}`
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    return response.data?.text || '';
  } else {
    throw new Error('No transcription API key found. Please set GROQ_API_KEY in .env');
  }
}

async function processAudioVideo(filePath, originalName) {
  const audioPath = filePath.replace(/\.[^/.]+$/, ".mp3");
  await convertVideoToAudio(filePath, audioPath);
  try {
    const textContent = await transcribeAudioToText(audioPath);
    return textContent;
  } finally {
    if (fs.existsSync(audioPath)) {
      try { fs.unlinkSync(audioPath); } catch (e) {}
    }
  }
}

async function evaluateTranscriptionWithClaude(transcription, question) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  const scorePrompt = `
You will evaluate the candidate's response to an interview question.

Question: "${question}"
Transcription: "${transcription}"

First, check for a substantive answer:
  – If the transcription is fewer than 10 words, or
  – If it contains only generic phrases (e.g. "Thank you", "You", "Hi"), or
  – If it's entirely non-English or gibberish,

then assign 0/5 on all criteria with the insight:
  "Candidate did not provide a response."

Otherwise, compare the transcription to the question. For each criterion below, assign a score from 0–5 and in your insight:
  – Quote or paraphrase a specific excerpt.
  – Explain why it shows strength or weakness.
  – Suggest how to improve.

Criteria:
  1. Articulation and Clarity
  2. Technical Knowledge
  3. Depth and Detail
  4. Conversational Effectiveness

Return ONLY a valid JSON object in this exact schema (no markdown formatting, no backticks, no other text):
{
  "Articulation and Clarity": { "score": 0, "insight": "" },
  "Technical Knowledge": { "score": 0, "insight": "" },
  "Depth and Detail": { "score": 0, "insight": "" },
  "Conversational Effectiveness": { "score": 0, "insight": "" }
}
  `.trim();

  let rawText = null;

  // 1. Try Claude
  if (anthropicKey) {
    try {
      const model = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
      const systemPrompt = `You are an expert interviewer and subject-matter specialist. You evaluate the candidate's spoken response based strictly on the provided interview question and transcription. Output must be valid JSON only.`;

      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: model,
          max_tokens: 1500,
          system: systemPrompt,
          messages: [{ role: 'user', content: scorePrompt }]
        },
        {
          headers: {
            'x-api-key': anthropicKey.trim(),
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          timeout: 60000
        }
      );
      rawText = response.data?.content?.[0]?.text;
    } catch (apiErr) {
      console.warn('  Claude API scoring failed:', apiErr.response?.data?.error?.message || apiErr.message);
      if (!groqKey) {
        throw new Error(`Claude scoring failed: ${apiErr.response?.data?.error?.message || apiErr.message}`);
      }
    }
  }

  // 2. Fallback to Groq LLM
  if (!rawText && groqKey) {
    try {
      console.log('  [Scoring] Using Groq LLM fallback for scoring...');
      let groqModel = process.env.GROQ_LLM_MODEL;
      if (!groqModel || groqModel.includes('llama')) {
        groqModel = 'openai/gpt-oss-120b';
      }
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: groqModel,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: scorePrompt }]
        },
        {
          headers: { Authorization: `Bearer ${groqKey}` },
          timeout: 60000
        }
      );
      rawText = response.data?.choices?.[0]?.message?.content;
    } catch (groqErr) {
      console.error('  Groq LLM scoring call failed:', groqErr.response?.data || groqErr.message);
      throw new Error(`Scoring failed: ${groqErr.response?.data?.error?.message || groqErr.message}`);
    }
  }

  if (!rawText) throw new Error('Empty response from AI scoring service');

  try {
    const cleaned = rawText
      .replace(/<br\s*\/?>/gi, '')
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();
    return JSON.parse(cleaned);
  } catch (parseErr) {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error(`Invalid JSON from scoring service: ${rawText}`);
  }
}

async function reEvaluateSubmission(submission) {
  console.log(`\n======================================================`);
  console.log(`Processing candidate: ${submission.applicantName} (${submission.email})`);
  console.log(`Submission ID: ${submission._id}`);
  console.log(`Submitted At: ${submission.submittedAt}`);
  console.log(`Video count: ${submission.videoResponses?.length || 0}`);

  const evaluations = [];
  for (const videoResponse of submission.videoResponses) {
    console.log(`\n  Evaluating Question: "${videoResponse.question.substring(0, 70)}..."`);
    const videoUrl = videoResponse.videoUrl;
    console.log(`  Downloading video from S3...`);
    const videoPath = await downloadFileFromS3(videoUrl);

    try {
      console.log(`  Extracting audio and transcribing...`);
      const transcription = await processAudioVideo(videoPath, videoResponse.fileName);
      console.log(`  Transcription preview: "${transcription.substring(0, 80)}..." (${transcription.length} chars)`);

      console.log(`  Scoring with Claude...`);
      const evaluation = await evaluateTranscriptionWithClaude(transcription, videoResponse.question);
      console.log(`  Claude evaluation received successfully.`);

      evaluations.push({
        question: videoResponse.question,
        transcription,
        evaluation
      });
    } finally {
      if (fs.existsSync(videoPath)) {
        try { fs.unlinkSync(videoPath); } catch (e) {}
      }
    }
  }

  submission.score = evaluations;
  await submission.save();
  console.log(`\n SUCCESS: Updated submission ${submission._id} with new score!`);
  return evaluations;
}

async function run() {
  const targetId = process.argv[2];

  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.ONEPGR_MONGO_URI, { dbName: 'onepgr_apps' });
  console.log('MongoDB connected.');

  // Check required keys
  const anthropicKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!groqKey && !openaiKey) {
    console.error('ERROR: Neither GROQ_API_KEY nor OPENAI_API_KEY is found in .env for audio transcription!');
    process.exit(1);
  }

  if (!anthropicKey && !groqKey) {
    console.error('ERROR: Neither ANTHROPIC_API_KEY nor GROQ_API_KEY is found for scoring!');
    process.exit(1);
  }

  if (anthropicKey) {
    console.log('Using Claude for scoring (with Groq fallback).');
  } else {
    console.log('Using Groq LLM for scoring.');
  }

  let query = {};
  if (targetId) {
    query = { _id: targetId };
  } else {
    query = {
      $or: [
        { score: null },
        { 'score.error': { $exists: true } }
      ]
    };
  }

  const submissions = await Submission.find(query).sort({ submittedAt: -1 });
  console.log(`Found ${submissions.length} submission(s) to evaluate.`);

  for (const sub of submissions) {
    try {
      await reEvaluateSubmission(sub);
    } catch (err) {
      console.error(`FAILED to evaluate submission ${sub._id}:`, err.message);
      sub.score = { error: err.message };
      await sub.save();
    }
  }

  console.log('\nAll done!');
  process.exit(0);
}

run().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
