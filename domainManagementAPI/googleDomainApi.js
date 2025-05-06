// googleDomainApi.js
require('dotenv').config();
const express = require('express');
const { DomainsClient } = require('@google-cloud/domains').v1;

const router = express.Router();
const client = new DomainsClient({
  projectId: process.env.GCP_PROJECT_ID,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
});

// Add validation for the client initialization
if (!process.env.GCP_PROJECT_ID) {
  console.error('GCP_PROJECT_ID environment variable is not set');
  process.exit(1);
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS environment variable is not set');
  process.exit(1);
}

const PARENT = `projects/${process.env.GCP_PROJECT_ID}/locations/global`;

// Add a health check endpoint to verify configuration
router.get('/domains/health', async (req, res) => {
  try {
    // Simple API call to verify connectivity
    await client.searchDomains({
      parent: PARENT,
      query: 'example.com' // Test domain
    });
    res.json({ success: true, message: 'API connection successful' });
  } catch (err) {
    console.error('Health check failed:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message,
      details: {
        projectId: process.env.GCP_PROJECT_ID,
        credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        parent: PARENT
      }
    });
  }
});

/**
 * POST /domains/check
 * { "domain": "example.com" }
 * → { success: true, data: { domain, available, price: { amount, currency } } }
 */
router.post('/domains/check', async (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain)
      return res.status(400).json({ success: false, error: 'domain is required' });

    const [resp] = await client.searchDomains({ parent: PARENT, query: domain });
    const params = resp.registerParameters?.[0];
    if (!params)
      throw new Error('No availability information returned');

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
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});


router.post('/domains/register', async (req, res) => {
  try {
    const { domain, contacts } = req.body;
    if (!domain || !contacts)
      return res.status(400).json({ success: false, error: 'domain and contacts are required' });

    const [operation] = await client.registerDomain({
      parent: PARENT,
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
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /domains/info
 * { "domain": "example.com" }
 * → { success: true, data: { /* full registration object *\/ } }
 */
router.post('/domains/info', async (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain)
      return res.status(400).json({ success: false, error: 'domain is required' });

    const name = `${PARENT}/registrations/${domain}`;
    const registration = await client.getRegistration({ name });
    res.json({ success: true, data: registration });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
