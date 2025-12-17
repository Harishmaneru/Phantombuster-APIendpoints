const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const rateLimit = require('express-rate-limit');
const qs = require('qs');

// Required Environment Variables:
// - WHM_HOST: IP address or hostname of your WHM server
// - CPANEL_MASTER_USER: Master cPanel username
// - CPANEL_TOKEN: cPanel API token for the master user
// Note: DMARC operations now use cPanel UAPI (same as email operations) instead of WHM API
// Import the NamecheapDomain model from the existing schema
const { NamecheapDomain } = require('./nameCheapDomainApi.js');

// Import simple file logging system
const fileLogger = require('../loggingSystem/fileLogger');

// Import Slack logger for webhook logging
const { slackLogger } = require('../webhooks/slackLogger');

// Configuration - USE IP ADDRESS HERE
const WHM_HOST = process.env.WHM_HOST;
const MASTER_USER = process.env.CPANEL_MASTER_USER;
const CPANEL_TOKEN = process.env.CPANEL_TOKEN;

// Create custom HTTPS agent
const agent = new https.Agent({
  rejectUnauthorized: false,
  family: 4,
  timeout: 60000
});

// Validate environment variables
if (!WHM_HOST || !MASTER_USER || !CPANEL_TOKEN) {
  console.error('Missing environment variables:', { WHM_HOST, MASTER_USER, CPANEL_TOKEN });
  throw new Error('Missing required environment variables');
}

// Rate limiting middleware
const emailCreationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 email creation requests per windowMs
  message: {
    success: false,
    error: 'Too many email creation requests, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Input validation functions
function isValidDomain(domain) {
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return domainRegex.test(domain) && domain.length <= 253;
}

function isValidEmailUser(username) {
  const usernameRegex = /^[a-zA-Z0-9._%+-]+$/;
  return usernameRegex.test(username) && username.length >= 3 && username.length <= 64;
}

function isValidPassword(password) {
  return password && password.length >= 8 && password.length <= 128;
}

// cPanel API helper functions
async function cpanelRequest(endpoint, params = {}, method = 'GET') {
  try {
    let url = `https://${WHM_HOST}:2083/execute/${endpoint}`;
    let requestConfig = {
      httpsAgent: agent,
      headers: {
        'Authorization': `cpanel ${MASTER_USER}:${CPANEL_TOKEN}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 30000
    };

    if (method === 'GET') {
      const queryString = new URLSearchParams(params).toString();
      url += queryString ? '?' + queryString : '';
      console.log('cPanel API Request (GET):', url);
    } else {
      requestConfig.method = 'POST';
      requestConfig.data = params;
      console.log('cPanel API Request (POST):', url, 'with data:', params);
    }

    const response = await axios(url, requestConfig);

    console.log('cPanel API Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('cPanel API Error:', error.response?.data || error.message);
    throw error;
  }
}

// WHM API helper function
async function whmRequest(functionName, params = {}) {
  try {
    const queryString = new URLSearchParams({
      'api.version': '1',
      ...params
    }).toString();

    const url = `https://${WHM_HOST}/json-api/${functionName}?${queryString}`;

    console.log('WHM API Request:', url);

    const response = await axios.get(url, {
      httpsAgent: agent,
      headers: {
        'Authorization': `WHM ${MASTER_USER}:${CPANEL_TOKEN}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    console.log('WHM API Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('WHM API Error:', error.response?.data || error.message);
    throw error;
  }
}

// Check if domain exists as addon domain
async function checkAddonDomainExists(domain) {
  try {
    const result = await cpanelRequest('DomainInfo/list_domains');
    if (result.data) {
      // Check if it's the main domain
      if (result.data.main_domain === domain) {
        console.log(`Domain ${domain} is the main domain`);
        return true; // Main domain exists, no need to add as addon
      }

      // Check if it's already an addon domain
      if (result.data.addon_domains &&
        result.data.addon_domains.some(d => d.domain === domain)) {
        console.log(`Domain ${domain} is already an addon domain`);
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error('Error checking addon domain:', error);
    return false;
  }
}

// Check domain ownership using WHM
async function checkDomainOwnership(domain) {
  try {
    const result = await whmRequest('get_domain_info', {
      domain: domain.toLowerCase()
    });

    if (result.status === 1 && result.data) {
      console.log(`Domain ${domain} ownership info:`, result.data);
      return {
        exists: true,
        owner: result.data.owner,
        type: result.data.type,
        status: result.data.status
      };
    }
    return { exists: false };
  } catch (error) {
    console.log(`Domain ${domain} ownership check failed:`, error.message);
    return { exists: false, error: error.message };
  }
}

// Add domain as addon domain (only if needed and supported)
async function addAddonDomain(domain) {
  try {
    // First check if this is the main domain
    const domainInfo = await cpanelRequest('DomainInfo/list_domains');
    if (domainInfo.data && domainInfo.data.main_domain === domain) {
      console.log(`Domain ${domain} is the main domain, no need to add as addon domain`);
      return { status: 1, data: 'Main domain detected' };
    }

    const subdomain = `${domain.replace(/[^a-zA-Z0-9]/g, '_')}_addon`;
    const dir = `public_html/${domain}`;

    const result = await cpanelRequest('AddonDomain/addaddondomain', {
      newdomain: domain,
      subdomain: subdomain,
      dir: dir
    });

    console.log('Addon domain added:', result);
    return result;
  } catch (error) {
    console.error('Error adding addon domain:', error);
    // If AddonDomain module is not available, we'll continue without it
    if (error.response?.data?.errors &&
      error.response.data.errors.some(err => err.includes('AddonDomain'))) {
      console.log('AddonDomain module not available, continuing without addon domain setup');
      return { status: 1, data: 'AddonDomain module not available, continuing' };
    }
    throw error;
  }
}

/**
 * Adds a domain as addon if not already added
 * This function uses browser-style cPanel form requests to ensure compatibility
 * with various cPanel configurations and hosting providers.
 * 
 * @param {string} domain - The domain to add
 * @returns {Promise<{status: number, message?: string, error?: string}>}
 *   - status: 1 for success, 0 for failure
 *   - message: Success message or "Domain already exists in cPanel"
 *   - error: Error message if domain addition failed
 */
async function addDomainIfNotExists(domain) {
  // Step 1: Check if domain already exists using UAPI
  try {
    const checkRes = await axios.get(
      `https://${WHM_HOST}:2083/execute/DomainInfo/domains_data`,
      {
        headers: {
          Authorization: `cpanel ${MASTER_USER}:${CPANEL_TOKEN}`,
        },
        httpsAgent: new (require("https").Agent)({ rejectUnauthorized: false }),
      }
    );

    const domainsList = checkRes.data?.data?.main_domain
      ? [checkRes.data.data.main_domain, ...checkRes.data.data.addon_domains]
      : [];

    if (domainsList.includes(domain.toLowerCase())) {
      return { status: 1, message: "Domain already exists in cPanel" };
    }
  } catch (checkErr) {
    console.error("Domain check failed, continuing to add:", checkErr.message);
  }

  // Step 2: Try to add domain using browser-style form
  const formData = qs.stringify({
    cpanel_jsonapi_apiversion: "2",
    cpanel_jsonapi_module: "AddonDomain",
    cpanel_jsonapi_func: "addaddondomain",
    newdomain: domain,
    subdomain: domain,
    ftp_is_optional: "1",
    dir: domain,
  });

  try {
    const response = await axios.post(
      `https://${WHM_HOST}:2083/json-api/cpanel`,
      formData,
      {
        headers: {
          Authorization: `cpanel ${MASTER_USER}:${CPANEL_TOKEN}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        httpsAgent: new (require("https").Agent)({
          rejectUnauthorized: false,
        }),
      }
    );

    const result = response.data;
    const addonSuccess = result?.cpanelresult?.data?.[0]?.result === 1;

    if (addonSuccess) {
      return {
        status: 1,
        message: result.cpanelresult.data[0].reason,
      };
    } else {
      return {
        status: 0,
        error: result.cpanelresult?.data?.[0]?.reason || "Addon domain creation failed",
      };
    }
  } catch (err) {
    return {
      status: 0,
      error: err.response?.data || err.message,
    };
  }
}

// Verify user owns domain in database
async function userOwnsDomain(userId, domain) {
  try {
    const domainRecord = await NamecheapDomain.findOne({
      userId: userId,
      domain: domain.toLowerCase()
    });

    return !!domainRecord && domainRecord.domainStatus.isActive;
  } catch (error) {
    console.error('Error checking domain ownership:', error);
    return false;
  }
}

// Helper function to list available email functions
async function listAvailableEmailFunctions() {
  try {
    // Try to get available functions for Email module
    const result = await cpanelRequest('Email/list_functions');
    return result;
  } catch (error) {
    console.error('Error listing email functions:', error);
    return null;
  }
}

// Test route to check domain information
router.get('/cpanel/test-domain-info', async (req, res) => {
  try {
    const domainInfo = await cpanelRequest('DomainInfo/list_domains');
    res.json({
      success: true,
      domainInfo: domainInfo,
      message: 'Domain information retrieved successfully'
    });
  } catch (err) {
    console.error('Failed to get domain info:', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/cpanel/add-domain', async (req, res) => {
  const { userId, domain, subdomain = null, directory = null } = req.body;

  if (!userId || !domain) {
    return res.status(400).json({ success: false, error: 'userId and domain are required.' });
  }

  if (!isValidDomain(domain)) {
    return res.status(400).json({ success: false, error: 'Invalid domain format.' });
  }

  try {
    // (Optional) Step: Verify user owns domain
    const domainOwnership = await userOwnsDomain(userId, domain);
    if (!domainOwnership) {
      return res.status(403).json({ success: false, error: 'Domain not registered to user or not active.' });
    }

    // (Optional) Step: Check if domain already exists
    const domainExists = await checkAddonDomainExists(domain);
    if (domainExists) {
      return res.status(409).json({
        success: false,
        error: 'Domain already exists in cPanel.',
        domain: domain.toLowerCase()
      });
    }

    const safeDomain = domain.toLowerCase();
    const autoSubdomain = subdomain || `${safeDomain.replace(/[^a-zA-Z0-9]/g, '_')}_addon`;
    const autoDirectory = directory || `public_html/${safeDomain}`;

    // ✅ Add domain using WHM API
    const whmResult = await whmRequest('createaddondomain', {
      user: MASTER_USER,
      domain: safeDomain,
      dir: autoDirectory,
      subdomain: autoSubdomain
    });

    if (!whmResult || whmResult.metadata?.result !== 1) {
      throw new Error(whmResult.metadata?.reason || 'WHM API failed without clear reason');
    }

    // (Optional) Save domain config to DB
    const updatedDomain = await NamecheapDomain.findOneAndUpdate(
      { userId, domain: safeDomain },
      {
        $set: {
          'cpanelConfiguration.domainAdded': true,
          'cpanelConfiguration.domainAddedAt': new Date(),
          'cpanelConfiguration.subdomain': autoSubdomain,
          'cpanelConfiguration.directory': autoDirectory,
          updatedAt: new Date()
        }
      },
      { new: true }
    );

    return res.json({
      success: true,
      message: 'Domain added successfully via WHM API',
      domain: safeDomain,
      subdomain: autoSubdomain,
      directory: autoDirectory,
      data: whmResult.data,
      databaseRecord: {
        updated: !!updatedDomain,
        domainId: updatedDomain?._id
      }
    });

  } catch (error) {
    console.error('WHM API error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to add domain via WHM API',
      details: error.response?.data || error.message
    });
  }
});
// Route: Create Email Account with Addon Domain Support
router.post('/cpanel/create-email', emailCreationLimiter, async (req, res) => {
  const { userId, domain, username, password, storage = 512 } = req.body;

  // Input validation
  if (!userId || !domain || !username || !password) {
    return res.status(400).json({
      success: false,
      error: 'userId, domain, username, and password are required.'
    });
  }

  if (!isValidDomain(domain)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid domain format.'
    });
  }

  if (!isValidEmailUser(username)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid username format. Username must be 3-64 characters and contain only letters, numbers, and common symbols.'
    });
  }

  if (username.toLowerCase() === 'cpanel') {
    return res.status(400).json({
      success: false,
      error: 'You cannot use "cpanel" as an email account username.'
    });
  }

  if (!isValidPassword(password)) {
    return res.status(400).json({
      success: false,
      error: 'Password must be between 8 and 128 characters long.'
    });
  }

  if (typeof storage !== 'number' || storage < 10 || storage > 10240) {
    return res.status(400).json({
      success: false,
      error: 'Storage must be between 10 and 10240 MB.'
    });
  }

  try {
    // Step 1: Verify user owns domain
    const domainOwnership = await userOwnsDomain(userId, domain);
    if (!domainOwnership) {
      return res.status(403).json({
        success: false,
        error: 'Domain not registered to user or domain is not active.'
      });
    }

    // Step 2: Try to create email account FIRST (before parking domain)
    console.log(`🔍 STEP 1: Attempting to create email account for domain ${domain} FIRST...`);

    const emailParams = {
      email: username.toLowerCase(),
      password: password,
      domain: domain.toLowerCase(),
      quota: storage,
      send_welcome_email: '1',
      skip_update_db: '0'
    };

    console.log('Creating email with params:', { ...emailParams, password: '[HIDDEN]' });

    // Try WHM API first, then fall back to cPanel API
    let emailResult;
    let domainCheck = null;
    let domainWasAdded = false;

    try {
      console.log(' Trying WHM API for email creation...');
      emailResult = await whmRequest('add_pop', {
        email: `${username.toLowerCase()}@${domain.toLowerCase()}`,
        password: password,
        quota: storage
      });
      // WHM API returns different format, normalize it
      if (emailResult.status === 1) {
        emailResult = { status: 1, data: emailResult.data };
      } else {
        throw new Error(emailResult.error || 'WHM API email creation failed');
      }
    } catch (whmError) {
      console.log('WHM API failed, trying cPanel API...', whmError.message);
      emailResult = await cpanelRequest('Email/add_pop', emailParams, 'POST');
    }

    console.log('📊 FIRST EMAIL CREATION RESULT:', JSON.stringify(emailResult, null, 2));

    // If email creation failed, THEN try to add domain and retry
    if (emailResult.status !== 1) {
      console.log(' Email creation failed, NOW attempting to add domain...');

      // Try to add domain as addon domain
      domainCheck = await addDomainIfNotExists(domain);

      if (domainCheck.status !== 1) {
        return res.status(500).json({
          success: false,
          error: `Failed to add domain: ${domainCheck.error}`,
        });
      }
      console.log(`✅Domain verified/added: ${domainCheck.message}`);

      // Update domain record in database if domain was added
      if (domainCheck.message && domainCheck.message !== "Domain already exists in cPanel") {
        domainWasAdded = true;
        await NamecheapDomain.findOneAndUpdate(
          { userId, domain: domain.toLowerCase() },
          {
            $set: {
              'cpanelConfiguration.domainAdded': true,
              'cpanelConfiguration.domainAddedAt': new Date(),
              'cpanelConfiguration.subdomain': domain,
              'cpanelConfiguration.directory': `public_html/${domain}`,
              updatedAt: new Date()
            }
          },
          { new: true }
        );
      }

      // Retry email creation after domain is added
      console.log('Retrying email creation after domain addition...');
      try {
        console.log('Trying WHM API for email creation (retry)...');
        emailResult = await whmRequest('add_pop', {
          email: `${username.toLowerCase()}@${domain.toLowerCase()}`,
          password: password,
          quota: storage
        });
        // WHM API returns different format, normalize it
        if (emailResult.status === 1) {
          emailResult = { status: 1, data: emailResult.data };
        } else {
          throw new Error(emailResult.error || 'WHM API email creation failed');
        }
      } catch (whmError) {
        console.log(' WHM API failed, trying cPanel API (retry)...', whmError.message);
        emailResult = await cpanelRequest('Email/add_pop', emailParams, 'POST');
      }

      console.log(' RETRY EMAIL CREATION RESULT:', JSON.stringify(emailResult, null, 2));
    } else {
      // Email creation succeeded on first try, set default domain status
      console.log('✅ Email creation succeeded on FIRST attempt!');
      domainCheck = { message: "Domain already exists in cPanel" };
    }

    // Step 3: Handle email creation result

    if (emailResult.status !== 1) {
      const errorMsg = (emailResult.errors && emailResult.errors[0]) || 'Unknown error from cPanel';

      // Return the actual API response for better debugging
      res.status(500).json({
        success: false,
        error: `Email creation failed: ${errorMsg}`,
        apiResponse: emailResult,
        domain: domain.toLowerCase(),
        attemptedMethods: {
          whmApi: true,
          cpanelApi: true,
          domainCheck: domainCheck.message
        }
      });
      return;
    }

    // Step 4: Save created email to database
    const emailAddress = `${username.toLowerCase()}@${domain.toLowerCase()}`;
    const emailAccountData = {
      username: username.toLowerCase(),
      email: emailAddress,
      quota: storage,
      createdAt: new Date(),
      suspended: false
    };

    // Update domain in database with new email account
    const updatedDomain = await NamecheapDomain.findOneAndUpdate(
      { userId, domain: domain.toLowerCase() },
      {
        $push: { emailAccounts: emailAccountData },
        $set: {
          'dnsConfiguration.emailDNSConfigured': true,
          'dnsConfiguration.emailDNSConfiguredAt': new Date(),
          updatedAt: new Date()
        }
      },
      { new: true, upsert: false }
    );

    if (!updatedDomain) {
      console.warn('Domain not found in database for user:', userId, 'domain:', domain);
      // Still return success since email was created in cPanel
    }

    // Step 5: Log email creation
    try {
      // Log to file system (existing functionality)
      fileLogger.logEmailCreation({
        userId: userId,
        userEmail: `${username.toLowerCase()}@${domain.toLowerCase()}`,
        emailAddress: emailAddress,
        username: username.toLowerCase(),
        domain: domain.toLowerCase(),
        quota: storage,
        storageUsed: 0,
        suspended: false,
        status: 'completed',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        apiEndpoint: '/cpanel/create-email',
        requestMethod: 'POST',
        metadata: {
          domainId: updatedDomain?._id,
          emailAccountsCount: updatedDomain?.emailAccounts?.length || 0,
          cpanelResponse: emailResult.data
        }
      });

      // Log to Slack via webhook (new functionality)
      await slackLogger.logEmailCreation({
        id: Date.now().toString(),
        status: 'completed',
        emailAddress: emailAddress,
        username: username.toLowerCase(),
        domain: domain.toLowerCase(),
        quota: storage,
        storageUsed: 0,
        suspended: false,
        userId: userId,
        userEmail: `${username.toLowerCase()}@${domain.toLowerCase()}`,
        ipAddress: req.ip,
        endpoint: '/cpanel/create-email',
        method: 'POST',
        metadata: {
          domainId: updatedDomain?._id,
          emailAccountsCount: updatedDomain?.emailAccounts?.length || 0,
          cpanelResponse: emailResult.data,
          provider: 'cPanel',
          operation: 'email_creation'
        }
      });
    } catch (logError) {
      console.error('Error logging email creation:', logError);
      // Don't fail the request if logging fails
    }

    // Step 6: Return success response with additional info
    res.json({
      success: true,
      message: 'Email account created successfully',
      email: emailAddress,
      quota: storage,
      webmailUrl: `https://${domain.toLowerCase()}/webmail`,
      smtpSettings: {
        server: `mail.${domain.toLowerCase()}`,
        // port: 587,
        // security: 'STARTTLS'
      },
      imapSettings: {
        server: `mail.${domain.toLowerCase()}`,
        // port: 993,
        // security: 'SSL/TLS'
      },
      domainSetup: {
        domain: domain.toLowerCase(),
        domainStatus: domainCheck.message,
        subdomain: domain,
        directory: `public_html/${domain}`,
        note: domainCheck.message === "Domain already exists in cPanel" ?
          'Domain was already available in cPanel' :
          'Domain successfully added to cPanel'
      },
      data: emailResult.data,
      databaseRecord: {
        saved: !!updatedDomain,
        domainId: updatedDomain?._id,
        emailAccountsCount: updatedDomain?.emailAccounts?.length || 0
      },
    });
  } catch (err) {
    console.error('Email creation failed:', err.message);

    // Log failed email creation
    try {
      // Log to file system (existing functionality)
      fileLogger.logEmailCreation({
        userId: userId,
        userEmail: `${username.toLowerCase()}@${domain.toLowerCase()}`,
        emailAddress: `${username.toLowerCase()}@${domain.toLowerCase()}`,
        username: username.toLowerCase(),
        domain: domain.toLowerCase(),
        quota: storage,
        storageUsed: 0,
        suspended: false,
        status: 'failed',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        apiEndpoint: '/cpanel/create-email',
        requestMethod: 'POST',
        errorDetails: {
          errorMessage: err.message,
          errorCode: err.response?.status || 'EMAIL_CREATION_FAILED',
          errorStack: err.stack
        },
        metadata: {
          domain: domain.toLowerCase(),
          username: username.toLowerCase(),
          quota: storage
        }
      });

      // Log to Slack via webhook (new functionality)
      await slackLogger.logEmailCreation({
        id: Date.now().toString(),
        status: 'failed',
        emailAddress: `${username.toLowerCase()}@${domain.toLowerCase()}`,
        username: username.toLowerCase(),
        domain: domain.toLowerCase(),
        quota: storage,
        storageUsed: 0,
        suspended: false,
        userId: userId,
        userEmail: `${username.toLowerCase()}@${domain.toLowerCase()}`,
        ipAddress: req.ip,
        endpoint: '/cpanel/create-email',
        method: 'POST',
        metadata: {
          domain: domain.toLowerCase(),
          username: username.toLowerCase(),
          quota: storage,
          provider: 'cPanel',
          operation: 'email_creation',
          error: err.message,
          errorCode: err.response?.status || 'EMAIL_CREATION_FAILED'
        }
      });
    } catch (logError) {
      console.error('Error logging failed email creation:', logError);
    }

    res.status(500).json({
      success: false,
      error: err.message,
      details: err.response?.data || null
    });
  }
});

// Route: List all email accounts for a domain (REAL-TIME from cPanel)
// This API fetches live storage usage and email data directly from cPanel servers
router.get('/cpanel/list-emails/:userId/:domain', async (req, res) => {
  const { userId, domain } = req.params;

  if (!userId || !domain) {
    return res.status(400).json({
      success: false,
      error: 'userId and domain are required.'
    });
  }

  try {
    const fetchStartTime = new Date();

    // Verify user owns domain
    const domainOwnership = await userOwnsDomain(userId, domain);
    if (!domainOwnership) {
      return res.status(403).json({
        success: false,
        error: 'Domain not registered to user or domain is not active.'
      });
    }

    // Get email accounts with disk info
    const emailResult = await cpanelRequest('Email/list_pops_with_disk', {
      domain: domain.toLowerCase()
    });

    if (emailResult.status !== 1) {
      throw new Error(emailResult.errors?.[0] || 'Failed to fetch email accounts');
    }

    // Debug: Log the raw email result for this domain
    console.log(`Raw email result for domain ${domain}:`, JSON.stringify(emailResult.data, null, 2));

    // Filter emails to only include those for the requested domain
    const domainEmails = emailResult.data.filter(email =>
      email.domain && email.domain.toLowerCase() === domain.toLowerCase()
    );

    console.log(`Found ${domainEmails.length} email accounts for domain ${domain} out of ${emailResult.data.length} total accounts`);

    // Get detailed email information including creation dates
    let emailDetails = {};
    try {
      // Try different approaches to get email details
      const detailsResult = await cpanelRequest('Email/list_pops', {
        domain: domain.toLowerCase()
      });

      console.log(`Detailed email info for ${domain}:`, detailsResult);

      if (detailsResult.status === 1 && detailsResult.data) {
        detailsResult.data.forEach(email => {
          emailDetails[email.email] = {
            created: email.created,
            last_login: email.last_login,
            message_count: email.message_count,
            // Include all available fields for debugging
            all_fields: email
          };
        });
      }
    } catch (detailsError) {
      console.log(`Could not get detailed email info for domain ${domain}:`, detailsError.message);

      // Try alternative approach - get individual email details
      try {
        console.log(`Trying individual email details for ${domain}...`);
        for (const email of domainEmails) {
          const individualResult = await cpanelRequest('Email/get_pop_quota', {
            user: email.user,
            domain: email.domain
          });

          if (individualResult.status === 1) {
            emailDetails[email.email] = {
              quota_info: individualResult.data,
              // Try to extract creation info from quota data
              created: individualResult.data?.created || null,
              last_login: individualResult.data?.last_login || null,
              message_count: individualResult.data?.message_count || 0
            };
          }
        }
      } catch (individualError) {
        console.log(`Could not get individual email details for ${domain}:`, individualError.message);
      }
    }

    // Get disk usage for filtered emails only - Use data from list_pops_with_disk which already has storage info
    // This is more efficient as it avoids additional API calls and uses real-time data from cPanel
    const emailsWithDetails = domainEmails.map((email) => {
      // The list_pops_with_disk already provides disk usage data
      // Use the data directly from the email object instead of making additional API calls
      const diskUsedBytes = parseInt(email._diskused) || 0;
      const diskQuotaBytes = parseInt(email._diskquota) || 0;
      const diskUsedPercent = parseFloat(email.diskusedpercent_float) || 0;

      // Get creation date from detailed email info or fallback to mtime
      let creationDate = null;
      let lastLogin = null;
      let messageCount = 0;
      let createdField = null;

      // Try to get detailed info first
      if (emailDetails[email.email]) {
        const details = emailDetails[email.email];
        if (details.created) {
          try {
            creationDate = new Date(details.created).toISOString();
            createdField = details.created;
          } catch (e) {
            console.log(`Could not parse created date for ${email.email}:`, details.created);
          }
        }
        lastLogin = details.last_login;
        messageCount = details.message_count || 0;
      }

      // Fallback to mtime if no creation date found (this is what we actually have)
      if (!creationDate && email.mtime) {
        try {
          creationDate = new Date(email.mtime * 1000).toISOString();
          createdField = `Unix timestamp: ${email.mtime}`;
        } catch (e) {
          console.log(`Could not parse mtime for ${email.email}:`, email.mtime);
        }
      }

      // If still no creation date, use current time as fallback
      if (!creationDate) {
        creationDate = new Date().toISOString();
        createdField = 'Unknown (using current time)';
      }

      const emailData = {
        username: email.user,
        email: email.email,
        domain: email.domain,
        suspended: email.suspended === '1',
        created: createdField, // Raw creation date field
        creationDate: creationDate, // Parsed creation date
        lastLogin: lastLogin,
        messageCount: messageCount,
        quota: {
          limit: email.diskquota === 'unlimited' ? -1 : parseInt(email.diskquota),
          formatted: email.diskquota === 'unlimited' ? 'Unlimited' : `${parseInt(email.diskquota)} MB`,
          isUnlimited: email.diskquota === 'unlimited',
          bytes: diskQuotaBytes
        },
        usage: {
          bytes: diskUsedBytes,
          percentage: diskUsedPercent * 100, // Convert to percentage
          formatted: email.humandiskused || '0 MB',
          raw: {
            diskused: email.diskused,
            diskusedpercent: email.diskusedpercent,
            diskusedpercent_float: email.diskusedpercent_float,
            _diskused: email._diskused,
            _diskquota: email._diskquota
          }
        },
        lastUpdated: new Date().toISOString(), // Timestamp when this data was fetched
        mtime: email.mtime ? new Date(email.mtime * 1000).toISOString() : null, // Convert Unix timestamp
        // Additional info from cPanel response
        login: email.login,
        suspended_incoming: email.suspended_incoming === '1',
        suspended_login: email.suspended_login === '1'
      };

      // Debug: Log storage data for this email
      console.log(`Email data for ${email.email}:`, {
        diskUsedBytes,
        diskQuotaBytes,
        diskUsedPercent,
        humanReadable: email.humandiskused,
        formatted: emailData.usage.formatted,
        created: emailData.created,
        creationDate: emailData.creationDate,
        lastLogin: emailData.lastLogin,
        messageCount: emailData.messageCount,
        mtime: email.mtime,
        emailDetails: emailDetails[email.email] ? 'Available' : 'Not available'
      });

      return emailData;
    });

    // Calculate domain-wide statistics
    const domainStats = {
      totalAccounts: emailsWithDetails.length,
      totalUsed: emailsWithDetails.reduce((sum, email) => sum + email.usage.bytes, 0),
      totalQuota: emailsWithDetails.reduce((sum, email) =>
        email.quota.isUnlimited ? -1 : sum + email.quota.limit, 0)
    };

    const fetchEndTime = new Date();
    const fetchDuration = fetchEndTime - fetchStartTime;

    res.json({
      success: true,
      domain: domain.toLowerCase(),
      emails: emailsWithDetails,
      webmailUrl: `https://${domain}:2096/`,
      count: emailsWithDetails.length,
      stats: {
        ...domainStats,
        usagePercentage: domainStats.totalQuota === -1 ? 0 :
          Math.round((domainStats.totalUsed / domainStats.totalQuota) * 100),
        formattedUsage: formatStorage(domainStats.totalUsed),
        formattedQuota: domainStats.totalQuota === -1 ? 'Unlimited' :
          formatStorage(domainStats.totalQuota)
      },
      metadata: {
        dataSource: 'cPanel Real-time API',
        fetchTimestamp: fetchEndTime.toISOString(),
        fetchDurationMs: fetchDuration,
        totalApiCalls: 2, // list_pops_with_disk + list_pops
        realTimeData: true,
        storageDataFrom: 'list_pops_with_disk (included in response)',
        creationDataFrom: 'list_pops (detailed email info) + mtime fallback',
        performance: 'Optimized (no additional API calls per email)',
        note: 'Creation date uses mtime (last modified) as cPanel API may not provide exact creation date'
      }
    });

  } catch (err) {
    console.error('Full error stack:', err.stack);
    console.error('Failed to list emails:', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Helper function to format storage
function formatStorage(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`;
}

// Route: Get domain email statistics
router.get('/cpanel/email-stats/:userId/:domain', async (req, res) => {
  const { userId, domain } = req.params;

  if (!userId || !domain) {
    return res.status(400).json({
      success: false,
      error: 'userId and domain are required.'
    });
  }

  try {
    // Verify user owns domain
    const domainOwnership = await userOwnsDomain(userId, domain);
    if (!domainOwnership) {
      return res.status(403).json({
        success: false,
        error: 'Domain not registered to user or domain is not active.'
      });
    }

    // Get domain info from database
    const domainRecord = await NamecheapDomain.findOne({
      userId,
      domain: domain.toLowerCase()
    });

    // Get email accounts from cPanel
    const emailResult = await cpanelRequest('Email/list_pops', {
      domain: domain.toLowerCase()
    });

    const emailAccounts = emailResult.status === 1 ? emailResult.data || [] : [];

    // Calculate statistics
    const totalQuota = emailAccounts.reduce((sum, email) => sum + (parseInt(email.quota) || 0), 0);
    const usedQuota = emailAccounts.reduce((sum, email) => sum + (parseInt(email.usage) || 0), 0);

    res.json({
      success: true,
      domain: domain.toLowerCase(),
      statistics: {
        totalEmailAccounts: emailAccounts.length,
        totalQuotaMB: totalQuota,
        usedQuotaMB: usedQuota,
        availableQuotaMB: totalQuota - usedQuota,
        usagePercentage: totalQuota > 0 ? Math.round((usedQuota / totalQuota) * 100) : 0
      },
      emailAccounts: emailAccounts.map(email => ({
        username: email.user,
        email: email.email,
        quota: parseInt(email.quota) || 0,
        usage: parseInt(email.usage) || 0,
        suspended: email.suspended === '1'
      }))
    });
  } catch (err) {
    console.error('Failed to get email statistics:', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Test route to check if email account exists
router.get('/cpanel/check-email/:userId/:domain/:username', async (req, res) => {
  const { userId, domain, username } = req.params;

  if (!userId || !domain || !username) {
    return res.status(400).json({
      success: false,
      error: 'userId, domain, and username are required.'
    });
  }

  try {
    // Verify user owns domain
    const domainOwnership = await userOwnsDomain(userId, domain);
    if (!domainOwnership) {
      return res.status(403).json({
        success: false,
        error: 'Domain not registered to user or domain is not active.'
      });
    }

    // Get email accounts with disk info
    const emailResult = await cpanelRequest('Email/list_pops_with_disk', {
      domain: domain.toLowerCase()
    });

    if (emailResult.status !== 1) {
      throw new Error(emailResult.errors?.[0] || 'Failed to fetch email accounts');
    }

    // Filter emails to only include those for the requested domain
    const domainEmails = emailResult.data.filter(email =>
      email.domain && email.domain.toLowerCase() === domain.toLowerCase()
    );

    console.log(`Found ${domainEmails.length} email accounts for domain ${domain} out of ${emailResult.data.length} total accounts`);

    // Get disk usage for filtered emails only
    const allEmailsWithUsage = await Promise.all(
      domainEmails.map(async email => {
        const usageResult = await cpanelRequest('Email/get_disk_usage', {
          email: email.email
        });

        return {
          username: email.user,
          email: email.email,
          quota: email.diskquota,
          quotaBytes: email.diskquota === 'unlimited' ? -1 : parseInt(email.diskquota),
          usedBytes: usageResult.status === 1 ? usageResult.data.used_bytes : 0,
          usedPercentage: usageResult.status === 1 ? usageResult.data.usage_percentage : 0,
          formattedUsage: usageResult.status === 1 ? usageResult.data.human_readable : '0 MB',
          suspended: email.suspended === '1',
          created: email.created
        };
      })
    );

    // Find the specific email account
    const targetEmail = `${username.toLowerCase()}@${domain.toLowerCase()}`;
    const emailDetails = allEmailsWithUsage.find(email =>
      email.email === targetEmail || email.username === username.toLowerCase()
    );

    res.json({
      success: true,
      emailExists: !!emailDetails,
      email: targetEmail,
      details: emailDetails || null,
      allEmails: allEmailsWithUsage,
      message: emailDetails ? 'Email account found' : 'Email account not found',
      domainInfo: {
        totalAccounts: allEmailsWithUsage.length,
        totalUsed: allEmailsWithUsage.reduce((sum, email) => sum + email.usedBytes, 0),
        domain: domain.toLowerCase(),
        requestedDomain: domain.toLowerCase(),
        filteredFromTotal: emailResult.data.length
      }
    });
  } catch (err) {
    console.error('Failed to check email:', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

//_______________Email Delete api______________

// Route: Delete Email Account
router.delete('/cpanel/delete-email', async (req, res) => {
  const { userId, email, domain, flags, skip_quota = 0 } = req.body;

  // Input validation
  if (!userId || !email) {
    return res.status(400).json({
      success: false,
      error: 'userId and email are required.'
    });
  }

  // Validate email format
  let emailUsername, emailDomain;
  if (email.includes('@')) {
    // Full email address provided
    const emailParts = email.split('@');
    if (emailParts.length !== 2) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format.'
      });
    }
    emailUsername = emailParts[0];
    emailDomain = emailParts[1];
  } else {
    // Only username provided, use domain from request
    if (!domain) {
      return res.status(400).json({
        success: false,
        error: 'Domain is required when providing only email username.'
      });
    }
    emailUsername = email;
    emailDomain = domain;
  }

  // Validate domain if provided separately
  if (domain && !isValidDomain(domain)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid domain format.'
    });
  }

  // Validate email username
  if (!isValidEmailUser(emailUsername)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid email username format.'
    });
  }

  // Validate skip_quota parameter
  if (skip_quota !== 0 && skip_quota !== 1) {
    return res.status(400).json({
      success: false,
      error: 'skip_quota must be 0 or 1.'
    });
  }

  try {
    // Step 1: Verify user owns domain
    const domainOwnership = await userOwnsDomain(userId, emailDomain);
    if (!domainOwnership) {
      return res.status(403).json({
        success: false,
        error: 'Domain not registered to user or domain is not active.'
      });
    }

    // Step 2: Check if email account exists
    const emailAddress = `${emailUsername.toLowerCase()}@${emailDomain.toLowerCase()}`;
    const checkResult = await cpanelRequest('Email/list_pops', {
      domain: emailDomain.toLowerCase()
    });

    if (checkResult.status !== 1) {
      throw new Error(checkResult.errors?.[0] || 'Failed to fetch email accounts');
    }

    const emailExists = checkResult.data?.some(account =>
      account.email === emailAddress || account.user === emailUsername.toLowerCase()
    );

    if (!emailExists) {
      return res.status(404).json({
        success: false,
        error: 'Email account not found.'
      });
    }

    // Step 3: Delete email account
    const deleteParams = {
      email: emailAddress,
      skip_quota: skip_quota
    };

    // Add flags parameter if provided
    if (flags) {
      deleteParams.flags = flags;
    }

    console.log('Deleting email with params:', { ...deleteParams, email: emailAddress });

    const deleteResult = await cpanelRequest('Email/delete_pop', deleteParams, 'POST');

    console.log('Email deletion result:', deleteResult);

    if (deleteResult.status !== 1) {
      const errorMsg = (deleteResult.errors && deleteResult.errors[0]) || 'Unknown error from cPanel';
      throw new Error(errorMsg);
    }

    // Step 4: Remove email account from database
    const updatedDomain = await NamecheapDomain.findOneAndUpdate(
      {
        userId,
        domain: emailDomain.toLowerCase(),
        'emailAccounts.email': emailAddress
      },
      {
        $pull: {
          emailAccounts: { email: emailAddress }
        },
        $set: {
          updatedAt: new Date()
        }
      },
      { new: true }
    );

    // Step 5: Log email deletion to Slack
    try {
      await slackLogger.log({
        id: Date.now().toString(),
        operation: 'email_deletion',
        emailAddress: emailAddress,
        domain: emailDomain.toLowerCase(),
        status: 'completed',
        userId: userId,
        userEmail: emailAddress,
        ipAddress: req.ip,
        endpoint: '/cpanel/delete-email',
        method: 'DELETE',
        metadata: {
          domainId: updatedDomain?._id,
          remainingEmailAccounts: updatedDomain?.emailAccounts?.length || 0,
          preserveDirectory: flags === 'passwd',
          skipQuotaModification: skip_quota === 1,
          provider: 'cPanel',
          cpanelResponse: deleteResult.data
        }
      }, {
        service: 'domain',
        customTitle: `🗑️ Email Deleted: ${emailAddress}`,
        customIcon: ':wastebasket:'
      });
    } catch (logError) {
      console.error('Error logging email deletion to Slack:', logError);
      // Don't fail the request if Slack logging fails
    }

    // Step 6: Return success response
    res.json({
      success: true,
      message: 'Email account deleted successfully',
      deletedEmail: emailAddress,
      domain: emailDomain.toLowerCase(),
      data: deleteResult.data,
      databaseRecord: {
        removed: !!updatedDomain,
        domainId: updatedDomain?._id,
        remainingEmailAccounts: updatedDomain?.emailAccounts?.length || 0
      },
      deletionDetails: {
        preserveDirectory: flags === 'passwd',
        skipQuotaModification: skip_quota === 1,
        timestamp: new Date().toISOString()
      }
    });

  } catch (err) {
    console.error('Email deletion failed:', err.message);

    // Log email deletion failure to Slack
    try {
      await slackLogger.log({
        id: Date.now().toString(),
        operation: 'email_deletion',
        emailAddress: emailAddress || 'unknown',
        domain: emailDomain?.toLowerCase() || 'unknown',
        status: 'failed',
        userId: userId,
        userEmail: emailAddress || 'unknown',
        ipAddress: req.ip,
        endpoint: '/cpanel/delete-email',
        method: 'DELETE',
        metadata: {
          error: err.message,
          errorCode: err.response?.status || 'EMAIL_DELETION_FAILED',
          provider: 'cPanel',
          preserveDirectory: flags === 'passwd',
          skipQuotaModification: skip_quota === 1
        }
      }, {
        service: 'domain',
        customTitle: `❌ Email Deletion Failed: ${emailAddress || 'unknown'}`,
        customIcon: ':x:'
      });
    } catch (logError) {
      console.error('Error logging email deletion failure to Slack:', logError);
      // Don't fail the request if Slack logging fails
    }

    res.status(500).json({
      success: false,
      error: err.message,
      details: err.response?.data || null
    });
  }
});

//_____________fetch all email accounts for userID______________

// Route: Fetch all email accounts for a specific userID (REAL-TIME from cPanel)
// This API fetches live storage usage and email data directly from cPanel servers
router.get('/cpanel/user-all-emails/:userId', async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'userId is required.'
    });
  }

  try {
    // Step 1: Get all domains owned by this user
    const userDomains = await NamecheapDomain.find({
      userId: userId,
      'domainStatus.isActive': true
    });

    if (!userDomains || userDomains.length === 0) {
      return res.json({
        success: true,
        userId: userId,
        domains: [],
        totalEmails: 0,
        emails: [],
        stats: {
          totalAccounts: 0,
          totalUsed: 0,
          totalQuota: 0,
          usagePercentage: 0,
          formattedUsage: '0 B',
          formattedQuota: '0 B'
        },
        message: 'No active domains found for this user'
      });
    }

    console.log(`Found ${userDomains.length} domains for user ${userId}`);

    // Step 2: Fetch email accounts for all domains in parallel (REAL-TIME from cPanel)
    const allEmails = [];
    const domainStats = [];
    const fetchStartTime = new Date();

    // Process all domains in parallel for better performance
    const domainResults = await Promise.allSettled(
      userDomains.map(async (domainRecord) => {
        const domain = domainRecord.domain;

        try {
          // Get email accounts for this domain
          const emailResult = await cpanelRequest('Email/list_pops_with_disk', {
            domain: domain.toLowerCase()
          });

          console.log(`Raw cPanel response for ${domain}:`, JSON.stringify(emailResult, null, 2));

          if (emailResult.status === 1 && emailResult.data) {
            // Filter emails to only include those for this specific domain
            const domainEmails = emailResult.data.filter(email =>
              email.domain && email.domain.toLowerCase() === domain.toLowerCase()
            );

            console.log(`Found ${domainEmails.length} email accounts for domain ${domain} out of ${emailResult.data.length} total emails returned`);

            // Debug: Log all emails returned by cPanel for this domain
            if (emailResult.data.length > 0) {
              console.log(`All emails returned by cPanel for domain ${domain}:`,
                emailResult.data.map(e => ({ email: e.email, domain: e.domain })));
            }

            // Get detailed email information including creation dates using our improved helper
            let emailDetails = {};
            try {
              // Get detailed email info for last login and message count
              const detailsResult = await cpanelRequest('Email/list_pops', {
                domain: domain.toLowerCase()
              });

              console.log(`Detailed email info for ${domain}:`, detailsResult);

              if (detailsResult.status === 1 && detailsResult.data) {
                detailsResult.data.forEach(email => {
                  emailDetails[email.email] = {
                    last_login: email.last_login,
                    message_count: email.message_count,
                    // Include all available fields for debugging
                    all_fields: email
                  };
                });
              }
            } catch (detailsError) {
              console.log(`Could not get detailed email info for domain ${domain}:`, detailsError.message);
            }

            // Get disk usage for each email - Use data from list_pops_with_disk which already has storage info
            // This is more efficient as it avoids additional API calls and uses real-time data from cPanel
            const emailsWithDetails = await Promise.all(domainEmails.map(async (email) => {
              // The list_pops_with_disk already provides disk usage data
              // Use the data directly from the email object instead of making additional API calls
              const diskUsedBytes = parseInt(email._diskused) || 0;
              const diskQuotaBytes = parseInt(email._diskquota) || 0;
              const diskUsedPercent = parseFloat(email.diskusedpercent_float) || 0;

              // Get accurate creation date using our improved helper function
              const creationInfo = await getEmailCreationDate(email.email, domain, userId);

              // Get last login and message count from detailed email info
              let lastLogin = null;
              let messageCount = 0;

              if (emailDetails[email.email]) {
                const details = emailDetails[email.email];
                lastLogin = details.last_login;
                messageCount = details.message_count || 0;
              }

              const emailData = {
                username: email.user,
                email: email.email,
                domain: email.domain,
                suspended: email.suspended === '1',
                created: creationInfo.rawValue || creationInfo.creationDate, // Raw creation date field
                creationDate: creationInfo.creationDate, // Parsed creation date
                creationInfo: {
                  source: creationInfo.source,
                  accuracy: creationInfo.accuracy,
                  note: creationInfo.note || null,
                  error: creationInfo.error || null
                },
                lastLogin: lastLogin,
                messageCount: messageCount,
                quota: {
                  limit: email.diskquota === 'unlimited' ? -1 : parseInt(email.diskquota),
                  formatted: email.diskquota === 'unlimited' ? 'Unlimited' : `${parseInt(email.diskquota)} MB`,
                  isUnlimited: email.diskquota === 'unlimited',
                  bytes: diskQuotaBytes
                },
                usage: {
                  bytes: diskUsedBytes,
                  percentage: diskUsedPercent * 100, // Convert to percentage
                  formatted: email.humandiskused || '0 MB',
                  raw: {
                    diskused: email.diskused,
                    diskusedpercent: email.diskusedpercent,
                    diskusedpercent_float: email.diskusedpercent_float,
                    _diskused: email._diskused,
                    _diskquota: email._diskquota
                  }
                },
                lastUpdated: new Date().toISOString(), // Timestamp when this data was fetched
                mtime: email.mtime ? new Date(email.mtime * 1000).toISOString() : null, // Convert Unix timestamp
                // Additional info from cPanel response
                login: email.login,
                suspended_incoming: email.suspended_incoming === '1',
                suspended_login: email.suspended_login === '1'
              };

              // Debug: Log storage data for this email
              console.log(`Email data for ${email.email}:`, {
                diskUsedBytes,
                diskQuotaBytes,
                diskUsedPercent,
                humanReadable: email.humandiskused,
                formatted: emailData.usage.formatted,
                created: emailData.created,
                creationDate: emailData.creationDate,
                creationSource: creationInfo.source,
                creationAccuracy: creationInfo.accuracy,
                lastLogin: emailData.lastLogin,
                messageCount: emailData.messageCount,
                mtime: email.mtime,
                emailDetails: emailDetails[email.email] ? 'Available' : 'Not available'
              });

              return emailData;
            }));

            // Calculate domain statistics
            const domainTotalUsed = emailsWithDetails.reduce((sum, email) => sum + email.usage.bytes, 0);
            const domainTotalQuota = emailsWithDetails.reduce((sum, email) =>
              email.quota.isUnlimited ? -1 : sum + email.quota.limit, 0);

            const domainStat = {
              domain: domain,
              emailCount: emailsWithDetails.length,
              totalUsed: domainTotalUsed,
              totalQuota: domainTotalQuota,
              usagePercentage: domainTotalQuota === -1 ? 0 :
                Math.round((domainTotalUsed / domainTotalQuota) * 100),
              formattedUsage: formatStorage(domainTotalUsed),
              formattedQuota: domainTotalQuota === -1 ? 'Unlimited' :
                formatStorage(domainTotalQuota)
            };

            // Add domain info to each email
            const emailsWithDomainInfo = emailsWithDetails.map(email => ({
              ...email,
              domainInfo: {
                domainId: domainRecord._id,
                domainStatus: domainRecord.domainStatus,
                registrationDate: domainRecord.registrationDate,
                expiryDate: domainRecord.expiryDate
              }
            }));

            return {
              success: true,
              domainStat,
              emails: emailsWithDomainInfo
            };
          } else {
            return {
              success: false,
              domainStat: {
                domain: domain,
                emailCount: 0,
                error: 'No email data returned from cPanel',
                totalUsed: 0,
                totalQuota: 0,
                usagePercentage: 0,
                formattedUsage: '0 B',
                formattedQuota: '0 B'
              },
              emails: []
            };
          }
        } catch (domainError) {
          console.error(`Error fetching emails for domain ${domain}:`, domainError.message);
          return {
            success: false,
            domainStat: {
              domain: domain,
              emailCount: 0,
              error: domainError.message,
              totalUsed: 0,
              totalQuota: 0,
              usagePercentage: 0,
              formattedUsage: '0 B',
              formattedQuota: '0 B'
            },
            emails: []
          };
        }
      })
    );

    // Process results
    domainResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const { domainStat, emails } = result.value;
        domainStats.push(domainStat);
        allEmails.push(...emails);
      } else {
        // Handle rejected promises
        const domain = userDomains[index]?.domain || 'unknown';
        console.error(`Domain ${domain} failed:`, result.reason);
        domainStats.push({
          domain: domain,
          emailCount: 0,
          error: result.reason?.message || 'Unknown error',
          totalUsed: 0,
          totalQuota: 0,
          usagePercentage: 0,
          formattedUsage: '0 B',
          formattedQuota: '0 B'
        });
      }
    });

    // Step 3: Calculate overall statistics
    const overallStats = {
      totalAccounts: allEmails.length,
      totalUsed: allEmails.reduce((sum, email) => sum + email.usage.bytes, 0),
      totalQuota: allEmails.reduce((sum, email) =>
        email.quota.isUnlimited ? -1 : sum + email.quota.limit, 0)
    };

    // Step 4: Group emails by domain
    const emailsByDomain = {};

    allEmails.forEach(email => {
      const domain = email.domain;
      if (!emailsByDomain[domain]) {
        emailsByDomain[domain] = {
          domain: domain,
          webmailUrl: `https://${domain}:2096/`,
          emails: [],
          stats: {
            totalAccounts: 0,
            totalUsed: 0,
            totalQuota: 0,
            usagePercentage: 0,
            formattedUsage: '0 B',
            formattedQuota: '0 B'
          }
        };
      }

      emailsByDomain[domain].emails.push({
        username: email.username,
        email: email.email,
        suspended: email.suspended,
        created: email.created,
        quota: email.quota,
        usage: email.usage,
        servers: email.servers,
        domainInfo: email.domainInfo
      });
    });

    // Calculate stats for each domain
    Object.keys(emailsByDomain).forEach(domain => {
      const domainEmails = emailsByDomain[domain].emails;
      const totalUsed = domainEmails.reduce((sum, email) => sum + email.usage.bytes, 0);
      const totalQuota = domainEmails.reduce((sum, email) =>
        email.quota.isUnlimited ? -1 : sum + email.quota.limit, 0);

      emailsByDomain[domain].stats = {
        totalAccounts: domainEmails.length,
        totalUsed: totalUsed,
        totalQuota: totalQuota,
        usagePercentage: totalQuota === -1 ? 0 :
          Math.round((totalUsed / totalQuota) * 100),
        formattedUsage: formatStorage(totalUsed),
        formattedQuota: totalQuota === -1 ? 'Unlimited' :
          formatStorage(totalQuota)
      };
    });

    // Step 5: Create domains list with all user domains
    const allDomainsList = userDomains.map(domainRecord => {
      const hasEmails = Object.keys(emailsByDomain).includes(domainRecord.domain);
      const emailCount = emailsByDomain[domainRecord.domain]?.emails?.length || 0;

      const domainObj = {
        domain: domainRecord.domain,
        hasEmails: hasEmails,
        emailCount: emailCount,
        domainInfo: {
          domainId: domainRecord._id,
          domainStatus: domainRecord.domainStatus,
          registrationDate: domainRecord.registrationDate,
          expiryDate: domainRecord.expiryDate
        }
      };

      // Only add webmailUrl if domain has emails
      if (hasEmails && emailCount > 0) {
        domainObj.webmailUrl = `https://${domainRecord.domain}:2096/`;
      }

      return domainObj;
    });

    // Step 6: Return response with new structure
    const fetchEndTime = new Date();
    const fetchDuration = fetchEndTime - fetchStartTime;

    res.json({
      success: true,
      userId: userId,
      totalDomains: userDomains.length,
      totalEmails: allEmails.length,
      domains: allDomainsList,
      domainsWithEmails: emailsByDomain,
      overallStats: {
        ...overallStats,
        usagePercentage: overallStats.totalQuota === -1 ? 0 :
          Math.round((overallStats.totalUsed / overallStats.totalQuota) * 100),
        formattedUsage: formatStorage(overallStats.totalUsed),
        formattedQuota: overallStats.totalQuota === -1 ? 'Unlimited' :
          formatStorage(overallStats.totalQuota)
      },
      summary: {
        totalDomains: userDomains.length,
        domainsWithEmails: Object.keys(emailsByDomain).length,
        domainsWithErrors: domainStats.filter(d => d.error).length,
        suspendedEmails: allEmails.filter(email => email.suspended).length,
        activeEmails: allEmails.filter(email => !email.suspended).length
      },
      metadata: {
        dataSource: 'cPanel Real-time API + Database',
        fetchTimestamp: fetchEndTime.toISOString(),
        fetchDurationMs: fetchDuration,
        domainsProcessed: userDomains.length,
        totalApiCalls: userDomains.length * 2, // list_pops_with_disk + list_pops per domain
        realTimeData: true,
        storageDataFrom: 'list_pops_with_disk (included in response)',
        creationDataFrom: 'Multi-source: Database (high accuracy) > cPanel API > WHM API > Fallback',
        performance: 'Parallel processing enabled',
        optimization: 'Minimal API calls (2 per domain for complete data)',
        creationDateAccuracy: 'Improved with multi-source approach',
        note: 'Creation dates now use database records for emails we created, with fallbacks to cPanel/WHM APIs'
      }
    });

  } catch (err) {
    console.error('Failed to fetch user emails:', err.message);
    console.error('Full error stack:', err.stack);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

//_____________send email API______________

// Route: Send Email using cPanel UAPI
router.post('/cpanel/send-email', async (req, res) => {
  const {
    userId,
    domain,
    fromEmail,
    toEmail,
    subject,
    message,
    isHtml = false,
    replyTo = null,
    cc = null,
    bcc = null,
    attachments = null
  } = req.body;

  // Input validation
  if (!userId || !domain || !fromEmail || !toEmail || !subject || !message) {
    return res.status(400).json({
      success: false,
      error: 'userId, domain, fromEmail, toEmail, subject, and message are required.'
    });
  }

  if (!isValidDomain(domain)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid domain format.'
    });
  }

  // Validate email formats
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(fromEmail) || !emailRegex.test(toEmail)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid email format for fromEmail or toEmail.'
    });
  }

  // Validate that fromEmail belongs to the specified domain
  const fromDomain = fromEmail.split('@')[1];
  if (fromDomain.toLowerCase() !== domain.toLowerCase()) {
    return res.status(400).json({
      success: false,
      error: 'fromEmail must belong to the specified domain.'
    });
  }

  // Validate subject length
  if (subject.length > 998) {
    return res.status(400).json({
      success: false,
      error: 'Subject line is too long. Maximum length is 998 characters.'
    });
  }

  // Validate message length
  if (message.length > 26214400) { // 25MB limit
    return res.status(400).json({
      success: false,
      error: 'Message is too long. Maximum size is 25MB.'
    });
  }

  // Validate CC and BCC if provided
  if (cc && !Array.isArray(cc)) {
    return res.status(400).json({
      success: false,
      error: 'cc must be an array of email addresses.'
    });
  }

  if (bcc && !Array.isArray(bcc)) {
    return res.status(400).json({
      success: false,
      error: 'bcc must be an array of email addresses.'
    });
  }

  // Validate email addresses in CC and BCC
  if (cc) {
    for (const email of cc) {
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          error: `Invalid email format in cc: ${email}`
        });
      }
    }
  }

  if (bcc) {
    for (const email of bcc) {
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          error: `Invalid email format in bcc: ${email}`
        });
      }
    }
  }

  try {
    // Step 1: Verify user owns domain
    const domainOwnership = await userOwnsDomain(userId, domain);
    if (!domainOwnership) {
      return res.status(403).json({
        success: false,
        error: 'Domain not registered to user or domain is not active.'
      });
    }

    // Step 2: Verify that the fromEmail exists as an email account
    const emailCheckResult = await cpanelRequest('Email/list_pops', {
      domain: domain.toLowerCase()
    });

    if (emailCheckResult.status !== 1) {
      throw new Error(emailCheckResult.errors?.[0] || 'Failed to fetch email accounts');
    }

    const emailExists = emailCheckResult.data?.some(account =>
      account.email === fromEmail.toLowerCase()
    );

    if (!emailExists) {
      return res.status(404).json({
        success: false,
        error: 'From email account does not exist on this domain.'
      });
    }

    // Step 3: Prepare email parameters
    const emailParams = {
      from: fromEmail.toLowerCase(),
      to: toEmail.toLowerCase(),
      subject: subject,
      message: message,
      html: isHtml ? '1' : '0'
    };

    // Add optional parameters
    if (replyTo) {
      emailParams.replyto = replyTo.toLowerCase();
    }

    if (cc && cc.length > 0) {
      emailParams.cc = cc.join(',').toLowerCase();
    }

    if (bcc && bcc.length > 0) {
      emailParams.bcc = bcc.join(',').toLowerCase();
    }

    // Step 4: Send email using cPanel UAPI
    console.log('Sending email with params:', {
      ...emailParams,
      message: message.length > 100 ? `${message.substring(0, 100)}...` : message
    });

    const sendResult = await cpanelRequest('Email/send_email', emailParams, 'POST');

    console.log('Email send result:', sendResult);

    if (sendResult.status !== 1) {
      const errorMsg = (sendResult.errors && sendResult.errors[0]) || 'Unknown error from cPanel';
      throw new Error(errorMsg);
    }

    // Step 5: Return success response
    res.json({
      success: true,
      message: 'Email sent successfully',
      emailDetails: {
        from: fromEmail.toLowerCase(),
        to: toEmail.toLowerCase(),
        subject: subject,
        messageLength: message.length,
        isHtml: isHtml,
        replyTo: replyTo,
        cc: cc,
        bcc: bcc,
        timestamp: new Date().toISOString()
      },
      cpanelResponse: sendResult.data,
      domain: domain.toLowerCase()
    });

  } catch (err) {
    console.error('Email sending failed:', err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      details: err.response?.data || null
    });
  }
});

// Route: Get Email Sending Statistics
router.get('/cpanel/email-sending-stats/:userId/:domain', async (req, res) => {
  const { userId, domain } = req.params;

  if (!userId || !domain) {
    return res.status(400).json({
      success: false,
      error: 'userId and domain are required.'
    });
  }

  try {
    // Verify user owns domain
    const domainOwnership = await userOwnsDomain(userId, domain);
    if (!domainOwnership) {
      return res.status(403).json({
        success: false,
        error: 'Domain not registered to user or domain is not active.'
      });
    }

    // Get email accounts for the domain
    const emailResult = await cpanelRequest('Email/list_pops', {
      domain: domain.toLowerCase()
    });

    if (emailResult.status !== 1) {
      throw new Error(emailResult.errors?.[0] || 'Failed to fetch email accounts');
    }

    const emailAccounts = emailResult.data || [];

    // Get mail queue information (if available)
    let mailQueueInfo = null;
    try {
      const queueResult = await cpanelRequest('Email/get_mail_queue');
      if (queueResult.status === 1) {
        mailQueueInfo = {
          queueSize: queueResult.data?.length || 0,
          queuedEmails: queueResult.data || []
        };
      }
    } catch (queueError) {
      console.log('Mail queue information not available:', queueError.message);
    }

    // Get email sending limits (if available)
    let sendingLimits = null;
    try {
      const limitsResult = await cpanelRequest('Email/get_sending_limits');
      if (limitsResult.status === 1) {
        sendingLimits = limitsResult.data;
      }
    } catch (limitsError) {
      console.log('Sending limits information not available:', limitsError.message);
    }

    res.json({
      success: true,
      domain: domain.toLowerCase(),
      emailAccounts: emailAccounts.map(email => ({
        username: email.user,
        email: email.email,
        suspended: email.suspended === '1'
      })),
      statistics: {
        totalEmailAccounts: emailAccounts.length,
        activeAccounts: emailAccounts.filter(email => email.suspended !== '1').length,
        suspendedAccounts: emailAccounts.filter(email => email.suspended === '1').length
      },
      mailQueue: mailQueueInfo,
      sendingLimits: sendingLimits,
      webmailUrl: `https://${domain.toLowerCase()}:2096/`,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('Failed to get email sending statistics:', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Helper function to get accurate email creation date
async function getEmailCreationDate(email, domain, userId) {
  try {
    // Method 1: Check our database first (most accurate for emails we created)
    const domainRecord = await NamecheapDomain.findOne({
      userId: userId,
      domain: domain.toLowerCase(),
      'emailAccounts.email': email.toLowerCase()
    });

    if (domainRecord) {
      const emailAccount = domainRecord.emailAccounts.find(
        acc => acc.email.toLowerCase() === email.toLowerCase()
      );
      if (emailAccount && emailAccount.createdAt) {
        return {
          creationDate: emailAccount.createdAt.toISOString(),
          source: 'database',
          accuracy: 'high'
        };
      }
    }

    // Method 2: Try cPanel Email/get_pop_quota (sometimes has creation info)
    try {
      const quotaResult = await cpanelRequest('Email/get_pop_quota', {
        user: email.split('@')[0],
        domain: domain.toLowerCase()
      });

      if (quotaResult.status === 1 && quotaResult.data) {
        // Check for various possible creation date fields
        const possibleDateFields = ['created', 'creation_date', 'date_created', 'created_date'];
        for (const field of possibleDateFields) {
          if (quotaResult.data[field]) {
            try {
              const parsedDate = new Date(quotaResult.data[field]);
              if (!isNaN(parsedDate.getTime())) {
                return {
                  creationDate: parsedDate.toISOString(),
                  source: `cpanel_quota_${field}`,
                  accuracy: 'medium',
                  rawValue: quotaResult.data[field]
                };
              }
            } catch (e) {
              // Continue to next field
            }
          }
        }
      }
    } catch (quotaError) {
      console.log(`Could not get quota info for ${email}:`, quotaError.message);
    }

    // Method 3: Try cPanel Email/list_pops with detailed info
    try {
      const listResult = await cpanelRequest('Email/list_pops', {
        domain: domain.toLowerCase()
      });

      if (listResult.status === 1 && listResult.data) {
        const emailInfo = listResult.data.find(
          acc => acc.email.toLowerCase() === email.toLowerCase()
        );

        if (emailInfo && emailInfo.created) {
          try {
            const parsedDate = new Date(emailInfo.created);
            if (!isNaN(parsedDate.getTime())) {
              return {
                creationDate: parsedDate.toISOString(),
                source: 'cpanel_list_pops',
                accuracy: 'medium',
                rawValue: emailInfo.created
              };
            }
          } catch (e) {
            console.log(`Could not parse created date for ${email}:`, emailInfo.created);
          }
        }
      }
    } catch (listError) {
      console.log(`Could not get list_pops info for ${email}:`, listError.message);
    }

    // Method 4: Try WHM API for email details
    try {
      const whmResult = await whmRequest('list_pops', {
        domain: domain.toLowerCase()
      });

      if (whmResult.status === 1 && whmResult.data) {
        const emailInfo = whmResult.data.find(
          acc => acc.email.toLowerCase() === email.toLowerCase()
        );

        if (emailInfo && emailInfo.created) {
          try {
            const parsedDate = new Date(emailInfo.created);
            if (!isNaN(parsedDate.getTime())) {
              return {
                creationDate: parsedDate.toISOString(),
                source: 'whm_api',
                accuracy: 'medium',
                rawValue: emailInfo.created
              };
            }
          } catch (e) {
            console.log(`Could not parse WHM created date for ${email}:`, emailInfo.created);
          }
        }
      }
    } catch (whmError) {
      console.log(`Could not get WHM info for ${email}:`, whmError.message);
    }

    // Method 5: Check file system creation time (if available)
    try {
      const fsResult = await cpanelRequest('Fileman/get_file_info', {
        file: `/home/${MASTER_USER}/etc/valiases/${domain.toLowerCase()}`,
        dir: '/'
      });

      if (fsResult.status === 1 && fsResult.data) {
        // This is a fallback - not very accurate but better than nothing
        return {
          creationDate: new Date().toISOString(),
          source: 'fallback_current_time',
          accuracy: 'low',
          note: 'No creation date found, using current time as fallback'
        };
      }
    } catch (fsError) {
      // Ignore file system errors
    }

    // Final fallback
    return {
      creationDate: new Date().toISOString(),
      source: 'fallback_current_time',
      accuracy: 'low',
      note: 'No creation date information available from any source'
    };

  } catch (error) {
    console.error(`Error getting creation date for ${email}:`, error.message);
    return {
      creationDate: new Date().toISOString(),
      source: 'error_fallback',
      accuracy: 'low',
      error: error.message
    };
  }
}


//__________________Validate DMARC records___________

/**
 * Apply DMARC record to domain(s)
 * This endpoint applies DMARC records to specified domains using cPanel's apply_dmarc API
 * Based on the official cPanel API documentation
 */
router.get('/cpanel/apply-dmarc', async (req, res) => {
  try {
    const { policy, domain } = req.query;

    // Validate required parameters
    if (!policy) {
      return res.status(400).json({
        success: false,
        error: 'Policy parameter is required'
      });
    }

    if (!domain) {
      return res.status(400).json({
        success: false,
        error: 'Domain parameter is required.'
      });
    }

    // Handle array or string for policy and domain
    const policies = Array.isArray(policy) ? policy : [policy];
    const domains = Array.isArray(domain) ? domain : [domain];

    // Validate all policies have correct DMARC format
    for (const pol of policies) {
      if (!pol.includes('v=DMARC1')) {
        return res.status(400).json({
          success: false,
          error: `Invalid DMARC policy format: "${pol}". Must include v=DMARC1`
        });
      }
    }

    // If multiple policies, must have matching domains
    if (policies.length > 1 && policies.length !== domains.length) {
      return res.status(400).json({
        success: false,
        error: 'When using multiple policies, each policy must have a matching domain'
      });
    }

    // Prepare parameters for WHM API (not cPanel user API)
    const params = {
      'api.version': '1'
    };

    // Build parameters based on the API documentation
    if (policies.length > 1) {
      // Multiple policies with matching domains
      policies.forEach((pol, index) => {
        params[`policy-${index}`] = pol;
        params[`domain-${index}`] = domains[index];
      });
    } else {
      // Single policy
      params['policy'] = policies[0];
      params['domain'] = domains[0];
    }

    // Log the request
    console.log('Applying DMARC record with params:', params);

    // Use cPanel UAPI (same as email creation APIs) instead of WHM API
    // This approach works because it uses the master user credentials
    const result = await cpanelRequest('EmailAuth/apply_dmarc', params, 'POST');

    // Alternative: If you need to use WHM API, use the working whmRequest function
    // const result = await whmRequest('apply_dmarc', params);

    // Check if the operation was successful
    if (result.metadata && result.metadata.result === 1) {
      // Format successful response
      const response = {
        success: true,
        message: 'DMARC record applied successfully',
        data: result.data || {
          payload: domains.map((dom, index) => ({
            domain: dom,
            msg: `DMARC record applied: ${policies[index] || policies[0]}`,
            status: 1
          }))
        },
        metadata: result.metadata
      };

      console.log('DMARC record applied successfully:', response);
      return res.status(200).json(response);

    } else {
      // Handle failure
      const errorMsg = result.metadata?.reason || result.errors?.[0] || 'Unknown error';

      const errorResponse = {
        success: false,
        error: 'Failed to apply DMARC record',
        data: result.data || {
          payload: domains.map(dom => ({
            domain: dom,
            msg: `Failed to apply DMARC record: ${errorMsg}`,
            status: 0
          }))
        },
        metadata: result.metadata || {
          command: 'apply_dmarc',
          reason: errorMsg,
          result: 0,
          version: 1
        }
      };

      console.error('Failed to apply DMARC record:', errorResponse);
      return res.status(500).json(errorResponse);
    }

  } catch (error) {
    // console.error('Error applying DMARC record:', error);

    return res.status(500).json({
      success: false,
      error: 'Internal server error while applying DMARC record',
      details: error.message,
      metadata: {
        command: 'apply_dmarc',
        reason: error.message,
        result: 0,
        version: 1
      }
    });
  }
});


async function validateDMARCRecords(domain) {
  try {
    // Use WHM API to validate DMARC records
    const dmarcRecord = await whmRequest('validate_current_dmarcs', {
      domain: `domain=${domain}` // Note the format change
    });

    // Check response structure
    if (dmarcRecord.success && dmarcRecord.data) {
      // Find the DMARC record for this specific domain in the payload array
      const domainRecord = dmarcRecord.data.payload.find(record =>
        record.domain === domain
      );

      if (domainRecord) {
        // Check record state
        if (domainRecord.state === "VALID" && domainRecord.record.includes('v=DMARC1')) {
          return {
            isValid: true,
            record: domainRecord.record,
            domain: domain,
            message: 'Valid DMARC record found'
          };
        } else {
          return {
            isValid: false,
            record: domainRecord.record || null,
            domain: domain,
            message: domainRecord.error || 'DMARC record is invalid'
          };
        }
      } else {
        return {
          isValid: false,
          record: null,
          domain: domain,
          message: 'Domain not found in WHM response'
        };
      }
    } else {
      return {
        isValid: false,
        record: null,
        domain: domain,
        message: dmarcRecord.metadata?.reason || 'WHM API returned error or no data'
      };
    }
  } catch (error) {
    console.error(`Error validating DMARC records for ${domain}:`, error);

    // Handle specific error types
    let errorMessage = `Error validating DMARC record: ${error.message}`;
    let errorType = 'UNKNOWN_ERROR';

    if (error.response?.status === 404) {
      errorMessage = 'WHM API endpoint not found';
      errorType = 'ENDPOINT_NOT_FOUND';
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = 'Connection timeout to WHM server';
      errorType = 'CONNECTION_TIMEOUT';
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Connection refused by WHM server';
      errorType = 'CONNECTION_REFUSED';
    }

    return {
      isValid: false,
      record: null,
      domain: domain,
      message: errorMessage,
      error: error.message,
      errorType: errorType
    };
  }
}

/**
 * Validate DMARC records for domain(s)
 * This endpoint validates DMARC records for specified domains using WHM's validate_current_dmarcs API
 * Based on the official WHM API documentation
 */
router.get('/cpanel/validate-dmarc', async (req, res) => {
  try {
    const { domain } = req.query;

    // Validate domain parameter
    if (!domain) {
      return res.status(400).json({
        success: false,
        error: 'Domain parameter is required'
      });
    }

    // Validate domain format
    if (!isValidDomain(domain)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid domain format'
      });
    }

    const dmarcInfo = await validateDMARCRecords(domain);

    // Handle 404 specifically
    if (dmarcInfo.errorType === 'ENDPOINT_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'WHM API endpoint not found',
        details: dmarcInfo.message
      });
    }

    // Format response to match the API documentation structure
    const response = {
      success: true,
      message: 'DMARC validation completed',
      data: {
        payload: [
          {
            domain: domain,
            error: dmarcInfo.isValid ? "" : dmarcInfo.message,
            record: dmarcInfo.record || "",
            state: dmarcInfo.isValid ? "VALID" : "INVALID",
            subdomain: `_dmarc.${domain}`,
            suggested: dmarcInfo.isValid ? dmarcInfo.record : "v=DMARC1; p=none;"
          }
        ]
      },
      metadata: {
        command: "validate_current_dmarcs",
        reason: dmarcInfo.isValid ? "OK" : dmarcInfo.message || "Validation failed",
        result: dmarcInfo.isValid ? 1 : 0,
        version: 1
      }
    };

    // Log success
    console.log('DMARC validation completed:', {
      domain: domain,
      isValid: dmarcInfo.isValid,
      record: dmarcInfo.record,
      result: response
    });

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error validating DMARC record:', error);

    // Log error
    console.log('Error validating DMARC record:', {
      domain: req.query.domain,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });



    return res.status(500).json({
      success: false,
      error: 'Internal server error while validating DMARC record',
      details: error.message
    });
  }
});


//Update DNS zone record API



/**
 * Get DNS Zone Records (dumpzone)
 * This endpoint retrieves DNS zone records for a domain
 * Useful to get line numbers for editing records
 */
router.get('/cpanel/dns-zone/:userId/:domain', async (req, res) => {
  const { userId, domain } = req.params;

  if (!userId || !domain) {
    return res.status(400).json({
      success: false,
      error: 'userId and domain are required.'
    });
  }

  if (!isValidDomain(domain)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid domain format.'
    });
  }

  try {
    // Verify user owns domain
    const domainOwnership = await userOwnsDomain(userId, domain);
    if (!domainOwnership) {
      return res.status(403).json({
        success: false,
        error: 'Domain not registered to user or domain is not active.'
      });
    }

    // Get DNS zone records using dumpzone
    const result = await whmRequest('dumpzone', {
      domain: domain.toLowerCase()
    });

    if (result.metadata && result.metadata.result === 1) {
      return res.json({
        success: true,
        message: 'DNS zone records retrieved successfully',
        domain: domain.toLowerCase(),
        records: result.data,
        metadata: result.metadata
      });
    } else {
      const errorMsg = result.metadata?.reason || 'Unknown error from WHM API';
      
      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve DNS zone records',
        details: errorMsg
      });
    }

  } catch (err) {
    console.error('Failed to retrieve DNS zone:', err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      details: err.response?.data || null
    });
  }
});

/**
 * Smart Update or Add DNS Record (Upsert)
 * Automatically fetches line number for existing records
 * - Updates if exists
 * - Adds new if not found
 * Users don't need to know line numbers
 */
router.post('/cpanel/upsert-dns-record', async (req, res) => {
  const { 
    userId, 
    domain, 
    name, 
    ttl = 14400, 
    type = 'A',
    address, // For A records
    cname,   // For CNAME records
    exchange, // For MX records
    priority, // For MX records
    txtdata,  // For TXT records
    target    // For A6 records
  } = req.body;

  // Input validation
  if (!userId || !domain || !name) {
    return res.status(400).json({
      success: false,
      error: 'userId, domain, and name are required.'
    });
  }

  if (!isValidDomain(domain)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid domain format.'
    });
  }

  if (!Number.isInteger(ttl) || ttl < 1) {
    return res.status(400).json({
      success: false,
      error: 'TTL must be a positive integer (>= 1).'
    });
  }

  try {
    // Step 1: Verify user owns domain
    const domainOwnership = await userOwnsDomain(userId, domain);
    if (!domainOwnership) {
      return res.status(403).json({
        success: false,
        error: 'Domain not registered to user or domain is not active.'
      });
    }

    // Step 2: Get existing zone records using dumpzone
    const zone = await whmRequest('dumpzone', {
      domain: domain.toLowerCase()
    });

    if (!zone.metadata || zone.metadata.result !== 1) {
      throw new Error('Failed to retrieve DNS zone records');
    }

    const records = zone.data || [];

    // Normalize record names (remove trailing dots for comparison)
    const normalizeName = (n) => n ? n.replace(/\.$/, '').toLowerCase() : '';

    // Step 3: Try to find existing record (by name + type)
    const existing = records.find(
      (r) => {
        const recordName = normalizeName(r.name);
        const recordType = r.type ? r.type.toUpperCase() : '';
        const searchName = normalizeName(name);
        const searchType = type.toUpperCase();
        
        return recordName === searchName && recordType === searchType;
      }
    );

    console.log(`Found existing record:`, existing ? `Line ${existing.line}` : 'None');

    // Step 4: Build common params
    const params = {
      domain: domain.toLowerCase(),
      name: name.endsWith('.') ? name : name + '.',
      ttl: ttl,
      type: type.toUpperCase()
    };

    // Add type-specific values
    switch (type.toUpperCase()) {
      case 'A':
        if (!address) {
          return res.status(400).json({
            success: false,
            error: 'address is required for A records.'
          });
        }
        params.address = address;
        break;
      case 'AAAA':
        if (!address) {
          return res.status(400).json({
            success: false,
            error: 'address is required for AAAA records.'
          });
        }
        params.address = address;
        break;
      case 'CNAME':
        if (!cname) {
          return res.status(400).json({
            success: false,
            error: 'cname is required for CNAME records.'
          });
        }
        params.cname = cname;
        break;
      case 'MX':
        if (!exchange) {
          return res.status(400).json({
            success: false,
            error: 'exchange is required for MX records.'
          });
        }
        params.exchange = exchange;
        if (priority !== undefined) {
          params.priority = priority;
        }
        break;
      case 'PTR':
        if (!target) {
          return res.status(400).json({
            success: false,
            error: 'target (ptrdname) is required for PTR records.'
          });
        }
        params.ptrdname = target;
        break;
      case 'TXT':
        if (!txtdata) {
          return res.status(400).json({
            success: false,
            error: 'txtdata is required for TXT records.'
          });
        }
        params.txtdata = txtdata;
        break;
      case 'A6':
        if (!target) {
          return res.status(400).json({
            success: false,
            error: 'target is required for A6 records.'
          });
        }
        params.target = target;
        break;
      default:
        return res.status(400).json({
          success: false,
          error: `Unsupported DNS record type: ${type}`
        });
    }

    let result;
    let isUpdate = false;

    if (existing) {
      // Step 5A: Update existing record
      params.line = existing.line;
      console.log(`Updating ${type} record for ${name} (line ${existing.line}) with params:`, params);
      result = await whmRequest('editzonerecord', params);
      isUpdate = true;
    } else {
      // Step 5B: Add new record if none found
      console.log(`Adding new ${type} record for ${name} with params:`, params);
      result = await whmRequest('addzonerecord', params);
      isUpdate = false;
    }

    // Step 6: Check if the operation was successful
    if (result.metadata && result.metadata.result === 1) {
      return res.json({
        success: true,
        message: isUpdate ? 'DNS record updated successfully' : 'DNS record added successfully',
        action: isUpdate ? 'updated' : 'added',
        data: result.data,
        metadata: result.metadata,
        record: {
          domain: domain.toLowerCase(),
          name: params.name,
          type: type.toUpperCase(),
          ttl: ttl,
          line: existing ? existing.line : 'new',
          timestamp: new Date().toISOString()
        }
      });
    } else {
      const errorMsg = result.metadata?.reason || result.errors?.[0] || 'Unknown error from WHM API';
      
      return res.status(500).json({
        success: false,
        error: isUpdate ? 'Failed to update DNS record' : 'Failed to add DNS record',
        details: errorMsg,
        metadata: result.metadata
      });
    }

  } catch (err) {
    console.error('DNS upsert failed:', err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      details: err.response?.data || null
    });
  }
});


module.exports = {
  router,
  cpanelRequest,
  validateDMARCRecords
};
