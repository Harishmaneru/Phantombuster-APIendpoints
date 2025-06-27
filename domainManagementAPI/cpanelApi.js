const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const NamecheapDomain = require('../domainManagementAPI/nameCheapDomainApi.js');

// WHM_HOST should be your domain name (e.g., engagegptapp.com), not IP address
const WHM_HOST = process.env.WHM_HOST || 'engagegptapp.com';
const MASTER_USER = process.env.CPANEL_MASTER_USER;
// Use WHM token for server-level operations, cPanel token for account-level operations
const WHM_TOKEN = process.env.WHM_TOKEN || 'Z1H8K78XO7ACXTRP1P992IUL0E6UPVMU';
const CPANEL_TOKEN = process.env.CPANEL_TOKEN || '76QS0RQNEK1N5OU4SQEF4A4W6U9M4AT7';
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
        'Authorization': `cpanel ${MASTER_USER}:${CPANEL_TOKEN}`,
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
        'Authorization': `whm ${MASTER_USER}:${WHM_TOKEN}`,
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

// Alternative method using standard cPanel API (port 2083)
async function cpanelStandardRequest(func, params) {
  const url = `https://${WHM_HOST}:2083/json-api/${func}`;
  
  try {
    const resp = await axios.get(url, {
      params,
      httpsAgent: agent,
      headers: { 
        'Authorization': `cpanel ${MASTER_USER}:${CPANEL_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    return resp.data;
  } catch (error) {
    console.error('Standard cPanel API Error:', {
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
    console.log('WHM Token length:', WHM_TOKEN ? WHM_TOKEN.length : 0);
    console.log('cPanel Token length:', CPANEL_TOKEN ? CPANEL_TOKEN.length : 0);
    
    // Test basic connectivity first
    const connectivityTests = [];
    
    // Test 1: Basic HTTP connectivity to port 2083
    try {
      const httpTest = await axios.get(`https://${WHM_HOST}:2083`, {
        httpsAgent: agent,
        timeout: 10000,
        validateStatus: () => true // Accept any status code
      });
      connectivityTests.push({
        test: 'HTTP 2083',
        success: true,
        status: httpTest.status,
        statusText: httpTest.statusText
      });
    } catch (error) {
      connectivityTests.push({
        test: 'HTTP 2083',
        success: false,
        error: error.message
      });
    }
    
    // Test 2: Basic HTTP connectivity to port 2087
    try {
      const whmTest = await axios.get(`https://${WHM_HOST}:2087`, {
        httpsAgent: agent,
        timeout: 10000,
        validateStatus: () => true
      });
      connectivityTests.push({
        test: 'HTTP 2087',
        success: true,
        status: whmTest.status,
        statusText: whmTest.statusText
      });
    } catch (error) {
      connectivityTests.push({
        test: 'HTTP 2087',
        success: false,
        error: error.message
      });
    }
    
    // Test 3: Try with IP address instead of domain
    try {
      const ipTest = await axios.get(`https://159.198.76.88:2083`, {
        httpsAgent: agent,
        timeout: 10000,
        validateStatus: () => true
      });
      connectivityTests.push({
        test: 'IP 2083',
        success: true,
        status: ipTest.status,
        statusText: ipTest.statusText
      });
    } catch (error) {
      connectivityTests.push({
        test: 'IP 2083',
        success: false,
        error: error.message
      });
    }
    
    // Test UAPI connection with shorter timeout
    let uapiResult = null;
    let uapiError = null;
    try {
      uapiResult = await cpanelUapiRequest('Email', 'list_pops', { domain: 'test.com' });
      console.log('UAPI test successful:', uapiResult);
    } catch (error) {
      uapiError = error;
      console.log('UAPI test failed:', error.message);
    }
    
    // Test WHM API connection with shorter timeout
    let whmResult = null;
    let whmError = null;
    try {
      whmResult = await cpanelWhmRequest('version', {});
      console.log('WHM API test successful:', whmResult);
    } catch (error) {
      whmError = error;
      console.log('WHM API test failed:', error.message);
    }
    
    // Test Standard cPanel API connection
    let standardResult = null;
    let standardError = null;
    try {
      standardResult = await cpanelStandardRequest('version', {});
      console.log('Standard cPanel API test successful:', standardResult);
    } catch (error) {
      standardError = error;
      console.log('Standard cPanel API test failed:', error.message);
    }
    
    res.json({
      success: true,
      environment: {
        host: WHM_HOST,
        user: MASTER_USER,
        whmTokenConfigured: !!WHM_TOKEN,
        whmTokenLength: WHM_TOKEN ? WHM_TOKEN.length : 0,
        cpanelTokenConfigured: !!CPANEL_TOKEN,
        cpanelTokenLength: CPANEL_TOKEN ? CPANEL_TOKEN.length : 0
      },
      connectivity: connectivityTests,
      uapi: {
        success: !uapiError,
        error: uapiError?.message,
        result: uapiResult
      },
      whm: {
        success: !whmError,
        error: whmError?.message,
        result: whmResult
      },
      standard: {
        success: !standardError,
        error: standardError?.message,
        result: standardResult
      },
      recommendations: [
        "If connectivity tests fail, check if ports 2083/2087 are open",
        "Try using IP address instead of domain if DNS is the issue",
        "Verify cPanel/WHM is running and accessible",
        "Check firewall settings on the server",
        "Some hosting providers block direct API access - contact your host"
      ]
    });
  } catch (err) {
    console.error('Error testing connection:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
