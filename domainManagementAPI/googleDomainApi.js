require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { DomainsClient } = require('@google-cloud/domains').v1;
const { GoogleAuth } = require('google-auth-library');
const router = express.Router();

// Enable JSON parsing
router.use(express.json());

// Environment verification middleware
router.use((req, res, next) => {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS || !process.env.GOOGLE_CLOUD_PROJECT) {
    console.error('Missing required environment variables');
    return res.status(500).json({
      success: false,
      error: 'Server configuration error - missing environment variables',
      details: {
        missing: [
          !process.env.GOOGLE_APPLICATION_CREDENTIALS && 'GOOGLE_APPLICATION_CREDENTIALS',
          !process.env.GOOGLE_CLOUD_PROJECT && 'GOOGLE_CLOUD_PROJECT'
        ].filter(Boolean)
      }
    });
  }
  next();
});

// Global error handling
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});

// Initialize client
let client;
let authClient;
let credentials;
try {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialsPath) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS environment variable not set');
  }

  const resolvedCredentialsPath = path.resolve(credentialsPath);
  if (!fs.existsSync(resolvedCredentialsPath)) {
    throw new Error(`Credentials file not found at ${resolvedCredentialsPath}`);
  }

  // Read credentials file directly
  credentials = JSON.parse(fs.readFileSync(resolvedCredentialsPath, 'utf8'));

  // Verify required fields in credentials
  const requiredFields = ['type', 'project_id', 'private_key', 'client_email'];
  const missingFields = requiredFields.filter(field => !credentials[field]);
  if (missingFields.length > 0) {
    throw new Error(`Missing required fields in credentials: ${missingFields.join(', ')}`);
  }

  // Initialize auth client (but don't generate token yet)
  authClient = new GoogleAuth({
    credentials: {
      type: credentials.type,
      project_id: credentials.project_id,
      private_key: credentials.private_key.replace(/\\n/g, '\n'),
      client_email: credentials.client_email,
      client_id: credentials.client_id,
      token_url: credentials.token_uri || 'https://oauth2.googleapis.com/token'
    },
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    projectId: credentials.project_id
  });

  // Initialize Domains client
  client = new DomainsClient({
    credentials: {
      type: credentials.type,
      project_id: credentials.project_id,
      private_key: credentials.private_key.replace(/\\n/g, '\n'),
      client_email: credentials.client_email,
      client_id: credentials.client_id
    },
    projectId: credentials.project_id,
    fallback: 'rest'
  });

  console.log('✅ Successfully initialized Domains client');
} catch (err) {
  console.error('❌ Initialization failed:', {
    message: err.message,
    stack: err.stack,
    details: err.details || 'No additional details'
  });
  process.exit(1);
}

// Read project ID
const projectId = process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) {
  console.error('❌ GOOGLE_CLOUD_PROJECT not set!');
  process.exit(1);
}
console.log('✅ Using project ID:', projectId);

// Get parent
function getParent() {
  return `projects/${projectId}/locations/global`;
}

// API options
function getApiOptions() {
  return {
    otherArgs: {
      headers: {
        'Content-Type': 'application/json',
        'x-goog-user-project': projectId
      }
    }
  };
}

// Validate contacts
function validateContacts(contacts) {
  const requiredFields = ['registrantContact', 'adminContact', 'technicalContact'];
  const missingFields = requiredFields.filter(field => !contacts[field]);
  if (missingFields.length > 0) {
    throw new Error(`Missing required contact fields: ${missingFields.join(', ')}`);
  }
  return true;
}

// Debug endpoint
router.get('/domains/debug', async (req, res) => {
  try {
    console.log('Attempting to generate access token for debug endpoint...');
    const tokenResponse = await authClient.getAccessToken();
    console.log('Access token generated successfully for debug endpoint');
    res.json({
      success: true,
      config: {
        projectId,
        parent: getParent(),
        credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        credentialsExist: fs.existsSync(path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)),
        apiEndpoint: client.apiEndpoint,
        fallback: client.fallback,
        tokenGenerated: !!tokenResponse.token
      }
    });
  } catch (err) {
    console.error('❌ Debug endpoint error:', {
      message: err.message,
      stack: err.stack
    });
    res.status(500).json({ success: false, error: err.message });
  }
});

// Domain Check
router.post('/domains/check', async (req, res) => {
  console.log('Received request to /domains/check', { body: req.body });
  
  try {
    const { domain } = req.body;
    if (!domain) {
      console.log('Domain check failed - domain parameter missing');
      return res.status(400).json({
        success: false,
        error: 'domain is required'
      });
    }

    console.log('Checking domain availability using DomainsClient...');
    
    // Add timeout for the entire operation
    const operationTimeout = 15000; // 15 seconds
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Operation timeout')), operationTimeout)
    );

    // Use DomainsClient with timeout
    const searchPromise = client.searchDomains({
      query: domain,
      location: getParent()
    }, getApiOptions());

    const [response] = await Promise.race([searchPromise, timeoutPromise]);

    // Process successful response
    const result = response.registerParameters ? response.registerParameters.map(param => ({
      domain: param.domainName,
      available: param.availability === 'AVAILABLE',
      price: param.yearlyPrice ? {
        amount: Number(param.yearlyPrice.units || 0) + (param.yearlyPrice.nanos || 0) / 1e9,
        currency: param.yearlyPrice.currencyCode || 'USD'
      } : null,
      supportedPrivacy: param.supportedPrivacy || []
    })) : [];

    console.log('Domain check successful, returning results');
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('❌ Domain check error:', {
      message: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    });

    // Enhanced error diagnostics
    let status = 500;
    let errorDetails = undefined;

    if (err.message.includes('timeout')) {
      status = 504;
      errorDetails = 'The operation timed out. Please try again.';
    } else if (err.message.includes('ENOTFOUND')) {
      status = 503;
      errorDetails = 'Network connectivity issue - could not reach Google servers';
    } else if (err.message.includes('invalid_grant')) {
      status = 401;
      errorDetails = 'Invalid service account credentials - check your private key and client email';
    } else if (err.message.includes('PERMISSION_DENIED')) {
      status = 403;
      errorDetails = 'The service account does not have required permissions';
    } else if (err.message.includes('INVALID_ARGUMENT')) {
      status = 400;
      errorDetails = 'Invalid domain name format';
    }

    res.status(status).json({
      success: false,
      error: err.message,
      details: errorDetails
    });
  }
});

// Domain Info
router.post('/domains/info', async (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ success: false, error: 'domain is required' });

    console.log('Attempting to generate access token for domain info...');
    const tokenResponse = await authClient.getAccessToken();
    console.log('Access token generated successfully for domain info');

    const parent = getParent();
    const name = `${parent}/registrations/${domain}`;
    const options = getApiOptions();
    console.log('API Request:', { name });
    console.log('Request headers:', JSON.stringify(options.otherArgs.headers, null, 2));

    const [registration] = await client.getRegistration({ name }, options);
    console.log('API Response:', JSON.stringify(registration, null, 2));

    res.json({ success: true, data: registration });
  } catch (err) {
    console.error('❌ Info fetch error:', {
      message: err.message,
      code: err.code,
      details: err.details,
      metadata: err.metadata?.getMap?.(),
      stack: err.stack
    });
    res.status(err.code === 5 ? 404 : 500).json({
      success: false,
      error: err.message,
      details: {
        code: err.code,
        reason: err.metadata?.getMap?.()['google.rpc.errorinfo-bin']?.reason,
        metadata: err.metadata?.getMap?.()
      }
    });
  }
});

// Domain Register
router.post('/domains/register', async (req, res) => {
  try {
    const { domain, contacts } = req.body;
    if (!domain || !contacts) {
      return res.status(400).json({
        success: false,
        error: 'domain and contacts are required'
      });
    }

    try {
      validateContacts(contacts);
    } catch (validationError) {
      return res.status(400).json({
        success: false,
        error: validationError.message
      });
    }

    console.log('Attempting to generate access token for domain registration...');
    const tokenResponse = await authClient.getAccessToken();
    console.log('Access token generated successfully for domain registration');

    const parent = getParent();
    const options = getApiOptions();
    console.log('API Request:', { parent, registration: { domainName: domain, contactSettings: contacts } });
    console.log('Request headers:', JSON.stringify(options.otherArgs.headers, null, 2));

    const [operation] = await client.registerDomain({
      parent,
      registration: {
        domainName: domain,
        contactSettings: contacts
      }
    }, options);

    const [result] = await operation.promise();
    console.log('API Response:', JSON.stringify(result, null, 2));

    res.json({
      success: true,
      data: {
        domain,
        expireTime: result.expireTime
      }
    });
  } catch (err) {
    console.error('❌ Register error:', {
      message: err.message,
      code: err.code,
      details: err.details,
      metadata: err.metadata?.getMap?.(),
      stack: err.stack
    });
    res.status(err.code === 3 ? 400 : 500).json({
      success: false,
      error: err.message,
      details: {
        code: err.code,
        reason: err.metadata?.getMap?.()['google.rpc.errorinfo-bin']?.reason,
        metadata: err.metadata?.getMap?.()
      }
    });
  }
});

// Health Check
router.get('/domains/health', async (req, res) => {
  try {
    console.log('Attempting to generate access token for health check...');
    const tokenResponse = await authClient.getAccessToken();
    console.log('Access token generated successfully for health check');
    
    res.json({
      success: true,
      message: 'API health check successful',
      projectId,
      parent: getParent(),
      clientInitialized: !!client,
      credentialsExist: fs.existsSync(path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)),
      tokenGenerated: !!tokenResponse.token
    });
  } catch (err) {
    console.error('❌ Health check error:', {
      message: err.message,
      code: err.code,
      details: err.details,
      metadata: err.metadata?.getMap?.(),
      stack: err.stack
    });
    res.status(500).json({
      success: false,
      error: err.message,
      details: {
        code: err.code,
        reason: err.metadata?.getMap?.()['google.rpc.errorinfo-bin']?.reason,
        metadata: err.metadata?.getMap?.()
      }
    });
  }
});

module.exports = router;