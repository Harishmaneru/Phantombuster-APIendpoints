require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const router = express.Router();

const KEYFILE_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL; // your admin@domain.com

let authClient;
try {
  const key = JSON.parse(fs.readFileSync(KEYFILE_PATH));
  authClient = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/admin.directory.user'],
    subject: ADMIN_EMAIL, // impersonate domain admin
  });
  console.log('✅ Auth client initialized');
} catch (err) {
  console.error('❌ Failed to initialize auth client:', err.message);
  process.exit(1);
}

// Create Email Account
router.post('/google/email/create', async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const service = google.admin({ version: 'directory_v1', auth: authClient });

    const response = await service.users.insert({
      requestBody: {
        name: {
          givenName: firstName,
          familyName: lastName
        },
        password,
        primaryEmail: email
      }
    });

    res.json({
      success: true,
      data: response.data
    });
  } catch (err) {
    console.error('❌ Email creation error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      details: err.errors || null
    });
  }
});

// Health Check
router.get('/google/email/health', async (req, res) => {
  try {
    await authClient.authorize();
    res.json({ success: true, message: 'Google Email API is healthy' });
  } catch (err) {
    console.error('❌ Health check error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
