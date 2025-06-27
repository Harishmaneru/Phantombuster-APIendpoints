const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const dns = require('dns');
const NamecheapDomain = require('./nameCheapDomainApi.js');

// Configuration - USE IP ADDRESS HERE
const WHM_HOST = process.env.WHM_HOST ;  
const MASTER_USER = process.env.CPANEL_MASTER_USER;
const WHM_TOKEN = process.env.WHM_TOKEN;
const CPANEL_TOKEN = process.env.CPANEL_TOKEN;

// Create custom HTTPS agent
const agent = new https.Agent({
  rejectUnauthorized: false,
  family: 4, // Force IPv4
  timeout: 10000
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

// Helper: Call cPanel UAPI endpoint using cPanel token (simplified)
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
      timeout: 15000
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
    console.error('UAPI Error:', {
      duration: `${duration}ms`,
      code: error.code,
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    throw error;
  }
}

// Helper: Call WHM API v1 endpoint using WHM token (fallback)
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
      timeout: 15000
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
    console.error('WHM API Error:', {
      duration: `${duration}ms`,
      code: error.code,
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
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
      quota: storage.toString(),
      skip_update_db: 1
    };

    let result;
    let usedFallback = false;
    
    try {
      // Try UAPI first (simplified approach)
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
      const dnsStart = Date.now();
      const addresses = await new Promise((resolve, reject) => {
        dns.resolve4(WHM_HOST, (err, addresses) => {
          if (err) reject(err);
          resolve(addresses);
        });
      });
      testResults.dnsResolution = {
        success: true,
        addresses,
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
    
    // Test UAPI connection (simplified)
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
    
    if (!testResults.apiTests.uapi.success) {
      testResults.recommendations.push('Verify cPanel API token has email management permissions');
      testResults.recommendations.push('Check token restrictions in WHM > Manage API Tokens');
    }
    
    if (!testResults.apiTests.whm.success) {
      testResults.recommendations.push('Verify WHM API token has correct permissions');
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

// New diagnostic endpoint for troubleshooting
router.get('/cpanel/diagnose', async (req, res) => {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    environment: {
      host: WHM_HOST,
      user: MASTER_USER,
      whmTokenConfigured: !!WHM_TOKEN,
      whmTokenLength: WHM_TOKEN ? WHM_TOKEN.length : 0,
      cpanelTokenConfigured: !!CPANEL_TOKEN,
      cpanelTokenLength: CPANEL_TOKEN ? CPANEL_TOKEN.length : 0
    },
    connectivity: {},
    authentication: {},
    recommendations: []
  };

  try {
    // Test basic connectivity
    console.log('Testing basic connectivity...');
    
    // Test DNS resolution
    try {
      const dnsStart = Date.now();
      const addresses = await new Promise((resolve, reject) => {
        dns.resolve4(WHM_HOST, (err, addresses) => {
          if (err) reject(err);
          resolve(addresses);
        });
      });
      diagnostics.connectivity.dns = {
        success: true,
        addresses,
        duration: `${Date.now() - dnsStart}ms`
      };
    } catch (dnsError) {
      diagnostics.connectivity.dns = {
        success: false,
        error: dnsError.message,
        code: dnsError.code
      };
      diagnostics.recommendations.push('DNS resolution failed - use IP address instead of hostname');
    }

    // Test port connectivity
    const portsToTest = [
      { port: 2083, service: 'cPanel UAPI' },
      { port: 2087, service: 'WHM API' }
    ];

    for (const { port, service } of portsToTest) {
      try {
        const net = require('net');
        const socket = new net.Socket();
        
        await new Promise((resolve, reject) => {
          socket.setTimeout(5000);
          
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
        
        diagnostics.connectivity[`port_${port}`] = {
          success: true,
          service,
          duration: 'Connected'
        };
      } catch (portError) {
        diagnostics.connectivity[`port_${port}`] = {
          success: false,
          service,
          error: portError.message,
          code: portError.code
        };
      }
    }

    // Test authentication methods
    console.log('Testing authentication methods...');
    
    // Test 1: WHM API version (basic connectivity)
    try {
      const whmStart = Date.now();
      const whmResult = await cpanelWhmRequest('version', {});
      diagnostics.authentication.whm = {
        success: true,
        duration: `${Date.now() - whmStart}ms`,
        version: whmResult?.data?.version
      };
    } catch (whmError) {
      diagnostics.authentication.whm = {
        success: false,
        error: whmError.message,
        code: whmError.code
      };
    }

    // Test 2: UAPI with token only
    try {
      const uapiStart = Date.now();
      const uapiResult = await cpanelUapiRequest('Email', 'list_pops', { domain: 'example.com' });
      diagnostics.authentication.uapiTokenOnly = {
        success: true,
        duration: `${Date.now() - uapiStart}ms`,
        status: 'Working'
      };
    } catch (uapiError) {
      diagnostics.authentication.uapiTokenOnly = {
        success: false,
        error: uapiError.message,
        code: uapiError.code,
        status: uapiError.response?.status
      };
    }

    // Generate recommendations
    if (!diagnostics.connectivity.dns.success) {
      diagnostics.recommendations.push('Use IP address instead of hostname for WHM_HOST');
    }
    
    if (Object.values(diagnostics.connectivity).some(test => !test.success)) {
      diagnostics.recommendations.push('Check firewall settings on both client and server');
      diagnostics.recommendations.push('Verify cPanel/WHM services are running');
    }
    
    if (!diagnostics.authentication.whm.success) {
      diagnostics.recommendations.push('Verify WHM API token has correct permissions');
      diagnostics.recommendations.push('Check WHM > Manage API Tokens for token validity');
    }
    
    if (!diagnostics.authentication.uapiTokenOnly.success) {
      diagnostics.recommendations.push('Verify cPanel API token has email management permissions');
      diagnostics.recommendations.push('Check token restrictions in WHM > Manage API Tokens');
    }

    // Determine best authentication method
    if (diagnostics.authentication.uapiTokenOnly.success) {
      diagnostics.recommendations.push('✅ UAPI with token-only authentication is working - use this method');
    } else if (diagnostics.authentication.whm.success) {
      diagnostics.recommendations.push('✅ WHM API is working - use WHM API for email operations');
    } else {
      diagnostics.recommendations.push('❌ All authentication methods failed - check network connectivity and credentials');
    }

    res.json({
      success: true,
      ...diagnostics
    });
  } catch (err) {
    console.error('Diagnostic test failed:', err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      ...diagnostics
    });
  }
});

// Simple test endpoint to verify API is working
router.get('/cpanel/test', (req, res) => {
  res.json({
    success: true,
    message: 'cPanel API is working',
    timestamp: new Date().toISOString(),
    environment: {
      host: WHM_HOST,
      user: MASTER_USER,
      whmTokenConfigured: !!WHM_TOKEN,
      whmTokenLength: WHM_TOKEN ? WHM_TOKEN.length : 0,
      cpanelTokenConfigured: !!CPANEL_TOKEN,
      cpanelTokenLength: CPANEL_TOKEN ? CPANEL_TOKEN.length : 0
    }
  });
});

module.exports = router;