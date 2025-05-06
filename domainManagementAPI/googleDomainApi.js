// // googleDomainApi.js
// require('dotenv').config();
// const express = require('express');
// const { DomainsClient } = require('@google-cloud/domains').v1;

// const router = express.Router();
// const client = new DomainsClient({
//   projectId: process.env.GCP_PROJECT_ID,
//   keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
// });

// // Add validation for the client initialization
// if (!process.env.GCP_PROJECT_ID) {
//   console.error('GCP_PROJECT_ID environment variable is not set');
//   process.exit(1);
// }

// if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
//   console.error('GOOGLE_APPLICATION_CREDENTIALS environment variable is not set');
//   process.exit(1);
// }

// const PARENT = `projects/${process.env.GCP_PROJECT_ID}/locations/global`;

// // Add a health check endpoint to verify configuration
// router.get('/domains/health', async (req, res) => {
//   try {
//     // Simple API call to verify connectivity
//     await client.searchDomains({
//       parent: PARENT,
//       query: 'example.com' // Test domain
//     });
//     res.json({ success: true, message: 'API connection successful' });
//   } catch (err) {
//     console.error('Health check failed:', err);
//     res.status(500).json({ 
//       success: false, 
//       error: err.message,
//       details: {
//         projectId: process.env.GCP_PROJECT_ID,
//         credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
//         parent: PARENT
//       }
//     });
//   }
// });

// /**
//  * POST /domains/check
//  * { "domain": "example.com" }
//  * → { success: true, data: { domain, available, price: { amount, currency } } }
//  */
// router.post('/domains/check', async (req, res) => {
//   try {
//     const { domain } = req.body;
//     if (!domain)
//       return res.status(400).json({ success: false, error: 'domain is required' });

//     const [resp] = await client.searchDomains({ parent: PARENT, query: domain });
//     const params = resp.registerParameters?.[0];
//     if (!params)
//       throw new Error('No availability information returned');

//     const money = params.annualPrice || {};
//     const price = {
//       amount: (money.units || 0) + (money.nanos || 0) / 1e9,
//       currency: money.currencyCode || 'USD'
//     };

//     res.json({
//       success: true,
//       data: {
//         domain: params.domainName,
//         available: params.availability === 'AVAILABLE',
//         price
//       }
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ success: false, error: err.message });
//   }
// });


// router.post('/domains/register', async (req, res) => {
//   try {
//     const { domain, contacts } = req.body;
//     if (!domain || !contacts)
//       return res.status(400).json({ success: false, error: 'domain and contacts are required' });

//     const [operation] = await client.registerDomain({
//       parent: PARENT,
//       registration: {
//         domainName: domain,
//         contactSettings: contacts
//       }
//     });

//     const [result] = await operation.promise();
//     res.json({
//       success: true,
//       data: {
//         domain,
//         expireTime: result.expireTime
//       }
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ success: false, error: err.message });
//   }
// });

// /**
//  * POST /domains/info
//  * { "domain": "example.com" }
//  * → { success: true, data: { /* full registration object *\/ } }
//  */
// router.post('/domains/info', async (req, res) => {
//   try {
//     const { domain } = req.body;
//     if (!domain)
//       return res.status(400).json({ success: false, error: 'domain is required' });

//     const name = `${PARENT}/registrations/${domain}`;
//     const registration = await client.getRegistration({ name });
//     res.json({ success: true, data: registration });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ success: false, error: err.message });
//   }
// });

// module.exports = router;



require('dotenv').config();
const express = require('express');
const fs = require('fs');
const { DomainsClient } = require('@google-cloud/domains').v1;
const router = express.Router();

// Load credentials
let credentialsContent;
try {
  const raw = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
  credentialsContent = JSON.parse(raw);
  console.log('✅ Credentials loaded:', credentialsContent.project_id);
} catch (err) {
  console.error('❌ Failed to load credentials:', err.message);
  process.exit(1);
}

// Init Domains client
const projectId = credentialsContent.project_id;
const client = new DomainsClient({
  projectId,
  credentials: {
    client_email: credentialsContent.client_email,
    private_key: credentialsContent.private_key,
  }
});

const PARENT = `projects/${projectId}/locations/global`;
const operationsClient = client.operationsClient;

// Domain Check
router.post('/domains/check', async (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ success: false, error: 'domain is required' });

    const [resp] = await client.searchDomains({ parent: PARENT, query: domain });

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
      metadata: err.metadata ? JSON.stringify([...err.metadata.internalRepr]) : null,
      statusDetails: err.statusDetails || null,
      errorInfoMetadata: err.errorInfoMetadata || null
    });
  }
});

// Domain Info
router.post('/domains/info', async (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ success: false, error: 'domain is required' });

    const name = `${PARENT}/registrations/${domain}`;
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
      metadata: err.metadata ? JSON.stringify([...err.metadata.internalRepr]) : null,
      statusDetails: err.statusDetails || null,
      errorInfoMetadata: err.errorInfoMetadata || null
    });
  }
});

// Domain Register
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
    console.error('❌ Register error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      code: err.code,
      reason: err.reason,
      domain: err.domain,
      metadata: err.metadata ? JSON.stringify([...err.metadata.internalRepr]) : null,
      statusDetails: err.statusDetails || null,
      errorInfoMetadata: err.errorInfoMetadata || null
    });
  }
});

// Health Check
router.get('/domains/health', async (req, res) => {
  try {
    const [operations] = await operationsClient.listOperations({ name: PARENT });
    res.json({
      success: true,
      message: 'API health check successful',
      operationsCount: operations.length
    });
  } catch (err) {
    console.error('❌ Health check error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      code: err.code,
      reason: err.reason,
      domain: err.domain,
      metadata: err.metadata ? JSON.stringify([...err.metadata.internalRepr]) : null,
      statusDetails: err.statusDetails || null,
      errorInfoMetadata: err.errorInfoMetadata || null
    });
  }
});

module.exports = router;
