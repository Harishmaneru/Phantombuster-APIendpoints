require('dotenv').config();
const express = require('express');
const fs = require('fs');
const { v1alpha2 } = require('@google-cloud/domains');
const router = express.Router();

// Initialize client with explicit project ID and credentials
let client;
try {
  const credentialsPath = './domain-email-api-459012-cd9e167afe23.json';
  if (!credentialsPath) {
    throw new Error('Credentials path is not set');
  }

  // Try to load credentials file
  let credentials;
  try {
    credentials = require(credentialsPath);
  } catch (err) {
    throw new Error(`Failed to load credentials file at ${credentialsPath}. Please ensure the file exists and is valid JSON.`);
  }

  client = new v1alpha2.DomainsClient({
    apiEndpoint: 'domains.googleapis.com',
    credentials,
    projectId: process.env.GOOGLE_CLOUD_PROJECT
  });

  // Log client configuration for verification
  console.log('✅ Client API version:', client.apiVersion);
} catch (err) {
  console.error('❌ Failed to initialize Google Cloud client:', err.message);
  process.exit(1);
}

// Read project ID from environment
const projectId = process.env.GOOGLE_CLOUD_PROJECT;

if (!projectId) {
  console.error('❌ GOOGLE_CLOUD_PROJECT not set!');
  process.exit(1);
}

console.log('✅ Using project ID from environment:', projectId);

// Get parent resource string - used for all API calls
function getParent() {
  return `projects/${projectId}/locations/global`;
}

// Common options for API calls
function getApiOptions() {
  return {
    otherArgs: {
      headers: {
        'x-goog-api-client': 'gcloud/alpha',
        'x-goog-user-project': projectId
      }
    }
  };
}

// Add a debug endpoint to verify configuration
router.get('/domains/debug', async (req, res) => {
  try {
    res.json({
      success: true,
      config: {
        projectId: projectId,
        parent: getParent(),
        credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        apiVersion: client.apiVersion
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Domain Check
router.post('/domains/check', async (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ success: false, error: 'domain is required' });

    const parent = getParent();
    console.log(`Checking domain: ${domain} with parent: ${parent}`);

    const request = { parent, query: domain };
    console.log('API Request:', JSON.stringify(request, null, 2));

    const options = getApiOptions();
    console.log('Request headers:', options.otherArgs.headers);

    const [resp] = await client.searchDomains(request, options);
    console.log('API Response:', JSON.stringify(resp, null, 2));

    // Process response to match CLI output structure
    const result = resp.registerParameters.map(param => ({
      domain: param.domainName,
      available: param.availability === 'AVAILABLE',
      price: param.yearlyPrice ? {
        amount: Number(param.yearlyPrice.units || 0),
        currency: param.yearlyPrice.currencyCode || 'USD'
      } : null
    }));

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('❌ Domain check error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      details: {
        code: err.code,
        domain: err.domain,
        reason: err.reason,
        metadata: err.metadata?.getMap()
      }
    });
  }
});

// Domain Info
router.post('/domains/info', async (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ success: false, error: 'domain is required' });

    const parent = getParent();
    const name = `${parent}/registrations/${domain}`;
    const options = getApiOptions();
    const [registration] = await client.getRegistration({ name }, options);

    res.json({ success: true, data: registration });
  } catch (err) {
    console.error('❌ Info fetch error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      details: {
        code: err.code,
        domain: err.domain,
        reason: err.reason,
        metadata: err.metadata?.getMap()
      }
    });
  }
});

// Domain Register
router.post('/domains/register', async (req, res) => {
  try {
    const { domain, contacts } = req.body;
    if (!domain || !contacts)
      return res.status(400).json({ success: false, error: 'domain and contacts are required' });

    const parent = getParent();
    const options = getApiOptions();
    const [operation] = await client.registerDomain({
      parent: parent,
      registration: {
        domainName: domain,
        contactSettings: contacts
      }
    }, options);

    const [result] = await operation.promise();
    res.json({
      success: true,
      data: {
        domain,
        expireTime: result.expireTime
      }
    });
  } catch (err) {
    console.error('❌ Register error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      details: {
        code: err.code,
        domain: err.domain,
        reason: err.reason,
        metadata: err.metadata?.getMap()
      }
    });
  }
});

// Health Check
router.get('/domains/health', async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'API health check successful',
      projectId: projectId,
      parent: getParent(),
      clientInitialized: !!client,
      apiVersion: client.apiVersion
    });
  } catch (err) {
    console.error('❌ Health check error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      details: {
        code: err.code,
        domain: err.domain,
        reason: err.reason,
        metadata: err.metadata?.getMap()
      }
    });
  }
});

module.exports = router;