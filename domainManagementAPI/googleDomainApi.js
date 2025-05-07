require('dotenv').config();
const express = require('express');
const fs = require('fs');
const { DomainsClient } = require('@google-cloud/domains').v1;
const router = express.Router();

// Initialize client with explicit project ID and credentials
const client = new DomainsClient({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
});

// Read numeric project ID from environment
const projectId = process.env.GOOGLE_CLOUD_PROJECT;
const projectNumber = process.env.GOOGLE_CLOUD_PROJECT_NUMBER;

if (!projectId) {
  console.error('❌ GOOGLE_CLOUD_PROJECT not set!');
  process.exit(1);
}

if (!projectNumber) {
  console.error('❌ GOOGLE_CLOUD_PROJECT_NUMBER not set!');
  process.exit(1);
}

console.log('✅ Using project ID from environment:', projectId);
console.log('✅ Using project number from environment:', projectNumber);
console.log('🔍 Parent resource string:', `projects/${projectNumber}/locations/global`);

// Get parent resource string - used for all API calls
function getParent() {
  // use the numeric project number so Cloud Domains will accept it
  return `projects/${projectNumber}/locations/global`;
}

// Add a debug endpoint to verify configuration
router.get('/domains/debug', async (req, res) => {
  try {
    res.json({
      success: true,
      config: {
        projectId: projectId,
        parent: getParent(),
        credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS
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

    const [resp] = await client.searchDomains(request);
    console.log('API Response:', JSON.stringify(resp, null, 2));

    const params = resp.registerParameters?.[0];
    if (!params) throw new Error('No availability info returned');

    const money = params.annualPrice || {};
    const price = {
      amount: (money.units || 0) + (money.nanos || 0) / 1e9,
      currency: money.currencyCode || 'USD'
    };

    res.json({
      success: true,
      data: {
        domain: params.domainName,
        available: params.availability === 'AVAILABLE',
        price
      }
    });
  } catch (err) {
    console.error('❌ Domain check error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      code: err.code,
      reason: err.reason,
      domain: err.domain,
      metadata: err.metadata ? JSON.stringify([...err.metadata.internalRepr.entries()]) : null,
      statusDetails: err.statusDetails?.map(d => d.toString()) || null,
      errorInfoMetadata: err.errorInfoMetadata || null
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
    const [registration] = await client.getRegistration({ name });

    res.json({ success: true, data: registration });
  } catch (err) {
    console.error('❌ Info fetch error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      code: err.code,
      reason: err.reason,
      domain: err.domain,
      metadata: err.metadata ? JSON.stringify([...err.metadata.internalRepr.entries()]) : null
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
    const [operation] = await client.registerDomain({
      parent: parent,
      registration: {
        domainName: domain,
        contactSettings: contacts
      }
    });

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
      code: err.code,
      reason: err.reason,
      domain: err.domain
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
      clientInitialized: !!client
    });
  } catch (err) {
    console.error('❌ Health check error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      code: err.code,
      reason: err.reason,
      domain: err.domain
    });
  }
});

module.exports = router;