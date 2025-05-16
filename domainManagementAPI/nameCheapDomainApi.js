//_____________________________Google Workspace API_____________________________

// require('dotenv').config();
// const { google } = require('googleapis');
// const fs = require('fs');
// const path = require('path');
// const express = require('express');
// const router = express.Router();

// // Configuration
// const KEYFILE_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
// const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
// const DOMAIN = process.env.DOMAIN || (ADMIN_EMAIL && ADMIN_EMAIL.split('@')[1]);

// // Validate environment variables
// if (!KEYFILE_PATH || !ADMIN_EMAIL || !DOMAIN) {
//   console.error('❌ Missing required environment variables: GOOGLE_APPLICATION_CREDENTIALS, ADMIN_EMAIL, DOMAIN');
//   throw new Error('Server initialization failed');
// }

// // Initialize Google Workspace Client
// let authClient;
// let directoryService;

// async function initializeClient() {
//   try {
//     // Resolve and validate credentials path
//     const resolvedKeyPath = path.resolve(KEYFILE_PATH);
//     if (!fs.existsSync(resolvedKeyPath)) {
//       throw new Error(`Credentials file not found at ${resolvedKeyPath}`);
//     }

//     // Load service account credentials
//     const credentials = require(resolvedKeyPath);

//     // Validate credentials
//     const requiredFields = ['client_email', 'private_key'];
//     const missingFields = requiredFields.filter(field => !credentials[field]);
//     if (missingFields.length > 0) {
//       throw new Error(`Missing required fields in credentials: ${missingFields.join(', ')}`);
//     }

//     // Initialize auth client with domain-wide delegation
//     authClient = new google.auth.JWT({
//       email: credentials.client_email,
//       key: credentials.private_key.replace(/\\n/g, '\n'),
//       scopes: [
//         'https://www.googleapis.com/auth/admin.directory.user',
//         'https://www.googleapis.com/auth/admin.directory.user.security'
//       ],
//       subject: ADMIN_EMAIL
//     });

//     // Initialize Directory Service
//     directoryService = google.admin({ version: 'directory_v1', auth: authClient });

//     // Test authentication and API access
//     await authClient.authorize();
//     await directoryService.users.list({ domain: DOMAIN, maxResults: 1 });
//     console.log('[emailCreateAPI] ✅ Google Workspace Email API client initialized successfully');
//   } catch (err) {
//     console.error('[emailCreateAPI] ❌ Failed to initialize Google Workspace client:', {
//       message: err.message,
//       code: err.code,
//       details: err.response?.data?.error,
//       stack: err.stack
//     });
//     throw err;
//   }
// }

// // Initialize client
// initializeClient().catch(() => process.exit(1));

// // Input validation utility
// function validateEmail(email) {
//   const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
//   return re.test(email);
// }

// function sanitizeInput(input) {
//   return typeof input === 'string' ? input.replace(/[<>"'&]/g, '') : input;
// }

// /**
//  * @api {post} /google/email/create Create Email Account
//  * @apiName CreateEmailAccount
//  * @apiGroup GoogleEmail
//  * 
//  * @apiParam {String} firstName User's first name
//  * @apiParam {String} lastName User's last name
//  * @apiParam {String} email User's email address
//  * @apiParam {String} password Initial password (min 8 characters)
//  * 
//  * @apiSuccess {Boolean} success Operation status
//  * @apiSuccess {Object} data Created user data
//  */
// router.post('/google/email/create', async (req, res) => {
//   try {
//     let { firstName, lastName, email, password } = req.body;

//     // Sanitize inputs
//     firstName = sanitizeInput(firstName);
//     lastName = sanitizeInput(lastName);
//     email = sanitizeInput(email);

//     // Validate input
//     if (!firstName || !lastName || !email || !password) {
//       return res.status(400).json({
//         success: false,
//         error: 'Missing required fields',
//         required: ['firstName', 'lastName', 'email', 'password']
//       });
//     }

//     if (!validateEmail(email)) {
//       return res.status(400).json({
//         success: false,
//         error: 'Invalid email format'
//       });
//     }

//     if (password.length < 8) {
//       return res.status(400).json({
//         success: false,
//         error: 'Password must be at least 8 characters'
//       });
//     }

//     // Validate email domain
//     const userDomain = email.split('@')[1];
//     if (userDomain !== DOMAIN) {
//       return res.status(400).json({
//         success: false,
//         error: `Email must belong to ${DOMAIN} domain`
//       });
//     }

//     // Create user
//     const response = await directoryService.users.insert({
//       requestBody: {
//         name: {
//           givenName: firstName,
//           familyName: lastName
//         },
//         primaryEmail: email,
//         password,
//         changePasswordAtNextLogin: true,
//         agreedToTerms: true,
//         suspended: false,
//         includeInGlobalAddressList: true
//       }
//     });

//     res.json({
//       success: true,
//       data: {
//         id: response.data.id,
//         email: response.data.primaryEmail,
//         name: response.data.name,
//         status: 'created'
//       }
//     });
//   } catch (err) {
//     console.error('[emailCreateAPI] ❌ Email creation error:', {
//       message: err.message,
//       code: err.code,
//       details: err.response?.data?.error
//     });

//     let statusCode = 500;
//     if (err.code === 409) statusCode = 409; // Duplicate account
//     else if (err.code === 403) statusCode = 403; // Permission denied
//     else if (err.code === 400) statusCode = 400; // Invalid input

//     res.status(statusCode).json({
//       success: false,
//       error: err.message,
//       details: err.response?.data?.error || null
//     });
//   }
// });

// /**
//  * @api {get} /google/email/check/:email Check Email Existence
//  * @apiName CheckEmailExists
//  * @apiGroup GoogleEmail
//  * 
//  * @apiParam {String} email Email address to check
//  * 
//  * @apiSuccess {Boolean} success Operation status
//  * @apiSuccess {Boolean} exists Whether email exists
//  * @apiSuccess {Object} data User data if exists
//  */
// router.get('/google/email/check/:email', async (req, res) => {
//   try {
//     const email = sanitizeInput(req.params.email);

//     if (!email || !validateEmail(email)) {
//       return res.status(400).json({
//         success: false,
//         error: 'Valid email parameter is required'
//       });
//     }

//     const response = await directoryService.users.get({
//       userKey: email
//     });

//     res.json({
//       success: true,
//       exists: true,
//       data: {
//         id: response.data.id,
//         email: response.data.primaryEmail,
//         name: response.data.name,
//         suspended: response.data.suspended
//       }
//     });
//   } catch (err) {
//     if (err.code === 404) {
//       res.json({
//         success: true,
//         exists: false
//       });
//     } else {
//       console.error('[emailCreateAPI] ❌ Email check error:', {
//         message: err.message,
//         code: err.code,
//         details: err.response?.data?.error
//       });
//       const statusCode = err.code === 403 ? 403 : 500;
//       res.status(statusCode).json({
//         success: false,
//         error: err.message,
//         details: err.response?.data?.error || null
//       });
//     }
//   }
// });

// /**
//  * @api {get} /google/email/health Health Check
//  * @apiName EmailApiHealth
//  * @apiGroup GoogleEmail
//  * 
//  * @apiSuccess {Boolean} success API status
//  * @apiSuccess {String} message Status message
//  */
// router.get('/google/email/health', async (req, res) => {
//   try {
//     await authClient.authorize();
//     const response = await directoryService.users.list({
//       domain: DOMAIN,
//       maxResults: 1
//     });

//     res.json({
//       success: true,
//       message: 'Google Workspace Email API is healthy',
//       domain: DOMAIN,
//       usersFound: response.data.users?.length || 0
//     });
//   } catch (err) {
//     console.error('[emailCreateAPI] ❌ Health check error:', {
//       message: err.message,
//       code: err.code,
//       details: err.response?.data?.error
//     });

//     res.status(500).json({
//       success: false,
//       error: err.message,
//       details: err.response?.data?.error || null
//     });
//   }
// });

// module.exports = router;


//_____________________________Namecheap API_____________________________

require('dotenv').config();
const axios = require('axios');
const express = require('express');
const xml2js = require('xml2js');
const router = express.Router();

// Namecheap API Configuration
const {
    NAMECHEAP_API_USER,
    NAMECHEAP_API_KEY,
    NAMECHEAP_CLIENT_IP,
    NAMECHEAP_SANDBOX
} = process.env;

// Validate environment variables
if (!NAMECHEAP_API_USER || !NAMECHEAP_API_KEY || !NAMECHEAP_CLIENT_IP) {
    console.error('❌ Missing required Namecheap environment variables:');
    console.error('  - NAMECHEAP_API_USER:', NAMECHEAP_API_USER ? '✓' : '✗');
    console.error('  - NAMECHEAP_API_KEY:', NAMECHEAP_API_KEY ? '✓' : '✗');
    console.error('  - NAMECHEAP_CLIENT_IP:', NAMECHEAP_CLIENT_IP ? '✓' : '✗');
    throw new Error('Server initialization failed: Missing Namecheap environment variables');
}

// Log API configuration
console.log(`[Namecheap API] Mode: ${NAMECHEAP_SANDBOX === 'true' ? 'SANDBOX' : 'PRODUCTION'}`);
console.log(`[Namecheap API] User: ${NAMECHEAP_API_USER}`);


// const BASE_URL = 'https://api.namecheap.com/xml.response';
const BASE_URL = 'https://api.sandbox.namecheap.com/xml.response';


// Helper: Validate domain name
function isValidDomain(domain) {
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/;
    return domainRegex.test(domain);
}

// Helper: Parse XML response
async function parseXmlResponse(xml) {
    if (!xml || typeof xml !== 'string') {
        throw new Error('Invalid or empty XML response');
    }
    const parser = new xml2js.Parser({ explicitArray: false });
    try {
        return await parser.parseStringPromise(xml);
    } catch (err) {
        console.error('[Namecheap API] XML parsing error:', err.message);
        throw new Error('Failed to parse API response');
    }
}

// Send Namecheap XML request
async function namecheapRequest(command, params = {}, retryCount = 0) {
    const body = new URLSearchParams({
        ApiUser: NAMECHEAP_API_USER,
        ApiKey: NAMECHEAP_API_KEY,
        UserName: NAMECHEAP_API_USER,
        ClientIp: NAMECHEAP_CLIENT_IP,
        Command: command,
        ...params
    });

    try {
        console.log('[Namecheap API] Making request:', {
            command,
            params: { ...params, password: '***' },
            url: BASE_URL
        });

        const response = await axios.post(BASE_URL, body.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            maxRedirects: 5,
            validateStatus: function (status) {
                return status >= 200 && status < 500;
            }
        });

        if (!response.data) {
            throw new Error('Empty response from Namecheap API');
        }

        console.log('[Namecheap API] Raw response:', response.data);

        const parsed = await parseXmlResponse(response.data);

        // Check API response status
        if (!parsed.ApiResponse) {
            throw new Error('Invalid API response format');
        }

        if (parsed.ApiResponse.$.Status !== 'OK') {
            const error = parsed.ApiResponse?.Errors?.Error?._ || 
                         parsed.ApiResponse?.Errors?.Error || 
                         'Unknown API error';
            throw new Error(`Namecheap API error: ${error}`);
        }

        return parsed;
    } catch (err) {
        console.error('[Namecheap API] Request failed:', {
            command,
            error: err.message,
            status: err.response?.status,
            responseData: err.response?.data,
            retryCount,
            stack: err.stack
        });

        // If we haven't retried yet and it's a network error, retry once
        if (retryCount === 0 && (!err.response || err.response.status >= 500)) {
            console.log('[Namecheap API] Retrying request...');
            return namecheapRequest(command, params, retryCount + 1);
        }

        throw err;
    }
}



/**
 * Health Check
 */
router.get('/namecheap/health', async (req, res) => {
    try {
        const response = await namecheapRequest('namecheap.users.getBalances');
        const balance = response.ApiResponse.CommandResponse.UserGetBalancesResult.AccountBalance;

        res.json({
            success: true,
            sandboxMode: NAMECHEAP_SANDBOX === 'true',
            accountBalance: balance,
            apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
            apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
        });
    }
});

/**
 * Check domain availability
 */
router.get('/namecheap/domain/check/:domain', async (req, res) => {
    const domain = req.params.domain;
    console.log(`[Domain API] 🔍 Starting domain check process for: ${domain}`);

    // Validate domain
    if (!isValidDomain(domain)) {
        console.error(`[Domain API] Invalid domain format: ${domain}`);
        return res.status(400).json({
            status: "0",
            message: "Invalid domain format",
            data: null,
            apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
        });
    }

    try {
        // 1. Check domain availability
        console.log(`[Domain API] Step 1: Checking availability for ${domain}`);
        const checkResult = await namecheapRequest('namecheap.domains.check', {
            DomainList: domain,
            ProductType: 'DOMAIN'
        });

        console.log('[Domain API] Check response:', JSON.stringify(checkResult, null, 2));

        const domainResult = checkResult.ApiResponse.CommandResponse.DomainCheckResult;
        const available = domainResult.$.Available === 'true';
        const isPremium = domainResult.$.IsPremiumName === 'true';
        const price = domainResult.$.Price ? parseFloat(domainResult.$.Price) : null;

        console.log(`[DomainPrice] ${price}`);
        console.log(`[Domain API] ✓ Domain ${domain} availability check complete - Available: ${available}`);

        // 3. Generate and check domain suggestions
        const keyword = domain.split('.')[0];
        const tlds = ['com', 'net', 'io', 'ai', 'co'];
        console.log(`[Domain API] Step 3: Generating suggestions for keyword "${keyword}" with ${tlds.length} TLDs`);
        const suggestions = [];

        // Check base keyword with different TLDs
        for (const tld of tlds) {
            const suggestionDomain = `${keyword}.${tld}`;
            if (suggestionDomain === domain) {
                console.log(`[Domain API] Skipping original domain: ${suggestionDomain}`);
                continue;
            }

            try {
                console.log(`[Domain API] Checking suggestion: ${suggestionDomain}`);
                const suggestionResult = await namecheapRequest('namecheap.domains.check', {
                    DomainList: suggestionDomain,
                    ProductType: 'DOMAIN'
                });

                const suggestionData = suggestionResult.ApiResponse.CommandResponse.DomainCheckResult;
                const isAvailable = suggestionData.$.Available === 'true';
                const isPremiumName = suggestionData.$.IsPremiumName === 'true';
                const suggestionPrice = suggestionData.$.Price ? parseFloat(suggestionData.$.Price) : null;

                if (isAvailable) {
                    console.log(`[Domain API] ✓ Found available domain: ${suggestionDomain}`);
                    suggestions.push({
                        domain: suggestionDomain,
                        available: true,
                        isPremium: isPremiumName,
                        status: 'success',
                        price: {
                            register: suggestionPrice,
                            currency: 'USD',
                            renew: suggestionPrice
                        }
                    });
                } else {
                    console.log(`[Domain API] ✗ Domain not available: ${suggestionDomain}`);
                }
            } catch (error) {
                console.error(`[Domain API] ❌ Error checking suggestion ${suggestionDomain}:`, error.message);
            }
        }

        console.log(`[Domain API] ✓ Found ${suggestions.length} available domain suggestions`);

        // 4. Format the final response
        console.log('[Domain API] Step 4: Formatting final response');
        const response = {
            status: "1",
            message: "Success",
            data: {
                domain,
                available,
                isPremium,
                status: "success",
                price: available ? {
                    register: price,
                    currency: 'USD',
                    renew: price
                } : null,
                suggestedDomains: suggestions,
                apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
            }
        };

        console.log('[Domain API] ✅ Successfully completed domain check process');
        res.json(response);

    } catch (err) {
        console.error('[Domain API] ❌ Error in domain check process:', {
            error: err.message,
            domain,
            status: err.response?.status,
            responseData: err.response?.data,
            stack: err.stack,
            timestamp: new Date().toISOString()
        });

        res.status(500).json({
            status: "0",
            message: err.message,
            data: null,
            apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
        });
    }
});

/**
 * Get pricing for all TLDs and actions
 */
router.get('/namecheap/domain/pricing', async (req, res) => {
    try {
        const xml = await namecheapRequest('namecheap.users.getPricing', {
            ProductType: 'DOMAIN'
        });
        res.json({ success: true, data: xml.ApiResponse.CommandResponse });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Suggest similar domains (simple suffix-based)
 */
router.get('/namecheap/domain/suggestions', async (req, res) => {
    const keyword = req.query.keyword;
    if (!keyword) return res.status(400).json({ success: false, error: 'Missing keyword query param' });

    const suffixes = ['', 'online', 'app', 'hq', 'site'];
    const tld = 'com';
    const candidates = suffixes.map(s => `${keyword}${s}.${tld}`);

    try {
        const results = await Promise.all(candidates.map(async domain => {
            try {
                const xml = await namecheapRequest('namecheap.domains.check', { DomainList: domain });
                const result = xml.ApiResponse.CommandResponse.DomainCheckResult;
                return { domain, available: result.$.Available === 'true' };
            } catch {
                return { domain, available: false };
            }
        }));
        res.json({ success: true, suggestions: results });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Register a domain
 */
router.post('/namecheap/domain/register', async (req, res) => {
    const { 
        domain, 
        firstName, 
        lastName, 
        email, 
        phone, 
        address1, 
        address2 = '', 
        city, 
        stateProvince, 
        country, 
        postalCode,
        years = '1',
        enablePrivacy = false
    } = req.body;

    // Validate required fields
    if (!domain || !firstName || !lastName || !email || !phone || !address1 || !city || !stateProvince || !country || !postalCode) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing required registration fields',
            required: ['domain', 'firstName', 'lastName', 'email', 'phone', 'address1', 'city', 'stateProvince', 'country', 'postalCode']
        });
    }

    if (!isValidDomain(domain)) {
        return res.status(400).json({ success: false, error: 'Invalid domain format' });
    }

    try {
        // First check if domain is available
        console.log(`[Domain API] Checking availability for domain: ${domain}`);
        const checkResult = await namecheapRequest('namecheap.domains.check', {
            DomainList: domain
        });

        console.log('[Domain API] Check response:', JSON.stringify(checkResult, null, 2));

        // Validate the check response structure
        if (!checkResult?.ApiResponse?.CommandResponse?.DomainCheckResult) {
            throw new Error('Invalid response format from domain check');
        }

        const domainResult = checkResult.ApiResponse.CommandResponse.DomainCheckResult;
        const isAvailable = domainResult.$.Available === 'true';
        const isPremium = domainResult.$.IsPremiumName === 'true';
        const price = domainResult.$.Price ? parseFloat(domainResult.$.Price) : null;

        console.log(`[Domain API] Domain check results:`, {
            domain,
            isAvailable,
            isPremium,
            price
        });

        if (!isAvailable) {
            return res.status(400).json({ 
                success: false, 
                error: 'Domain is not available for registration',
                details: {
                    domain,
                    isPremium,
                    price
                }
            });
        }

        // Proceed with domain registration
        console.log(`[Domain API] Proceeding with registration for domain: ${domain}`);
        const xml = await namecheapRequest('namecheap.domains.create', {
            DomainName: domain,
            Years: years,
            RegistrantFirstName: firstName,
            RegistrantLastName: lastName,
            RegistrantEmailAddress: email,
            RegistrantPhone: phone,
            RegistrantAddress1: address1,
            RegistrantAddress2: address2,
            RegistrantCity: city,
            RegistrantStateProvince: stateProvince,
            RegistrantCountry: country,
            RegistrantPostalCode: postalCode,
            TechFirstName: firstName,
            TechLastName: lastName,
            TechEmailAddress: email,
            TechPhone: phone,
            TechAddress1: address1,
            TechAddress2: address2,
            TechCity: city,
            TechStateProvince: stateProvince,
            TechCountry: country,
            TechPostalCode: postalCode,
            AdminFirstName: firstName,
            AdminLastName: lastName,
            AdminEmailAddress: email,
            AdminPhone: phone,
            AdminAddress1: address1,
            AdminAddress2: address2,
            AdminCity: city,
            AdminStateProvince: stateProvince,
            AdminCountry: country,
            AdminPostalCode: postalCode,
            AuxBillingFirstName: firstName,
            AuxBillingLastName: lastName,
            AuxBillingEmailAddress: email,
            AuxBillingPhone: phone,
            AuxBillingAddress1: address1,
            AuxBillingAddress2: address2,
            AuxBillingCity: city,
            AuxBillingStateProvince: stateProvince,
            AuxBillingCountry: country,
            AuxBillingPostalCode: postalCode,
            EnableWhoisGuard: enablePrivacy ? 'true' : 'false'
        });

        // Verify registration was successful
        if (xml?.ApiResponse?.CommandResponse?.DomainCreateResult?.$?.Registered !== 'true') {
            throw new Error('Domain registration failed');
        }

        const chargedAmount = parseFloat(xml.ApiResponse.CommandResponse.DomainCreateResult.$.ChargedAmount);
        const domainId = xml.ApiResponse.CommandResponse.DomainCreateResult.$.DomainID;
        const orderId = xml.ApiResponse.CommandResponse.DomainCreateResult.$.OrderID;
        const transactionId = xml.ApiResponse.CommandResponse.DomainCreateResult.$.TransactionID;

        // If registration successful and privacy was requested, enable WHOIS Guard
        if (enablePrivacy) {
            try {
                console.log(`[Domain API] Enabling WHOIS Guard for domain: ${domain}`);
                await namecheapRequest('namecheap.domains.setContacts', {
                    DomainName: domain,
                    RegistrantFirstName: firstName,
                    RegistrantLastName: lastName,
                    RegistrantEmailAddress: email,
                    RegistrantPhone: phone,
                    RegistrantAddress1: address1,
                    RegistrantAddress2: address2,
                    RegistrantCity: city,
                    RegistrantStateProvince: stateProvince,
                    RegistrantCountry: country,
                    RegistrantPostalCode: postalCode,
                    TechFirstName: firstName,
                    TechLastName: lastName,
                    TechEmailAddress: email,
                    TechPhone: phone,
                    TechAddress1: address1,
                    TechAddress2: address2,
                    TechCity: city,
                    TechStateProvince: stateProvince,
                    TechCountry: country,
                    TechPostalCode: postalCode,
                    AdminFirstName: firstName,
                    AdminLastName: lastName,
                    AdminEmailAddress: email,
                    AdminPhone: phone,
                    AdminAddress1: address1,
                    AdminAddress2: address2,
                    AdminCity: city,
                    AdminStateProvince: stateProvince,
                    AdminCountry: country,
                    AdminPostalCode: postalCode,
                    AuxBillingFirstName: firstName,
                    AuxBillingLastName: lastName,
                    AuxBillingEmailAddress: email,
                    AuxBillingPhone: phone,
                    AuxBillingAddress1: address1,
                    AuxBillingAddress2: address2,
                    AuxBillingCity: city,
                    AuxBillingStateProvince: stateProvince,
                    AuxBillingCountry: country,
                    AuxBillingPostalCode: postalCode,
                    EnableWhoisGuard: 'true'
                });
            } catch (privacyErr) {
                console.error('[Domain API] Failed to enable WHOIS Guard:', privacyErr.message);
                // Don't fail the registration if privacy enablement fails
            }
        }

        res.json({ 
            success: true, 
            domain,
            data: {
                registration: xml.ApiResponse.CommandResponse,
                chargedAmount,
                domainId,
                orderId,
                transactionId
            },
            privacyEnabled: enablePrivacy,
            price: chargedAmount
        });
    } catch (err) {
        console.error('[Domain API] Registration error:', {
            error: err.message,
            domain,
            status: err.response?.status,
            responseData: err.response?.data
        });

        res.status(500).json({ 
            success: false, 
            error: err.message,
            details: err.response?.data?.error || null
        });
    }
});

/**
 * Create an email mailbox
 */
router.post('/namecheap/email/create', async (req, res) => {
    console.log('[Email API] 📧 Starting email creation process');
    console.log('[Email API] Request body:', JSON.stringify(req.body, null, 2));

    const { domain, username, password, mailboxSize = 500 } = req.body;
    
    // Validate required fields
    if (!domain || !username || !password) {
        console.error('[Email API] ❌ Missing required fields:', { domain, username, password: '***' });
        return res.status(400).json({ success: false, error: 'Missing domain, username, or password' });
    }

    // Validate domain format
    if (!isValidDomain(domain)) {
        console.error('[Email API] ❌ Invalid domain format:', domain);
        return res.status(400).json({ success: false, error: 'Invalid domain format' });
    }

    try {
        console.log('[Email API] 🚀 Calling Namecheap API to create email:', {
            domain,
            username,
            mailboxSize,
            apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
        });

        // Use the correct API command for email creation
        const xml = await namecheapRequest('namecheap.mail.create', {
            DomainName: domain,
            UserName: username,
            Password: password,
            MailBoxSize: mailboxSize.toString(),
            // Additional required parameters
            ForwardTo: '',  // Optional forwarding email
            ReplyTo: '',    // Optional reply-to email
            AutoResponder: 'false',  // Disable auto-responder by default
            AutoResponderMessage: '', // Empty auto-responder message
            AutoResponderSubject: ''  // Empty auto-responder subject
        });

        if (!xml?.ApiResponse?.CommandResponse) {
            throw new Error('Invalid response format from Namecheap API');
        }

        console.log('[Email API] ✅ Email created successfully:', {
            email: `${username}@${domain}`,
            response: JSON.stringify(xml.ApiResponse.CommandResponse, null, 2)
        });

        res.json({ 
            success: true, 
            email: `${username}@${domain}`, 
            data: xml.ApiResponse.CommandResponse 
        });
    } catch (err) {
        console.error('[Email API] ❌ Error creating email:', {
            error: err.message,
            domain,
            username,
            status: err.response?.status,
            responseData: err.response?.data,
            stack: err.stack,
            timestamp: new Date().toISOString()
        });

        // Handle specific error cases
        if (err.message.includes('already exists')) {
            return res.status(409).json({ 
                success: false, 
                error: 'Email account already exists' 
            });
        }

        if (err.message.includes('Invalid response format')) {
            return res.status(500).json({ 
                success: false, 
                error: 'Invalid response from Namecheap API' 
            });
        }

        res.status(500).json({ 
            success: false, 
            error: err.message || 'Failed to create email account' 
        });
    }
});

module.exports = router;