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
  timeout: 30000
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
async function cpanelRequest(endpoint, params = {}) {
  try {
    const queryString = new URLSearchParams(params).toString();
    const url = `https://${WHM_HOST}:2083/execute/${endpoint}${queryString ? '?' + queryString : ''}`;
    
    console.log('cPanel API Request:', url);
    
    const response = await axios.get(url, {
      httpsAgent: agent,
      headers: {
        'Authorization': `cpanel ${MASTER_USER}:${CPANEL_TOKEN}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
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
    return result.data && result.data.addon_domains && 
           result.data.addon_domains.some(d => d.domain === domain);
  } catch (error) {
    console.error('Error checking addon domain:', error);
    return false;
  }
}

// Add domain as addon domain
async function addAddonDomain(domain) {
  try {
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

// Test route to check available email functions
router.get('/cpanel/test-email-functions', async (req, res) => {
  try {
    const functions = await listAvailableEmailFunctions();
    res.json({
      success: true,
      availableFunctions: functions,
      message: 'Email functions check completed'
    });
  } catch (err) {
    console.error('Failed to check email functions:', err.message);
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
      await addAddonDomain(domain);
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

    const emailResult = await cpanelRequest('Email/add_pop', emailParams);

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

    // Get emails from cPanel
    const emailResult = await cpanelRequest('Email/list_pops', {
      domain: domain.toLowerCase()
    });

    if (emailResult.status !== 1) {
      throw new Error(emailResult.errors?.[0] || 'Failed to fetch email accounts');
    }

    res.json({
      success: true,
      domain: domain.toLowerCase(),
      emails: emailResult.data || [],
      count: emailResult.data?.length || 0
    });
  } catch (err) {
    console.error('Failed to list emails:', err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// Route: Delete email account (flexible format)
router.delete('/cpanel/delete-email-flexible/:userId', async (req, res) => {
  const { userId } = req.params;
  const { email, domain, flags, skip_quota = 0 } = req.query;

  if (!userId || !email) {
    return res.status(400).json({ 
      success: false, 
      error: 'userId and email are required.' 
    });
  }

  // Validate skip_quota parameter
  if (skip_quota !== undefined && ![0, 1].includes(parseInt(skip_quota))) {
    return res.status(400).json({ 
      success: false, 
      error: 'skip_quota must be 0 or 1.' 
    });
  }

  try {
    // Parse email to extract username and domain
    let emailUsername, emailDomain;
    
    if (email.includes('@')) {
      // Full email address provided
      const emailParts = email.split('@');
      emailUsername = emailParts[0];
      emailDomain = emailParts[1];
    } else {
      // Only username provided, domain must be specified
      if (!domain) {
        return res.status(400).json({ 
          success: false, 
          error: 'domain parameter is required when email is provided as username only.' 
        });
      }
      emailUsername = email;
      emailDomain = domain;
    }

    // Verify user owns domain
    const domainOwnership = await userOwnsDomain(userId, emailDomain);
    if (!domainOwnership) {
      return res.status(403).json({ 
        success: false, 
        error: 'Domain not registered to user or domain is not active.' 
      });
    }

    // Prepare delete parameters according to cPanel API documentation
    const deleteParams = {
      email: `${emailUsername.toLowerCase()}@${emailDomain.toLowerCase()}`,
      skip_quota: parseInt(skip_quota)
    };

    // Add domain parameter if explicitly provided
    if (domain) {
      deleteParams.domain = domain.toLowerCase();
    }

    // Add flags parameter if provided
    if (flags) {
      deleteParams.flags = flags;
    }

    // Delete email from cPanel - try multiple function names
    let deleteResult;
    try {
      deleteResult = await cpanelRequest('Email/del_pop', deleteParams);
    } catch (error) {
      // If del_pop fails, try alternative function names
      if (error.message.includes('could not find the function')) {
        try {
          deleteResult = await cpanelRequest('Email/delete_pop', deleteParams);
        } catch (error2) {
          if (error2.message.includes('could not find the function')) {
            try {
              deleteResult = await cpanelRequest('Email/remove_pop', deleteParams);
            } catch (error3) {
              // Try WHM API as last resort
              try {
                console.log('Trying WHM API for email deletion...');
                deleteResult = await whmRequest('del_pop', {
                  email: deleteParams.email,
                  domain: deleteParams.domain
                });
                // WHM API returns different format, normalize it
                if (deleteResult.status === 1) {
                  deleteResult = { status: 1, data: deleteResult.data };
                } else {
                  throw new Error(deleteResult.error || 'WHM API deletion failed');
                }
              } catch (error4) {
                throw new Error(`Email deletion failed. Tried: del_pop, delete_pop, remove_pop, WHM API. Last error: ${error4.message}`);
              }
            }
          } else {
            throw error2;
          }
        }
      } else {
        throw error;
      }
    }

    if (deleteResult.status !== 1) {
      throw new Error(deleteResult.errors?.[0] || 'Failed to delete email account');
    }

    // Remove from database
    const updatedDomain = await NamecheapDomain.findOneAndUpdate(
      { userId, domain: emailDomain.toLowerCase() },
      { 
        $pull: { emailAccounts: { username: emailUsername.toLowerCase() } },
        updatedAt: new Date()
      },
      { new: true }
    );

    res.json({
      success: true,
      message: `Email account ${emailUsername}@${emailDomain} deleted successfully`,
      data: deleteResult.data,
      databaseRecord: {
        updated: !!updatedDomain,
        remainingEmails: updatedDomain?.emailAccounts?.length || 0
      }
    });
  } catch (err) {
    console.error('Failed to delete email:', err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// Route: Delete email account (original format)
router.delete('/cpanel/delete-email/:userId/:domain/:username', async (req, res) => {
  const { userId, domain, username } = req.params;
  const { flags, skip_quota = 0 } = req.query;

  if (!userId || !domain || !username) {
    return res.status(400).json({ 
      success: false, 
      error: 'userId, domain, and username are required.' 
    });
  }

  // Validate skip_quota parameter
  if (skip_quota !== undefined && ![0, 1].includes(parseInt(skip_quota))) {
    return res.status(400).json({ 
      success: false, 
      error: 'skip_quota must be 0 or 1.' 
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

    // Prepare delete parameters according to cPanel API documentation
    const deleteParams = {
      email: `${username.toLowerCase()}@${domain.toLowerCase()}`,
      domain: domain.toLowerCase(),
      skip_quota: parseInt(skip_quota)
    };

    // Add flags parameter if provided
    if (flags) {
      deleteParams.flags = flags;
    }

    // Delete email from cPanel - try multiple function names
    let deleteResult;
    try {
      deleteResult = await cpanelRequest('Email/del_pop', deleteParams);
    } catch (error) {
      // If del_pop fails, try alternative function names
      if (error.message.includes('could not find the function')) {
        try {
          deleteResult = await cpanelRequest('Email/delete_pop', deleteParams);
        } catch (error2) {
          if (error2.message.includes('could not find the function')) {
            try {
              deleteResult = await cpanelRequest('Email/remove_pop', deleteParams);
            } catch (error3) {
              // Try WHM API as last resort
              try {
                console.log('Trying WHM API for email deletion...');
                deleteResult = await whmRequest('del_pop', {
                  email: deleteParams.email,
                  domain: deleteParams.domain
                });
                // WHM API returns different format, normalize it
                if (deleteResult.status === 1) {
                  deleteResult = { status: 1, data: deleteResult.data };
                } else {
                  throw new Error(deleteResult.error || 'WHM API deletion failed');
                }
              } catch (error4) {
                throw new Error(`Email deletion failed. Tried: del_pop, delete_pop, remove_pop, WHM API. Last error: ${error4.message}`);
              }
            }
          } else {
            throw error2;
          }
        }
      } else {
        throw error;
      }
    }

    if (deleteResult.status !== 1) {
      throw new Error(deleteResult.errors?.[0] || 'Failed to delete email account');
    }

    // Remove from database
    const updatedDomain = await NamecheapDomain.findOneAndUpdate(
      { userId, domain: domain.toLowerCase() },
      { 
        $pull: { emailAccounts: { username: username.toLowerCase() } },
        updatedAt: new Date()
      },
      { new: true }
    );

    res.json({
      success: true,
      message: `Email account ${username}@${domain} deleted successfully`,
      data: deleteResult.data,
      databaseRecord: {
        updated: !!updatedDomain,
        remainingEmails: updatedDomain?.emailAccounts?.length || 0
      }
    });
  } catch (err) {
    console.error('Failed to delete email:', err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

// Route: Update email password
router.put('/cpanel/update-email-password', async (req, res) => {
  const { userId, domain, username, newPassword } = req.body;

  if (!userId || !domain || !username || !newPassword) {
    return res.status(400).json({ 
      success: false, 
      error: 'userId, domain, username, and newPassword are required.' 
    });
  }

  if (!isValidPassword(newPassword)) {
    return res.status(400).json({ 
      success: false, 
      error: 'Password must be between 8 and 128 characters long.' 
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

    // Update password in cPanel
    const updateResult = await cpanelRequest('Email/passwd_pop', {
      email: `${username.toLowerCase()}@${domain.toLowerCase()}`,
      password: newPassword
    });

    if (updateResult.status !== 1) {
      throw new Error(updateResult.errors?.[0] || 'Failed to update email password');
    }

    res.json({
      success: true,
      message: `Password updated successfully for ${username}@${domain}`
    });
  } catch (err) {
    console.error('Failed to update email password:', err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

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

    // Check if email exists in cPanel
    const emailResult = await cpanelRequest('Email/list_pops', {
      domain: domain.toLowerCase()
    });

    if (emailResult.status !== 1) {
      throw new Error(emailResult.errors?.[0] || 'Failed to fetch email accounts');
    }

    const emailExists = emailResult.data && emailResult.data.some(email => 
      email.user === username.toLowerCase() || email.email === `${username.toLowerCase()}@${domain.toLowerCase()}`
    );

    res.json({
      success: true,
      emailExists,
      email: `${username}@${domain}`,
      allEmails: emailResult.data || [],
      message: emailExists ? 'Email account found' : 'Email account not found'
    });
  } catch (err) {
    console.error('Failed to check email:', err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

module.exports = router;
