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
async function createCpanelEmail(username, password, domain, quota = 512) {
  // 1. Prepare parameters EXACTLY like cURL
  const params = new URLSearchParams();
  params.append('email', username); // Just username without domain
  params.append('password', password); // Will auto-encode special chars
  params.append('domain', domain);
  params.append('quota', quota.toString());
  params.append('send_welcome_email', '1'); // Must be string '1'
  params.append('skip_update_db', '0'); // Must be string '0'

  // 2. Configure HTTPS agent to match cURL behavior
  const agent = new https.Agent({
    rejectUnauthorized: false, // Allow self-signed certs
    family: 4, // Force IPv4
    keepAlive: true,
    timeout: 10000 // 10 second timeout
  });

  // 3. Make the API request
  try {
    const response = await axios.get(
      `https://${WHM_HOST}:2083/execute/Email/add_pop?${params.toString()}`,
      {
        httpsAgent: agent,
        headers: {
          'Host': domain, // Critical: must match target domain
          'Authorization': `cpanel ${MASTER_USER}:${CPANEL_TOKEN}`,
          'Accept': 'application/json',
          'Connection': 'keep-alive'
        }
      }
    );

    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    // Enhanced error logging
    console.error('API Request Failed:', {
      url: error.config?.url.replace(/(password=)[^&]+/, '$1******'),
      status: error.response?.status,
      headers: error.response?.headers,
      data: error.response?.data
    });

    return {
      success: false,
      error: error.message,
      details: error.response?.data || {}
    };
  }
}




// POST /api/emails
router.post('/create-email', async (req, res) => {
  const { username, password, domain, quota = 512 } = req.body;

  // Input validation
  if (!username || !password || !domain) {
    return res.status(400).json({ 
      error: 'Missing required fields: username, password, domain' 
    });
  }

  try {
    const result = await createCpanelEmail(username, password, domain, quota);
    
    if (result.success) {
      return res.json({
        email: `${username}@${domain}`,
        quota,
        status: 'created'
      });
    } else {
      return res.status(500).json({
        error: 'Email creation failed',
        details: result.error
      });
    }
  } catch (error) {
    console.error('Email creation error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * Create an email account
 * Expected req.body: { userId, domain, username, password, storage }
 */
// router.post('/cpanel/create-email', async (req, res) => {
//   const { userId, domain, username, password, storage = 1024 } = req.body;

//   // Validate inputs
//   if (!userId || !domain || !username || !password) {
//     return res.status(400).json({ 
//       success: false, 
//       error: 'userId, domain, username, and password are required.' 
//     });
//   }
  
//   // Check for reserved username
//   if (username.toLowerCase() === 'cpanel') {
//     return res.status(400).json({ 
//       success: false, 
//       error: 'You cannot use "cpanel" as an email account username.' 
//     });
//   }
  
//   if (typeof storage !== 'number' || storage < 10 || storage > 10240) {
//     return res.status(400).json({ 
//       success: false, 
//       error: 'Storage must be a number between 240 and 10240 (MB).' 
//     });
//   }
  
//   if (password.length < 8) {
//     return res.status(400).json({ 
//       success: false, 
//       error: 'Password must be at least 8 characters long.' 
//     });
//   }

//   try {
//     console.log(`Starting email creation for ${username}@${domain}`);
    
//     // Parameters for cPanel UAPI Email/add_pop (matching working curl command)
//     const params = {
//       email: username.toLowerCase(), // Just the username, not full email address
//       password,
//       quota: storage, // Storage quota in MB
//       domain: domain.toLowerCase(), // Domain for the email account
//       send_welcome_email: 1, // Send welcome email
//       skip_update_db: 0 // Update the email accounts database cache
//     };

//     console.log('Attempting UAPI email creation...');
//     const result = await cpanelUapiRequest('Email', 'add_pop', params);
    
//     // Check if UAPI response indicates success (matching your curl response format)
//     if (result && result.status === 1) {
//       console.log('UAPI email creation successful');
//     } else {
//       const errors = result?.errors || ['Unknown error'];
//       throw new Error(errors[0] || 'UAPI returned unsuccessful status');
//     }

//     // Save to database
//     const emailAddress = `${username.toLowerCase()}@${domain.toLowerCase()}`;
//     try {
//       await NamecheapDomain.findOneAndUpdate(
//         { userId, domain: domain.toLowerCase() },
//         { 
//           $push: { 
//             emailAccounts: { 
//               username: username.toLowerCase(), 
//               email: emailAddress, 
//               quota: storage, 
//               createdAt: new Date(), 
//               suspended: false 
//             } 
//           } 
//         },
//         { new: true, upsert: true }
//       );
//       console.log('Email account saved to database');
//     } catch (dbError) {
//       console.error('Database save error:', dbError.message);
//       // Continue even if DB save fails since the email was created
//     }

//     res.json({ 
//       success: true, 
//       email: emailAddress, 
//       quota: storage,
//       method: 'UAPI',
//       message: `Email account ${emailAddress} created successfully`,
//       data: result.data // Include the response data like your curl command
//     });
    
//   } catch (err) {
//     console.error('Email creation failed:', {
//       timestamp: new Date().toISOString(),
//       error: err.message,
//       stack: err.stack,
//       request: {
//         userId,
//         domain,
//         username,
//         storage
//       }
//     });
    
//     res.status(500).json({ 
//       success: false, 
//       error: err.message,
//       details: {
//         code: err.code,
//         type: err.name,
//         recommendation: 'Check server connectivity, domain existence, and API credentials'
//       }
//     });
//   }
// });

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