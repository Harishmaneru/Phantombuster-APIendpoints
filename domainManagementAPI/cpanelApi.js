require('dotenv').config();
const axios = require('axios');
const express = require('express');
const https = require('https');
const NamecheapDomain = require('../domainManagementAPI/nameCheapDomainApi.js');

const router = express.Router();
const WHM_HOST = process.env.WHM_HOST;
const MASTER_USER = process.env.CPANEL_MASTER_USER;
const MASTER_TOKEN = process.env.CPANEL_TOKEN;
const AUTH_HEADER = `cpanel ${MASTER_USER}:${MASTER_TOKEN}`;
const agent = new https.Agent({ rejectUnauthorized: false });

// Helper: Create a cPanel user session URL via WHM API
async function createUserSession() {
  const resp = await axios.post(
    `https://${WHM_HOST}:2087/json-api/create_user_session`,
    null,
    {
      params: { user: MASTER_USER, service: 'cpaneld' },
      auth: { username: 'root', password: process.env.WHM_ROOT_PASS },
      httpsAgent: agent
    }
  );
  return resp.data.data.cpanel_result.url;
}

// Helper: Call a UAPI endpoint given a session URL
async function cpanelUapiRequest(sessionUrl, module, func, params) {
  const url = sessionUrl.replace(/\/3\//, '/execute/') + `${module}/${func}`;
  const response = await axios.get(url, { params, httpsAgent: agent });
  return response.data;
}

/**
 * Create an email account
 * Expected req.body: { domain, username, password, storage }
 * storage: mailbox quota in MB, e.g. 500
 */
router.post('/cpanel/create-email', async (req, res) => {
  const { domain, username, password, storage = 1024 } = req.body;
  const userId = req.userId; // assume auth middleware sets this

  // Validate inputs
  if (!userId || !domain || !username || !password) {
    return res.status(400).json({ success: false, error: 'userId, domain, username, and password are required.' });
  }
  if (typeof storage !== 'number' || storage < 10 || storage > 10240) {
    return res.status(400).json({ success: false, error: 'Storage must be a number between 10 and 10240 (MB).' });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters long.' });
  }

  try {
    const sessionUrl = await createUserSession();
    const result = await cpanelUapiRequest(sessionUrl, 'Email', 'add_pop', {
      domain,
      email: username,
      password,
      quota: storage.toString()
    });
    if (result.status !== 1) throw new Error(result.errors?.[0] || 'Failed to create email');

    // Save to database
    await NamecheapDomain.findOneAndUpdate(
      { userId, domain: domain.toLowerCase() },
      {
        $push: {
          emailAccounts: {
            username,
            email: `${username}@${domain}`,
            quota: storage,
            createdAt: new Date(),
            suspended: false
          }
        }
      },
      { new: true }
    );

    res.json({ success: true, email: `${username}@${domain}`, quota: storage });
  } catch (err) {
    console.error('Error create-email:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete an email account
router.delete('/cpanel/delete-email', async (req, res) => {
  const { domain, username } = req.body;
  const userId = req.userId;

  if (!userId || !domain || !username) {
    return res.status(400).json({ success: false, error: 'userId, domain, and username are required.' });
  }

  try {
    const sessionUrl = await createUserSession();
    const result = await cpanelUapiRequest(sessionUrl, 'Email', 'delete_pop', { domain, email: username });
    if (result.status !== 1) throw new Error(result.errors?.[0] || 'Failed to delete email');

    // Remove from database
    await NamecheapDomain.findOneAndUpdate(
      { userId, domain: domain.toLowerCase() },
      { $pull: { emailAccounts: { username } } },
      { new: true }
    );

    res.json({ success: true, message: 'Email account deleted.' });
  } catch (err) {
    console.error('Error delete-email:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// List email accounts for a domain
router.get('/cpanel/list-emails', async (req, res) => {
  const { domain } = req.query;
  const userId = req.userId;

  if (!userId || !domain) {
    return res.status(400).json({ success: false, error: 'userId and domain are required.' });
  }

  try {
    const sessionUrl = await createUserSession();
    const result = await cpanelUapiRequest(sessionUrl, 'Email', 'list_pops', { domain });
    if (result.status !== 1) throw new Error(result.errors?.[0] || 'Failed to list emails');

    // Map live cPanel data
    const emails = result.data.pops.map(acc => ({
      username: acc.user,
      email: acc.email,
      quota: parseInt(acc.quota) || 0,
      used: parseInt(acc.diskused_bytes) || 0,
      suspended: acc.suspended === '1',
      created: acc.created
    }));

    res.json({ success: true, emails });
  } catch (err) {
    console.error('Error list-emails:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
