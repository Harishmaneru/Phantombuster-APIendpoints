// const express = require('express');
// const router = express.Router();
// const axios = require('axios');
// const https = require('https');
// const NamecheapDomain = require('./nameCheapDomainApi.js');

// // Configuration - USE IP ADDRESS HERE
// const WHM_HOST = process.env.WHM_HOST;  
// const MASTER_USER = process.env.CPANEL_MASTER_USER;
// const CPANEL_TOKEN = process.env.CPANEL_TOKEN;

// // Create custom HTTPS agent
// const agent = new https.Agent({
//   rejectUnauthorized: false,
//   family: 4,
//   timeout: 30000
// });

// // Validate environment variables
// if (!WHM_HOST || !MASTER_USER || !CPANEL_TOKEN) {
//   console.error('Missing environment variables:', { WHM_HOST, MASTER_USER, CPANEL_TOKEN });
//   throw new Error('Missing required environment variables');
// }

// // Route: Create Email Account
// router.post('/cpanel/create-email', async (req, res) => {
//   const { userId, domain, username, password, storage = 512 } = req.body;

//   // Input validation
//   if (!userId || !domain || !username || !password) {
//     return res.status(400).json({ success: false, error: 'userId, domain, username, and password are required.' });
//   }
//   if (username.toLowerCase() === 'cpanel') {
//     return res.status(400).json({ success: false, error: 'You cannot use "cpanel" as an email account username.' });
//   }
//   if (typeof storage !== 'number' || storage < 10 || storage > 10240) {
//     return res.status(400).json({ success: false, error: 'Storage must be between 10 and 10240 MB.' });
//   }
//   if (password.length < 8) {
//     return res.status(400).json({ success: false, error: 'Password must be at least 8 characters long.' });
//   }

//   try {
//     // Build the exact URL and params as in the working curl
//     const url = `https://${WHM_HOST}:2083/execute/Email/add_pop`;
//     const params = {
//       email: username.toLowerCase(),
//       password,
//       domain: domain.toLowerCase(),
//       quota: storage,
//       send_welcome_email: 1,
//       skip_update_db: 0
//     };

//     console.log('Calling cPanel UAPI:', url, params);

//     // Execute request exactly like the curl command
//     const apiResponse = await axios.get(url, {
//       params,
//       httpsAgent: agent,
//       headers: {
//         'Host': domain.toLowerCase(),
//         'Authorization': `cpanel ${MASTER_USER}:${CPANEL_TOKEN}`,
//         'Accept': 'application/json'
//       },
//       timeout: 30000
//     });

//     const result = apiResponse.data;
//     console.log('cPanel response:', result);

//     if (result.status !== 1) {
//       const msg = (result.errors && result.errors[0]) || 'Unknown error from cPanel';
//       throw new Error(msg);
//     }

//     // Save created email to database (best effort)
//     const emailAddress = `${username.toLowerCase()}@${domain.toLowerCase()}`;
//     NamecheapDomain.findOneAndUpdate(
//       { userId, domain: domain.toLowerCase() },
//       { $push: { emailAccounts: { username, email: emailAddress, quota: storage, createdAt: new Date(), suspended: false } } },
//       { new: true, upsert: true }
//     ).catch(dbErr => console.error('DB save error:', dbErr.message));

//     res.json({ success: true, email: emailAddress, quota: storage, data: result.data });
//   } catch (err) {
//     console.error('Email creation failed:', err.message);
//     res.status(500).json({ success: false, error: err.message });
//   }
// });

// module.exports = router;

const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const NamecheapDomain = require('./nameCheapDomainApi.js');

// Configuration - USE IP ADDRESS HERE
const WHM_HOST = process.env.WHM_HOST;  
const MASTER_USER = process.env.CPANEL_MASTER_USER;
const CPANEL_TOKEN = process.env.CPANEL_TOKEN;

// Create custom HTTPS agent
const agent = new https.Agent({
  rejectUnauthorized: false,
  family: 4,
  timeout: 30000
});

// Validate environment variables
if (!WHM_HOST || !MASTER_USER || !CPANEL_TOKEN) {
  console.error('Missing environment variables:', { WHM_HOST, MASTER_USER, CPANEL_TOKEN });
  throw new Error('Missing required environment variables');
}

// Route: Create Email Account
router.post('/cpanel/create-email', async (req, res) => {
  const { userId, domain, username, password, storage = 512 } = req.body;

  // Input validation
  if (!userId || !domain || !username || !password) {
    return res.status(400).json({ success: false, error: 'userId, domain, username, and password are required.' });
  }
  if (username.toLowerCase() === 'cpanel') {
    return res.status(400).json({ success: false, error: 'You cannot use "cpanel" as an email account username.' });
  }
  if (typeof storage !== 'number' || storage < 10 || storage > 10240) {
    return res.status(400).json({ success: false, error: 'Storage must be between 10 and 10240 MB.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters long.' });
  }

  try {
    // Build the exact URL including query string as in the working curl
    const baseUrl = `https://${WHM_HOST}:2083/execute/Email/add_pop`;
    const apiUrl = `${baseUrl}?email=${username.toLowerCase()}&password=${encodeURIComponent(password)}&domain=${domain.toLowerCase()}&quota=${storage}&send_welcome_email=1&skip_update_db=0`;

    console.log('Calling cPanel UAPI:', apiUrl);

    // Execute request exactly like the curl command
    const apiResponse = await axios.get(apiUrl, {
      httpsAgent: agent,
      headers: {
        'Host': domain.toLowerCase(),
        'Authorization': `cpanel ${MASTER_USER}:${CPANEL_TOKEN}`,
        'Accept': 'application/json'
      },
      timeout: 30000
    });

    const result = apiResponse.data;
    console.log('cPanel response:', result);

    if (result.status !== 1) {
      const msg = (result.errors && result.errors[0]) || 'Unknown error from cPanel';
      throw new Error(msg);
    }

    // Save created email to database (best effort)
    const emailAddress = `${username.toLowerCase()}@${domain.toLowerCase()}`;
    NamecheapDomain.findOneAndUpdate(
      { userId, domain: domain.toLowerCase() },
      { $push: { emailAccounts: { username, email: emailAddress, quota: storage, createdAt: new Date(), suspended: false } } },
      { new: true, upsert: true }
    ).catch(dbErr => console.error('DB save error:', dbErr.message));

    res.json({ success: true, email: emailAddress, quota: storage, data: result.data });
  } catch (err) {
    console.error('Email creation failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
