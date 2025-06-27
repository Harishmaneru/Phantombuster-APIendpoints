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

// Configure HTTPS agent with better timeout settings
const agent = new https.Agent({ 
  rejectUnauthorized: false,
  keepAlive: true,
  timeout: 30000, // 30 seconds for socket connection
  maxSockets: 5
});

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
  
  console.log(`UAPI Request: ${url}?${queryString.replace(/password=[^&]*/, 'password=******')}`);
  
  const startTime = Date.now();
  
  try {
    const resp = await axios.get(url, {
      params,
      httpsAgent: agent,
      headers: { 
        'Authorization': `cpanel ${MASTER_USER}:${CPANEL_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 45000 // 45 seconds total timeout
    });
    
    const duration = Date.now() - startTime;
    console.log(`UAPI Success (${duration}ms):`, JSON.stringify({
      status: resp.status,
      statusText: resp.statusText,
      data: resp.data
    }, null, 2));
    
    return resp.data;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorDetails = {
      duration: `${duration}ms`,
      code: error.code,
      message: error.message,
      config: {
        url: error.config?.url,
        method: error.config?.method,
        timeout: error.config?.timeout
      }
    };
    
    if (error.response) {
      errorDetails.response = {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      };
    }
    
    console.error('UAPI Error:', JSON.stringify(errorDetails, null, 2));
    throw error;
  }
}

// Helper: Call WHM API v1 endpoint using WHM token
async function cpanelWhmRequest(func, params) {
  const url = `https://${WHM_HOST}:2087/json-api/${func}`;
  const queryString = new URLSearchParams(params).toString();
  
  console.log(`WHM API Request: ${url}?${queryString.replace(/password=[^&]*/, 'password=******')}`);
  
  const startTime = Date.now();
  
  try {
    const resp = await axios.get(url, {
      params,
      httpsAgent: agent,
      headers: { 
        'Authorization': `whm ${MASTER_USER}:${WHM_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 45000
    });
    
    const duration = Date.now() - startTime;
    console.log(`WHM API Success (${duration}ms):`, JSON.stringify({
      status: resp.status,
      statusText: resp.statusText,
      data: resp.data
    }, null, 2));
    
    return resp.data;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorDetails = {
      duration: `${duration}ms`,
      code: error.code,
      message: error.message,
      config: {
        url: error.config?.url,
        method: error.config?.method,
        timeout: error.config?.timeout
      }
    };
    
    if (error.response) {
      errorDetails.response = {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      };
    }
    
    console.error('WHM API Error:', JSON.stringify(errorDetails, null, 2));
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
    return res.status(400).json({ 
      success: false, 
      error: 'userId, domain, username, and password are required.' 
    });
  }
  
  if (typeof storage !== 'number' || storage < 10 || storage > 10240) {
    return res.status(400).json({ 
      success: false, 
      error: 'Storage must be a number between 10 and 10240 (MB).' 
    });
  }
  
  if (password.length < 8) {
    return res.status(400).json({ 
      success: false, 
      error: 'Password must be at least 8 characters long.' 
    });
  }

  try {
    console.log(`Starting email creation for ${username}@${domain}`);
    
    const params = {
      domain: domain.toLowerCase(),
      email: username.toLowerCase(),
      password,
      quota: storage.toString()
    };

    let result;
    let usedFallback = false;
    
    try {
      // Try UAPI first (preferred for account-level operations)
      console.log('Attempting UAPI email creation...');
      result = await cpanelUapiRequest('Email', 'add_pop', params);
    } catch (uapiError) {
      if (uapiError.code === 'ECONNABORTED' || uapiError.code === 'ETIMEDOUT') {
        console.log('UAPI timed out, falling back to WHM API');
        usedFallback = true;
        
        try {
          // Fallback to WHM API (for server-level access)
          console.log('Attempting WHM API email creation...');
          result = await cpanelWhmRequest('add_pop', params);
        } catch (whmError) {
          console.error('Both UAPI and WHM API failed:', {
            uapiError: uapiError.message,
            whmError: whmError.message
          });
          
          if (whmError.code === 'ECONNABORTED' || whmError.code === 'ETIMEDOUT') {
            return res.status(504).json({ 
              success: false, 
              error: 'Both UAPI and WHM API requests timed out. Check server connectivity.',
              details: {
                host: WHM_HOST,
                portsTested: [2083, 2087],
                recommendation: 'Verify network connectivity to the cPanel server'
              }
            });
          }
          throw whmError;
        }
      } else {
        throw uapiError;
      }
    }

    // Handle different response formats
    const isSuccess = result?.status === 1 || result?.result === 1 || result?.success === true || result?.data?.status === 1;
    if (!isSuccess) {
      const errorMsg = result?.errors?.[0] || result?.error || result?.data?.error || 'Failed to create email account';
      console.error('Email creation failed:', errorMsg);
      return res.status(500).json({ 
        success: false, 
        error: errorMsg,
        apiUsed: usedFallback ? 'WHM API' : 'UAPI',
        response: result
      });
    }

    // Save to database
    try {
      await NamecheapDomain.findOneAndUpdate(
        { userId, domain: domain.toLowerCase() },
        { 
          $push: { 
            emailAccounts: { 
              username: username.toLowerCase(), 
              email: `${username.toLowerCase()}@${domain.toLowerCase()}`, 
              quota: storage, 
              createdAt: new Date(), 
              suspended: false 
            } 
          } 
        },
        { new: true, upsert: true }
      );
      console.log('Email account saved to database');
    } catch (dbError) {
      console.error('Database save error:', dbError.message);
      // Continue even if DB save fails since the email was created
    }

    res.json({ 
      success: true, 
      email: `${username.toLowerCase()}@${domain.toLowerCase()}`, 
      quota: storage,
      apiUsed: usedFallback ? 'WHM API' : 'UAPI'
    });
  } catch (err) {
    console.error('Email creation failed:', {
      timestamp: new Date().toISOString(),
      error: err.message,
      stack: err.stack,
      request: {
        userId,
        domain,
        username,
        storage
      },
      environment: {
        WHM_HOST,
        MASTER_USER,
        WHM_TOKEN_LENGTH: WHM_TOKEN?.length,
        CPANEL_TOKEN_LENGTH: CPANEL_TOKEN?.length
      }
    });
    
    res.status(500).json({ 
      success: false, 
      error: err.message,
      details: {
        code: err.code,
        type: err.name,
        recommendation: 'Check server connectivity and API credentials'
      }
    });
  }
});

// Enhanced test endpoint
router.get('/cpanel/test-connection', async (req, res) => {
  const testResults = {
    environment: {
      host: WHM_HOST,
      user: MASTER_USER,
      whmTokenConfigured: !!WHM_TOKEN,
      whmTokenLength: WHM_TOKEN ? WHM_TOKEN.length : 0,
      cpanelTokenConfigured: !!CPANEL_TOKEN,
      cpanelTokenLength: CPANEL_TOKEN ? CPANEL_TOKEN.length : 0,
      nodeVersion: process.version,
      platform: process.platform
    },
    connectivity: [],
    dnsResolution: null,
    recommendations: []
  };

  try {
    // Test DNS resolution
    try {
      const dns = require('dns');
      const dnsStart = Date.now();
      await new Promise((resolve, reject) => {
        dns.lookup(WHM_HOST, (err, address, family) => {
          if (err) reject(err);
          resolve({ address, family });
        });
      });
      testResults.dnsResolution = {
        success: true,
        duration: `${Date.now() - dnsStart}ms`
      };
    } catch (dnsError) {
      testResults.dnsResolution = {
        success: false,
        error: dnsError.message,
        code: dnsError.code
      };
      testResults.recommendations.push('DNS resolution failed - try using IP address instead of hostname');
    }

    // Port connectivity tests
    const portsToTest = [
      { port: 2083, service: 'cPanel' },
      { port: 2087, service: 'WHM' },
      { port: 2086, service: 'cPanel SSL' },
      { port: 2082, service: 'cPanel non-SSL' }
    ];

    for (const { port, service } of portsToTest) {
      const testStart = Date.now();
      try {
        const net = require('net');
        const socket = new net.Socket();
        
        await new Promise((resolve, reject) => {
          socket.setTimeout(10000);
          
          socket.on('connect', () => {
            socket.destroy();
            resolve();
          });
          
          socket.on('timeout', () => {
            socket.destroy();
            reject(new Error('Connection timeout'));
          });
          
          socket.on('error', (err) => {
            socket.destroy();
            reject(err);
          });
          
          socket.connect(port, WHM_HOST);
        });
        
        testResults.connectivity.push({
          service,
          port,
          success: true,
          duration: `${Date.now() - testStart}ms`
        });
      } catch (portError) {
        testResults.connectivity.push({
          service,
          port,
          success: false,
          error: portError.message,
          code: portError.code,
          duration: `${Date.now() - testStart}ms`
        });
      }
    }

    // API functional tests
    testResults.apiTests = {};
    
    // Test UAPI connection
    try {
      const uapiStart = Date.now();
      const uapiResult = await cpanelUapiRequest('Email', 'list_pops', { domain: 'example.com' });
      testResults.apiTests.uapi = {
        success: true,
        duration: `${Date.now() - uapiStart}ms`,
        status: 'Functional'
      };
    } catch (uapiError) {
      testResults.apiTests.uapi = {
        success: false,
        error: uapiError.message,
        code: uapiError.code,
        status: 'Failed'
      };
    }
    
    // Test WHM API connection
    try {
      const whmStart = Date.now();
      const whmResult = await cpanelWhmRequest('version', {});
      testResults.apiTests.whm = {
        success: true,
        duration: `${Date.now() - whmStart}ms`,
        version: whmResult?.data?.version,
        status: 'Functional'
      };
    } catch (whmError) {
      testResults.apiTests.whm = {
        success: false,
        error: whmError.message,
        code: whmError.code,
        status: 'Failed'
      };
    }

    // Generate recommendations
    if (!testResults.dnsResolution.success) {
      testResults.recommendations.push('Use IP address instead of hostname for WHM_HOST');
    }
    
    if (testResults.connectivity.some(test => !test.success)) {
      testResults.recommendations.push('Check firewall settings on both client and server');
      testResults.recommendations.push('Verify cPanel/WHM services are running on the server');
    }
    
    if (!testResults.apiTests.uapi.success || !testResults.apiTests.whm.success) {
      testResults.recommendations.push('Verify API tokens have correct permissions');
      testResults.recommendations.push('Check WHM > Manage API Tokens for token validity');
    }
    
    testResults.recommendations.push(
      'Ensure WHM API token restrictions allow your server IP',
      'Check cPHulk Brute Force Protection for IP blocks',
      'Contact hosting provider if basic connectivity tests fail'
    );

    res.json({
      success: true,
      ...testResults
    });
  } catch (err) {
    console.error('Connection test failed:', {
      message: err.message,
      stack: err.stack
    });
    
    res.status(500).json({
      success: false,
      error: err.message,
      ...testResults
    });
  }
});

module.exports = router;