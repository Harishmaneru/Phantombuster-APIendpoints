

require('dotenv').config();
const express = require('express');
const axios = require('axios');

const router = express.Router();

const CPANEL_HOST = process.env.CPANEL_HOST;        // e.g., 'hosting.example.com'
const CPANEL_USER = process.env.CPANEL_USER;        // your cPanel username
const CPANEL_TOKEN = process.env.CPANEL_TOKEN;      // API token generated in cPanel
const CPANEL_PORT = process.env.CPANEL_PORT || 2083;

/**
 * Create an email account via cPanel UAPI: Email::add_pop
 * @param {string} domain - Domain name (e.g., 'example.com')
 * @param {string} user - Mailbox name (e.g., 'alice')
 * @param {string} password - Strong mailbox password
 * @param {number} [quota=250] - Quota in MB (0 for unlimited)
 */
async function createEmailAccount(domain, user, password, quota = 250) {
  const url = `https://${CPANEL_HOST}:${CPANEL_PORT}/execute/Email/add_pop`;
  const params = {
    email: user,
    domain,
    password,
    quota
  };

  // cPanel authentication via API token
  const authHeader = `cpanel ${CPANEL_USER}:${CPANEL_TOKEN}`;
  const response = await axios.get(url, {
    params,
    headers: { Authorization: authHeader }
  });

  return response.data;
}

// Route: POST /email/create
// Body: { domain: 'example.com', user: 'alice', password: 'S3cur3P@ss!', quota: 250 }
router.post('/email/create', async (req, res) => {
  const { domain, user, password, quota } = req.body;
  if (!domain || !user || !password) {
    return res.status(400).json({ status: '-1', message: 'domain, user, and password are required.' });
  }

  try {
    const result = await createEmailAccount(domain, user, password, quota);

    // cPanel returns JSON with "cpanelresult" object
    const info = result.cpanelresult;
    if (info.error) {
      return res.status(500).json({ status: '0', message: info.error });
    }

    res.json({ status: '1', message: 'Email account created.', data: info.data });
  } catch (err) {
    console.error('Email creation error:', err.response?.data || err.message);
    res.status(500).json({ status: '-1', message: 'Error creating email account.', error: err.message });
  }
});

module.exports = router;
