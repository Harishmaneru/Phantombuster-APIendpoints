const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const NamecheapDomain = require('../domainManagementAPI/nameCheapDomainApi.js');

// Environment variables
const WHM_HOST = process.env.WHM_HOST || '159.198.76.88'; // Use IP to avoid DNS issues
const MASTER_USER = process.env.CPANEL_MASTER_USER;
const WHM_TOKEN = process.env.WHM_TOKEN;
const CPANEL_TOKEN = process.env.CPANEL_TOKEN;
const agent = new https.Agent({ rejectUnauthorized: false });

// Validate environment variables
if (!WHM_HOST || !MASTER_USER || !WHM_TOKEN || !CPANEL_TOKEN) {
  console.error('Missing environment variables:', {
    WHM_HOST,
    MASTER_USER,
    WHM_TOKEN: !!WHM_TOKEN,
    CPANEL_TOKEN: !!CPANEL_TOKEN
  });
  throw new Error('Missing required environment variables');
}

// Helper: Call cPanel UAPI endpoint using cPanel token
async function cpanelUapiRequest(module, func, params) {
  const url = `https://${WHM_HOST}:2083/execute/${module}/${func}`;
  const queryString = new URLSearchParams(params).toString();
  console.log(`UAPI Request: ${url}?${queryString}`);
  
  try {
    const resp = await axios.get(url, {
      params,
      httpsAgent: agent,
      headers: { 
        'Authorization': `cpanel ${MASTER_USER}:${CPANEL_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000 // Increased to 60 seconds
    });
    console.log('UAPI Response:', JSON.stringify(resp.data, null, 2));
    return resp.data;
  } catch (error) {
    console.error('cPanel UAPI Error:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      url: `${url}?${queryString}`,
      params,
      message: error.message
    });
    throw error;
  }
}

// Helper: Call WHM API v1 endpoint using WHM token
async function cpanelWhmRequest(func, params) {
  const url = `https://${WHM_HOST}:2087/json-api/${func}`;
  const queryString = new URLSearchParams(params).toString();
  console.log(`WHM API Request: ${url}?${queryString}`);
  
  try {
    const resp = await axios.get(url, {
      params,
      httpsAgent: agent,
      headers: { 
        'Authorization': `whm ${MASTER_USER}:${WHM_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });
    console.log('WHM API Response:', JSON.stringify(resp.data, null, 2));
    return resp.data;
  } catch (error) {
    console.error('WHM API Error:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      url: `${url}?${queryString}`,
      params,
      message: error.message
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
    let result;
    const params = {
      domain: domain.toLowerCase(),
      email: username,
      password,
      quota: storage.toString()
    };

    try {
      // Try UAPI first (preferred for account-level operations)
      result = await cpanelUapiRequest('Email', 'add_pop', params);
    } catch (uapiError) {
      if (uapiError.code === 'ECONNABORTED') {
        return res.status(504).json({ success: false, error: 'UAPI request timed out. Check server connectivity or firewall settings.' });
      }
      console.log('UAPI failed, trying WHM API:', uapiError.message);
      // Fallback to WHM API (for server-level access)
      try {
        result = await cpanelWhmRequest('add_pop', params);
      } catch (whmError) {
        if (whmError.code === 'ECONNABORTED') {
          return res.status(504).json({ success: false, error: 'WHM API request timed out. Check server connectivity or firewall settings.' });
        }
        throw whmError;
      }
    }

    // Handle different response formats
    const isSuccess = result?.status === 1 || result?.result === 1 || result?.success === true || result?.data?.status === 1;
    if (!isSuccess) {
      const errorMsg = result?.errors?.[0] || result?.error || result?.data?.error || 'Failed to create email account';
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
    console.error('Error create-email:', {
      message: err.message,
      stack: err.stack,
      response: err.response?.data
    });
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
    
    const connectivityTests = [];
    
    // Test 1: Basic HTTP connectivity to port 2083
    try {
      const httpTest = await axios.get(`https://${WHM_HOST}:2083`, {
        httpsAgent: agent,
        timeout: 10000,
        validateStatus: () => true
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
    
    // Test 3: Try with IP address
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
      recommendations: [
        'Ensure WHM_HOST is the server hostname or IP (not a hosted domain)',
        'Whitelist EC2 IP in WHM API token restrictions',
        'Check if ports 2083/2087 are open on the server',
        'Verify cPanel/WHM is running and accessible',
        'Check cPHulk for IP blocks',
        'Contact hosting provider if issues persist'
      ]
    });
  } catch (err) {
    console.error('Error testing connection:', {
      message: err.message,
      stack: err.stack
    });
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;