const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const dns = require('dns');
const NamecheapDomain = require('./nameCheapDomainApi.js');

// Configuration - USE IP ADDRESS HERE
const WHM_HOST = process.env.WHM_HOST;  
const MASTER_USER = process.env.CPANEL_MASTER_USER;
const WHM_TOKEN = process.env.WHM_TOKEN;
const CPANEL_TOKEN = process.env.CPANEL_TOKEN;

// Create custom HTTPS agent
const agent = new https.Agent({
  rejectUnauthorized: false,
  family: 4, // Force IPv4
  timeout: 30000 // Increased timeout
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

// Helper: Get cPanel session token
async function getCpanelSession() {
  const loginUrl = `https://${WHM_HOST}:2083/login/?login_only=1`;
  
  try {
    const response = await axios.post(loginUrl, 
      new URLSearchParams({
        user: MASTER_USER,
        pass: CPANEL_TOKEN // Using token as password
      }), 
      {
        httpsAgent: agent,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 30000,
        maxRedirects: 0,
        validateStatus: function (status) {
          return status >= 200 && status < 400; // Accept redirects
        }
      }
    );

    // Extract session from Set-Cookie header or redirect location
    const cookies = response.headers['set-cookie'];
    if (cookies) {
      for (const cookie of cookies) {
        const sessionMatch = cookie.match(/cpsess\d+/);
        if (sessionMatch) {
          return sessionMatch[0];
        }
      }
    }

    // Try to extract from Location header if redirected
    const location = response.headers.location;
    if (location) {
      const sessionMatch = location.match(/cpsess(\d+)/);
      if (sessionMatch) {
        return `cpsess${sessionMatch[1]}`;
      }
    }

    throw new Error('Could not extract cPanel session token');
  } catch (error) {
    console.error('Failed to get cPanel session:', error.message);
    throw error;
  }
}

// Helper: Call cPanel UAPI endpoint with proper authentication
async function cpanelUapiRequest(module, func, params) {
  try {
    // Method 1: Try with API Token Authentication (Recommended)
    const url = `https://${WHM_HOST}:2083/execute/${module}/${func}`;
    
    console.log(`UAPI Request: ${url} with params:`, { ...params, password: '******' });
    
    const startTime = Date.now();
    
    const response = await axios.get(url, {
      params,
      httpsAgent: agent,
      headers: { 
        'Authorization': `cpanel ${MASTER_USER}:${CPANEL_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    const duration = Date.now() - startTime;
    console.log(`UAPI Success (${duration}ms):`, JSON.stringify(response.data, null, 2));
    
    return response.data;
  } catch (tokenError) {
    console.log('API Token method failed, trying session-based authentication...');
    
    try {
      // Method 2: Fallback to session-based authentication
      const session = await getCpanelSession();
      const sessionUrl = `https://${WHM_HOST}:2083/${session}/execute/${module}/${func}`;
      
      console.log(`UAPI Session Request: ${sessionUrl}`);
      
      const startTime = Date.now();
      
      const response = await axios.get(sessionUrl, {
        params,
        httpsAgent: agent,
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
      
      const duration = Date.now() - startTime;
      console.log(`UAPI Session Success (${duration}ms):`, JSON.stringify(response.data, null, 2));
      
      return response.data;
    } catch (sessionError) {
      console.error('Both token and session authentication failed:', {
        tokenError: tokenError.message,
        sessionError: sessionError.message
      });
      throw sessionError;
    }
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
      timeout: 30000
    });
    
    const duration = Date.now() - startTime;
    console.log(`WHM API Success (${duration}ms):`, JSON.stringify(resp.data, null, 2));
    
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
    
    // Parameters for cPanel UAPI Email/add_pop
    const params = {
      domain: domain.toLowerCase(),
      email: username.toLowerCase(), // This should be just the username part
      password,
      quota: storage, // Don't convert to string, cPanel accepts number
      skip_update_db: 0 // Set to 0 to update database
    };

    let result;
    let usedMethod = 'UAPI';
    
    try {
      // Try UAPI first with proper authentication
      console.log('Attempting UAPI email creation...');
      result = await cpanelUapiRequest('Email', 'add_pop', params);
      
      // Check if UAPI response indicates success
      if (result && (result.status === 1 || (result.result && result.result.status === 1))) {
        console.log('UAPI email creation successful');
      } else {
        throw new Error(result?.errors?.[0] || result?.result?.errors?.[0] || 'UAPI returned unsuccessful status');
      }
    } catch (uapiError) {
      console.log('UAPI failed, trying WHM API fallback:', uapiError.message);
      usedMethod = 'WHM';
      
      try {
        // Fallback to WHM API with different parameters structure
        const whmParams = {
          ...params,
          user: MASTER_USER, // WHM API might need the user parameter
          'api.version': 1
        };
        
        console.log('Attempting WHM API email creation...');
        result = await cpanelWhmRequest('add_pop', whmParams);
        
        if (!(result?.metadata?.result === 1 || result?.data?.status === 1)) {
          throw new Error(result?.metadata?.reason || result?.data?.error || 'WHM API returned unsuccessful status');
        }
      } catch (whmError) {
        console.error('Both UAPI and WHM API failed:', {
          uapiError: uapiError.message,
          whmError: whmError.message
        });
        
        // Return more specific error information
        return res.status(500).json({ 
          success: false, 
          error: `Email creation failed. UAPI: ${uapiError.message}. WHM: ${whmError.message}`,
          details: {
            uapiError: uapiError.message,
            whmError: whmError.message,
            suggestions: [
              'Check if the domain exists in cPanel',
              'Verify API token permissions include email management',
              'Ensure the email account doesn\'t already exist',
              'Check cPanel error logs for more details'
            ]
          }
        });
      }
    }

    // Save to database
    const emailAddress = `${username.toLowerCase()}@${domain.toLowerCase()}`;
    try {
      await NamecheapDomain.findOneAndUpdate(
        { userId, domain: domain.toLowerCase() },
        { 
          $push: { 
            emailAccounts: { 
              username: username.toLowerCase(), 
              email: emailAddress, 
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
      email: emailAddress, 
      quota: storage,
      method: usedMethod,
      message: `Email account ${emailAddress} created successfully`
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
      }
    });
    
    res.status(500).json({ 
      success: false, 
      error: err.message,
      details: {
        code: err.code,
        type: err.name,
        recommendation: 'Check server connectivity, domain existence, and API credentials'
      }
    });
  }
});

// Test endpoint with improved diagnostics
router.get('/cpanel/test-connection', async (req, res) => {
  const testResults = {
    timestamp: new Date().toISOString(),
    environment: {
      host: WHM_HOST,
      user: MASTER_USER,
      whmTokenConfigured: !!WHM_TOKEN,
      cpanelTokenConfigured: !!CPANEL_TOKEN,
      nodeVersion: process.version
    },
    tests: {},
    recommendations: []
  };

  try {
    // Test 1: Basic connectivity
    console.log('Testing basic connectivity...');
    const net = require('net');
    
    // Test cPanel port
    try {
      await new Promise((resolve, reject) => {
        const socket = new net.Socket();
        socket.setTimeout(10000);
        socket.on('connect', () => {
          socket.destroy();
          resolve();
        });
        socket.on('timeout', () => {
          socket.destroy();
          reject(new Error('Connection timeout'));
        });
        socket.on('error', reject);
        socket.connect(2083, WHM_HOST);
      });
      
      testResults.tests.cpanelPort = { success: true, port: 2083 };
    } catch (error) {
      testResults.tests.cpanelPort = { success: false, port: 2083, error: error.message };
    }

    // Test 2: UAPI Authentication
    try {
      console.log('Testing UAPI authentication...');
      const result = await cpanelUapiRequest('Email', 'list_pops', { domain: 'test.com' });
      testResults.tests.uapiAuth = { 
        success: true, 
        message: 'UAPI authentication working',
        responseType: typeof result
      };
    } catch (error) {
      testResults.tests.uapiAuth = { 
        success: false, 
        error: error.message,
        code: error.code
      };
    }

    // Test 3: Session-based authentication
    try {
      console.log('Testing session creation...');
      const session = await getCpanelSession();
      testResults.tests.sessionAuth = { 
        success: true, 
        session: session ? 'Generated' : 'Failed',
        message: 'Session authentication available'
      };
    } catch (error) {
      testResults.tests.sessionAuth = { 
        success: false, 
        error: error.message
      };
    }

    // Generate recommendations
    if (!testResults.tests.cpanelPort.success) {
      testResults.recommendations.push('Check firewall settings and ensure cPanel is running on port 2083');
    }

    if (!testResults.tests.uapiAuth.success) {
      testResults.recommendations.push('Verify cPanel API token has correct permissions');
      testResults.recommendations.push('Check token restrictions in cPanel > Security > Manage API Tokens');
    }

    if (testResults.tests.uapiAuth.success) {
      testResults.recommendations.push('✅ UAPI authentication is working - email creation should work');
    } else if (testResults.tests.sessionAuth.success) {
      testResults.recommendations.push('✅ Session-based authentication available as fallback');
    } else {
      testResults.recommendations.push('❌ All authentication methods failed - check credentials');
    }

    res.json({
      success: true,
      ...testResults
    });

  } catch (err) {
    console.error('Connection test failed:', err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      ...testResults
    });
  }
});

// Simple test endpoint
router.get('/cpanel/test', (req, res) => {
  res.json({
    success: true,
    message: 'cPanel API is working',
    timestamp: new Date().toISOString(),
    environment: {
      host: WHM_HOST,
      user: MASTER_USER,
      tokensConfigured: {
        whm: !!WHM_TOKEN,
        cpanel: !!CPANEL_TOKEN
      }
    }
  });
});

module.exports = router;