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

// Helper: Call cPanel UAPI endpoint with proper authentication
async function cpanelUapiRequest(module, func, params) {
  // Build query string exactly like cURL
  const queryString = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    queryString.append(key, value);
  });

  const url = `https://${WHM_HOST}:2083/execute/${module}/${func}?${queryString.toString()}`;
  
  console.log('Final URL:', url.replace(params.password, '******'));

  try {
    const response = await axios.get(url, { // GET with query params in URL
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
        family: 4
      }),
      headers: {
        'Authorization': `cpanel masteruser:${CPANEL_TOKEN}`,
        'Host': params.domain,
        'Accept': 'application/json'
      },
      timeout: 30000
    });

    return response.data;
  } catch (error) {
    console.error('API Error:', {
      url: error.config.url.replace(/(password=)[^&]+/, '$1******'),
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
  
  // Check for reserved username
  if (username.toLowerCase() === 'cpanel') {
    return res.status(400).json({ 
      success: false, 
      error: 'You cannot use "cpanel" as an email account username.' 
    });
  }
  
  if (typeof storage !== 'number' || storage < 10 || storage > 10240) {
    return res.status(400).json({ 
      success: false, 
      error: 'Storage must be a number between 240 and 10240 (MB).' 
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
    
    // Parameters for cPanel UAPI Email/add_pop (matching working curl command)
    const params = {
      email: username.toLowerCase(), // Just the username, not full email address
      password,
      quota: storage, // Storage quota in MB
      domain: domain.toLowerCase(), // Domain for the email account
      send_welcome_email: 1, // Send welcome email
      skip_update_db: 0 // Update the email accounts database cache
    };

    console.log('Attempting UAPI email creation...');
    const result = await cpanelUapiRequest('Email', 'add_pop', params);
    
    // Check if UAPI response indicates success (matching your curl response format)
    if (result && result.status === 1) {
      console.log('UAPI email creation successful');
    } else {
      const errors = result?.errors || ['Unknown error'];
      throw new Error(errors[0] || 'UAPI returned unsuccessful status');
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
      method: 'UAPI',
      message: `Email account ${emailAddress} created successfully`,
      data: result.data // Include the response data like your curl command
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
    } else {
      testResults.recommendations.push('❌ UAPI authentication failed - check credentials and permissions');
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