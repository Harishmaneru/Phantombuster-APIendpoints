const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const NamecheapDomain = require('../domainManagementAPI/nameCheapDomainApi.js');

const WHM_HOST = process.env.WHM_HOST;
const MASTER_USER = process.env.CPANEL_MASTER_USER;
const MASTER_TOKEN = process.env.CPANEL_TOKEN;
const agent = new https.Agent({ rejectUnauthorized: false });

// Helper: Directly call a cPanel UAPI endpoint using API Token
async function cpanelUapiRequest(module, func, params) {
  const url = `https://${WHM_HOST}:2083/execute/${module}/${func}`;
  const resp = await axios.get(url, {
    params,
    httpsAgent: agent,
    headers: { Authorization: `cpanel ${MASTER_USER}:${MASTER_TOKEN}` }
  });
  return resp.data;
}

/**
 * Create an email account
 * Expected req.body: { userId, domain, username, password, storage }
 */
router.post('/cpanel/create-email', async (req, res) => {
  const { userId, domain, username, password, storage = 1024 } = req.body;

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
    const result = await cpanelUapiRequest('Email', 'add_pop', {
      domain,
      email: username,
      password,
      quota: storage.toString()
    });
    if (result.status !== 1) throw new Error(result.errors?.[0] || 'Failed to create email');

    // Save to database
    await NamecheapDomain.findOneAndUpdate(
      { userId, domain: domain.toLowerCase() },
      { $push: { emailAccounts: { username, email: `${username}@${domain}`, quota: storage, createdAt: new Date(), suspended: false } } },
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
  const { userId, domain, username } = req.body;

  if (!userId || !domain || !username) {
    return res.status(400).json({ success: false, error: 'userId, domain, and username are required.' });
  }

  try {
    const result = await cpanelUapiRequest('Email', 'delete_pop', { domain, email: username });
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
  const { userId, domain } = req.query;

  if (!userId || !domain) {
    return res.status(400).json({ success: false, error: 'userId and domain are required.' });
  }

  try {
    const result = await cpanelUapiRequest('Email', 'list_pops', { domain });
    if (result.status !== 1) throw new Error(result.errors?.[0] || 'Failed to list emails');

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
