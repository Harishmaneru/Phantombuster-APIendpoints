const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const rateLimit = require('express-rate-limit');

// Import the NamecheapDomain model from the existing schema
const { NamecheapDomain } = require('./nameCheapDomainApi.js');

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

    // Step 2: Check if domain exists as addon domain, add if needed
    const domainExists = await checkAddonDomainExists(domain);
    if (!domainExists) {
      console.log(`Adding domain ${domain} as addon domain...`);
      const addonResult = await addAddonDomain(domain);
      console.log('Addon domain result:', addonResult);
    } else {
      console.log(`Domain ${domain} already exists (main or addon domain)`);
    }

    // Step 3: Create email account
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
    try {
      console.log('Trying WHM API for email creation...');
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

    console.log('Email creation result:', emailResult);

    if (emailResult.status !== 1) {
      const errorMsg = (emailResult.errors && emailResult.errors[0]) || 'Unknown error from cPanel';
      throw new Error(errorMsg);
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

    // Step 5: Return success response with additional info
    res.json({
      success: true,
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
      data: emailResult.data,
      databaseRecord: {
        saved: !!updatedDomain,
        domainId: updatedDomain?._id,
        emailAccountsCount: updatedDomain?.emailAccounts?.length || 0
      },
    });
  } catch (err) {
    console.error('Email creation failed:', err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      details: err.response?.data || null
    });
  }
});

// Route: List all email accounts for a domain
router.get('/cpanel/list-emails/:userId/:domain', async (req, res) => {
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

    // Get disk usage for filtered emails only
    const emailsWithDetails = await Promise.all(
      domainEmails.map(async (email) => {
        const usageResult = await cpanelRequest('Email/get_disk_usage', {
          email: email.email
        });

        return {
          username: email.user,
          email: email.email,
          domain: email.domain,
          suspended: email.suspended === '1',
          created: email.created,
          quota: {
            limit: email.diskquota === 'unlimited' ? -1 : parseInt(email.diskquota),
            formatted: email.diskquota === 'unlimited' ? 'Unlimited' : `${parseInt(email.diskquota)} MB`,
            isUnlimited: email.diskquota === 'unlimited'
          },
          usage: {
            bytes: usageResult.status === 1 ? usageResult.data.used_bytes : 0,
            percentage: usageResult.status === 1 ? usageResult.data.usage_percentage : 0,
            formatted: usageResult.status === 1 ? usageResult.data.human_readable : '0 MB'
          },
        };
      })
    );

    // Calculate domain-wide statistics
    const domainStats = {
      totalAccounts: emailsWithDetails.length,
      totalUsed: emailsWithDetails.reduce((sum, email) => sum + email.usage.bytes, 0),
      totalQuota: emailsWithDetails.reduce((sum, email) => 
        email.quota.isUnlimited ? -1 : sum + email.quota.limit, 0)
    };

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

    // Step 5: Return success response
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
    res.status(500).json({
      success: false,
      error: err.message,
      details: err.response?.data || null
    });
  }
});

//_____________fetch all email accounts for userID______________

// Route: Fetch all email accounts for a specific userID
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

    // Step 2: Fetch email accounts for each domain
    const allEmails = [];
    const domainStats = [];

    for (const domainRecord of userDomains) {
      const domain = domainRecord.domain;
      
      try {
        // Get email accounts for this domain
        const emailResult = await cpanelRequest('Email/list_pops_with_disk', {
          domain: domain.toLowerCase()
        });

        if (emailResult.status === 1 && emailResult.data) {
          // Filter emails to only include those for this specific domain
          const domainEmails = emailResult.data.filter(email => 
            email.domain && email.domain.toLowerCase() === domain.toLowerCase()
          );

          console.log(`Found ${domainEmails.length} email accounts for domain ${domain}`);

          // Get disk usage for each email
          const emailsWithDetails = await Promise.all(
            domainEmails.map(async (email) => {
              const usageResult = await cpanelRequest('Email/get_disk_usage', {
                email: email.email
              });

              return {
                username: email.user,
                email: email.email,
                domain: email.domain,
                suspended: email.suspended === '1',
                created: email.created,
                quota: {
                  limit: email.diskquota === 'unlimited' ? -1 : parseInt(email.diskquota),
                  formatted: email.diskquota === 'unlimited' ? 'Unlimited' : `${parseInt(email.diskquota)} MB`,
                  isUnlimited: email.diskquota === 'unlimited'
                },
                usage: {
                  bytes: usageResult.status === 1 ? usageResult.data.used_bytes : 0,
                  percentage: usageResult.status === 1 ? usageResult.data.usage_percentage : 0,
                  formatted: usageResult.status === 1 ? usageResult.data.human_readable : '0 MB'
                },

              };
            })
          );

          // Calculate domain statistics
          const domainTotalUsed = emailsWithDetails.reduce((sum, email) => sum + email.usage.bytes, 0);
          const domainTotalQuota = emailsWithDetails.reduce((sum, email) => 
            email.quota.isUnlimited ? -1 : sum + email.quota.limit, 0);

          domainStats.push({
            domain: domain,
            emailCount: emailsWithDetails.length,
            totalUsed: domainTotalUsed,
            totalQuota: domainTotalQuota,
            usagePercentage: domainTotalQuota === -1 ? 0 : 
              Math.round((domainTotalUsed / domainTotalQuota) * 100),
            formattedUsage: formatStorage(domainTotalUsed),
            formattedQuota: domainTotalQuota === -1 ? 'Unlimited' : 
              formatStorage(domainTotalQuota)
          });

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

          allEmails.push(...emailsWithDomainInfo);
        }
      } catch (domainError) {
        console.error(`Error fetching emails for domain ${domain}:`, domainError.message);
        // Continue with other domains even if one fails
        domainStats.push({
          domain: domain,
          emailCount: 0,
          error: domainError.message,
          totalUsed: 0,
          totalQuota: 0,
          usagePercentage: 0,
          formattedUsage: '0 B',
          formattedQuota: '0 B'
        });
      }
    }

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

module.exports = router;
