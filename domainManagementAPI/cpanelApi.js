const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const NamecheapDomain = require('../domainManagementAPI/nameCheapDomainApi.js');

const WHM_HOST = process.env.WHM_HOST;
const MASTER_USER = process.env.CPANEL_MASTER_USER;
const MASTER_TOKEN = process.env.CPANEL_TOKEN;
const agent = new https.Agent({ rejectUnauthorized: false });

// Helper: Call cPanel UAPI endpoint using API Token
async function cpanelUapiRequest(module, func, params) {
  // Use HTTPS and proper endpoint structure
  const url = `https://${WHM_HOST}:2083/execute/${module}/${func}`;
  
  try {
    const resp = await axios.get(url, {
      params,
      httpsAgent: agent,
      headers: { 
        'Authorization': `cpanel ${MASTER_USER}:${MASTER_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 second timeout
    });
    return resp.data;
  } catch (error) {
    console.error('cPanel API Error:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      url: url,
      params: params
    });
    throw error;
  }
}

// Alternative method using WHM API 1 (if UAPI doesn't work)
async function cpanelWhmRequest(func, params) {
  const url = `https://${WHM_HOST}:2087/json-api/${func}`;
  
  try {
    const resp = await axios.get(url, {
      params,
      httpsAgent: agent,
      headers: { 
        'Authorization': `whm ${MASTER_USER}:${MASTER_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    return resp.data;
  } catch (error) {
    console.error('WHM API Error:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      url: url,
      params: params
    });
    throw error;
  }
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
    // Try UAPI first
    let result;
    try {
      result = await cpanelUapiRequest('Email', 'add_pop', {
        domain,
        email: username,
        password,
        quota: storage.toString()
      });
    } catch (uapiError) {
      console.log('UAPI failed, trying WHM API:', uapiError.message);
      // Fallback to WHM API
      result = await cpanelWhmRequest('add_pop', {
        domain,
        email: username,
        password,
        quota: storage.toString()
      });
    }

    // Check for success (different response formats)
    const isSuccess = result.status === 1 || result.result === 1 || result.success === 1;
    if (!isSuccess) {
      const errorMsg = result.errors?.[0] || result.error || 'Failed to create email';
      throw new Error(errorMsg);
    }

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
    // Try UAPI first
    let result;
    try {
      result = await cpanelUapiRequest('Email', 'delete_pop', { domain, email: username });
    } catch (uapiError) {
      console.log('UAPI failed, trying WHM API:', uapiError.message);
      // Fallback to WHM API
      result = await cpanelWhmRequest('delete_pop', { domain, email: username });
    }

    const isSuccess = result.status === 1 || result.result === 1 || result.success === 1;
    if (!isSuccess) {
      const errorMsg = result.errors?.[0] || result.error || 'Failed to delete email';
      throw new Error(errorMsg);
    }

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
    // Try UAPI first
    let result;
    try {
      result = await cpanelUapiRequest('Email', 'list_pops', { domain });
    } catch (uapiError) {
      console.log('UAPI failed, trying WHM API:', uapiError.message);
      // Fallback to WHM API
      result = await cpanelWhmRequest('list_pops', { domain });
    }

    const isSuccess = result.status === 1 || result.result === 1 || result.success === 1;
    if (!isSuccess) {
      const errorMsg = result.errors?.[0] || result.error || 'Failed to list emails';
      throw new Error(errorMsg);
    }

    // Handle different response formats
    const pops = result.data?.pops || result.pops || [];
    const emails = pops.map(acc => ({
      username: acc.user || acc.username,
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

// Test endpoint to verify API credentials and connectivity
router.get('/cpanel/test-connection', async (req, res) => {
  try {
    console.log('Testing cPanel API connection...');
    console.log('Host:', WHM_HOST);
    console.log('User:', MASTER_USER);
    console.log('Token length:', MASTER_TOKEN ? MASTER_TOKEN.length : 0);
    
    // Test UAPI connection
    let uapiResult = null;
    let uapiError = null;
    try {
      uapiResult = await cpanelUapiRequest('Email', 'list_pops', { domain: 'test.com' });
      console.log('UAPI test successful:', uapiResult);
    } catch (error) {
      uapiError = error;
      console.log('UAPI test failed:', error.message);
    }
    
    // Test WHM API connection
    let whmResult = null;
    let whmError = null;
    try {
      whmResult = await cpanelWhmRequest('version', {});
      console.log('WHM API test successful:', whmResult);
    } catch (error) {
      whmError = error;
      console.log('WHM API test failed:', error.message);
    }
    
    res.json({
      success: true,
      environment: {
        host: WHM_HOST,
        user: MASTER_USER,
        tokenConfigured: !!MASTER_TOKEN,
        tokenLength: MASTER_TOKEN ? MASTER_TOKEN.length : 0
      },
      uapi: {
        success: !uapiError,
        error: uapiError?.message,
        result: uapiResult
      },
      whm: {
        success: !whmError,
        error: whmError?.message,
        result: whmResult
      }
    });
  } catch (err) {
    console.error('Error testing connection:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
