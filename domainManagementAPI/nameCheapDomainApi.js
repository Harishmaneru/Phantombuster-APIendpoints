require('dotenv').config();
const axios = require('axios');
const express = require('express');
const xml2js = require('xml2js');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const router = express.Router();

// Security middleware
router.use(helmet());

// Rate limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
        success: false,
        error: 'Too many requests, please try again later',
        details: 'Rate limit exceeded'
    }
});

// Apply rate limiting to all routes
router.use(apiLimiter);

// Async handler middleware
const asyncHandler = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// Error handler middleware
router.use((err, req, res, next) => {
    console.error('[API Error]', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method
    });

    res.status(err.status || 500).json({
        success: false,
        error: err.message,
        details: err.response?.data || null,
        timestamp: new Date().toISOString()
    });
});

// Common TLDs for domain suggestions and pricing
const COMMON_TLDS = ['com', 'net', 'org', 'io', 'ai', 'co', 'app', 'dev', 'tech', 'cloud'];

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

// cPanel/WHM API Configuration
const {
    CPANEL_HOST,
    CPANEL_USERNAME,
    CPANEL_TOKEN,
    WHM_HOST,
    WHM_USERNAME,
    WHM_TOKEN
} = process.env;

// Validate cPanel environment variables
if (!CPANEL_HOST || !CPANEL_USERNAME || !CPANEL_TOKEN || !WHM_HOST || !WHM_USERNAME || !WHM_TOKEN) {
    console.error('❌ Missing required cPanel/WHM environment variables:');
    console.error('  - CPANEL_HOST:', CPANEL_HOST ? '✓' : '✗');
    console.error('  - CPANEL_USERNAME:', CPANEL_USERNAME ? '✓' : '✗');
    console.error('  - CPANEL_TOKEN:', CPANEL_TOKEN ? '✓' : '✗');
    console.error('  - WHM_HOST:', WHM_HOST ? '✓' : '✗');
    console.error('  - WHM_USERNAME:', WHM_USERNAME ? '✓' : '✗');
    console.error('  - WHM_TOKEN:', WHM_TOKEN ? '✓' : '✗');
    throw new Error('Server initialization failed: Missing cPanel/WHM environment variables');
}

// Helper: Make cPanel API request
async function cpanelRequest(endpoint, params = {}) {
    const url = `https://${CPANEL_HOST}:2083/execute/${endpoint}`;
    
    try {
        const response = await axios.post(url, params, {
            headers: {
                Authorization: `cpanel ${CPANEL_USERNAME}:${CPANEL_TOKEN}`
            },
            timeout: 10000 // 10 second timeout
        });

        if (!response.data || response.data.status === 0 || response.data.error) {
            throw new Error(response.data.error || response.data.errors?.[0] || 'Unknown cPanel API error');
        }

        return response.data;
    } catch (error) {
        console.error('[cPanel API] Request failed:', {
            endpoint,
            error: error.message,
            response: error.response?.data,
            params: { ...params, password: '***' } // Log params but mask password
        });
        throw error;
    }
}

// Helper: Make WHM API request
async function whmRequest(endpoint, params = {}) {
    const url = `https://${WHM_HOST}:2087/json-api/${endpoint}`;
    
    try {
        const response = await axios.get(url, {
            params: {
                'api.version': 1,
                ...params
            },
            headers: {
                Authorization: `WHM ${WHM_USERNAME}:${WHM_TOKEN}`
            },
            timeout: 10000 // 10 second timeout
        });

        if (!response.data || response.data.status === 0 || response.data.error) {
            throw new Error(response.data.error || response.data.errors?.[0] || 'Unknown WHM API error');
        }

        return response.data;
    } catch (error) {
        console.error('[WHM API] Request failed:', {
            endpoint,
            error: error.message,
            response: error.response?.data,
            params: { ...params, password: '***' } // Log params but mask password
        });
        throw error;
    }
}

// Helper: Validate domain name with enhanced support for modern TLDs and IDN
function isValidDomain(domain) {
    // Support for modern TLDs and IDN domains
    const domainRegex = /^(?!:\/\/)([a-zA-Z0-9-_]+\.)+[a-zA-Z]{2,}$/;
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
async function namecheapRequest(command, params = {}, retryCount = 0, maxRetries = 3) {
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
            url: BASE_URL,
            retryCount
        });

        const response = await axios.post(BASE_URL, body.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            maxRedirects: 5,
            timeout: 10000, // 10 second timeout
            validateStatus: function (status) {
                return status >= 200 && status < 500;
            }
        });

        if (!response.data) {
            throw new Error('Empty response from Namecheap API');
        }

        // Add delay between retries
        if (retryCount > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
        }

        console.log('[Namecheap API] Raw response:', response.data);

        // Validate response is valid XML
        if (typeof response.data !== 'string' || !response.data.trim().startsWith('<?xml')) {
            throw new Error('Invalid XML response from API');
        }

        const parsed = await parseXmlResponse(response.data);

        // Enhanced response validation
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('Failed to parse API response');
        }

        if (!parsed.ApiResponse) {
            throw new Error('Missing ApiResponse in parsed data');
        }

        // Check for API errors
        if (parsed.ApiResponse.Errors) {
            const error = parsed.ApiResponse.Errors.Error;
            const errorMessage = typeof error === 'string' ? error : error._ || 'Unknown API error';
            throw new Error(`Namecheap API error: ${errorMessage}`);
        }

        // Check API response status
        if (parsed.ApiResponse.$.Status !== 'OK') {
            throw new Error(`API returned non-OK status: ${parsed.ApiResponse.$.Status}`);
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

        // Retry logic for specific error cases
        if (retryCount < maxRetries) {
            const shouldRetry = 
                !err.response || // Network error
                err.response.status >= 500 || // Server error
                err.message.includes('Invalid XML response') || // XML parsing error
                err.message.includes('Failed to parse API response'); // Parsing error

            if (shouldRetry) {
                console.log(`[Namecheap API] Retrying request (attempt ${retryCount + 1}/${maxRetries})...`);
                return namecheapRequest(command, params, retryCount + 1, maxRetries);
            }
        }

        // If we've exhausted retries or it's not a retryable error, throw
        throw err;
    }
}

// Helper: Extract 1-year price from getPricing XML response
function extractOneYearPrice(xml) {
    try {
        const result = xml.ApiResponse.CommandResponse.UserGetPricingResult;
        const productType = result.ProductType;

        // Find all categories
        const categories = Array.isArray(productType.ProductCategory)
            ? productType.ProductCategory
            : [productType.ProductCategory];

        const pricing = {
            register: null,
            renew: null,
            transfer: null,
            icannFee: 0.18, // Standard ICANN fee
            currency: 'USD'
        };

        // Extract prices from each category
        categories.forEach(category => {
            const product = category.Product;
            if (!product) return;

            const prices = Array.isArray(product.Price)
                ? product.Price
                : [product.Price];

            const oneYearPrice = prices.find(p => p.$.Duration === '1');
            if (!oneYearPrice) return;

            const price = parseFloat(oneYearPrice.$.YourPrice);
            const additionalCost = parseFloat(oneYearPrice.$.YourAdditonalCost || '0');

            switch (category.$.Name.toLowerCase()) {
                case 'register':
                    pricing.register = price + additionalCost;
                    break;
                case 'renew':
                    pricing.renew = price + additionalCost;
                    break;
                case 'transfer':
                    pricing.transfer = price + additionalCost;
                    break;
            }
        });

        return pricing;
    } catch (err) {
        console.error('[Domain API] Error extracting price:', err.message);
        return null;
    }
}

/**
 * Configure DNS records for email service
 * This function sets up the necessary DNS records for Namecheap Private Email service:
 * - MX records for email routing
 * - SPF record for email authentication
 * - CNAME record for webmail access
 * 
 * @param {string} domain - The domain to configure (e.g., 'example.com')
 * @returns {Promise<Object>} Configuration result with status and details
 * @property {boolean} dnsConfigured - Whether DNS was successfully configured
 * @property {Array} mxRecords - The MX records that were configured
 * @property {string} lastCheck - Timestamp of the configuration attempt
 * @property {string} [error] - Error message if configuration failed
 * @property {string} [manualSteps] - Instructions for manual configuration if needed
 */
async function configureEmailDns(domain) {
    const [sld, tld] = domain.split('.');
    
    // MX records for Namecheap Private Email
    const records = [
        { HostName: '@', RecordType: 'MX', Address: 'mx1.privateemail.com', MXPref: '10', TTL: '1800' },
        { HostName: '@', RecordType: 'MX', Address: 'mx2.privateemail.com', MXPref: '20', TTL: '1800' },
        { HostName: '@', RecordType: 'TXT', Address: 'v=spf1 include:spf.privateemail.com ~all', TTL: '1800' },
        { HostName: 'email', RecordType: 'CNAME', Address: 'privateemail.com', TTL: '1800' }
    ];

    try {
        // First verify domain is using Namecheap DNS
        const domainInfo = await namecheapRequest('namecheap.domains.getInfo', {
            DomainName: domain
        });

        const isOurDNS = domainInfo.ApiResponse.CommandResponse.DomainGetInfoResult.DnsDetails.$.IsUsingOurDNS === 'true';
        
        if (!isOurDNS) {
            return {
                dnsConfigured: false,
                error: 'Domain is not using Namecheap DNS servers',
                manualSteps: `Please update nameservers to Namecheap DNS servers and then configure these records: ${JSON.stringify(records)}`,
                lastCheck: new Date().toISOString()
            };
        }

        // Set up DNS records
        const response = await namecheapRequest('namecheap.domains.dns.setHosts', {
            SLD: sld,
            TLD: tld,
            Hosts: JSON.stringify(records)
        });

        // Verify DNS setup was successful
        if (response?.ApiResponse?.CommandResponse?.DomainDNSSetHostsResult?.$.IsSuccess !== 'true') {
            throw new Error('DNS configuration failed');
        }

        return {
            dnsConfigured: true,
            mxRecords: records.filter(r => r.RecordType === 'MX'),
            lastCheck: new Date().toISOString(),
            propagationStatus: 'pending',
            estimatedPropagationTime: '5-30 minutes'
        };
    } catch (error) {
        console.error('[Email DNS] Configuration failed:', {
            error: error.message,
            domain,
            stack: error.stack
        });
        
        return {
            dnsConfigured: false,
            error: error.message,
            manualSteps: `Please configure these DNS records manually: ${JSON.stringify(records)}`,
            lastCheck: new Date().toISOString()
        };
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
 * Check domain availability and get detailed information
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
        // 1. Check availability
        console.log(`[Domain API] Step 1: Checking availability for ${domain}`);
        const checkResult = await namecheapRequest('namecheap.domains.check', {
            DomainList: domain
        });

        const domainResult = checkResult.ApiResponse.CommandResponse.DomainCheckResult;
        const available = domainResult.$.Available === 'true';
        const isPremium = domainResult.$.IsPremiumName === 'true';
        const price = domainResult.$.Price ? parseFloat(domainResult.$.Price) : null;
        const premiumRegistrationPrice = domainResult.$.PremiumRegistrationPrice ? parseFloat(domainResult.$.PremiumRegistrationPrice) : null;
        const premiumRenewalPrice = domainResult.$.PremiumRenewalPrice ? parseFloat(domainResult.$.PremiumRenewalPrice) : null;
        const premiumTransferPrice = domainResult.$.PremiumTransferPrice ? parseFloat(domainResult.$.PremiumTransferPrice) : null;
        const icannFee = domainResult.$.IcannFee ? parseFloat(domainResult.$.IcannFee) : null;
        const eapFee = domainResult.$.EapFee ? parseFloat(domainResult.$.EapFee) : null;

        // pull the TLD (uppercase for API)
        const tld = domain.split('.').pop().toUpperCase();

        if (available) {
            // 2. If available → fetch pricing for that TLD
            console.log(`[Domain API] Step 2: Fetching pricing for TLD ${tld}`);
            const priceXml = await namecheapRequest('namecheap.users.getPricing', {
                ProductType: 'DOMAIN',
                ProductCategory: 'REGISTER',
                ProductName: tld
            });
            const pricing = extractOneYearPrice(priceXml);

            return res.json({
                status: "1",
                message: "Success",
                data: {
                    domain,
                    available: true,
                    isPremium,
                    status: "success",
                    pricing: pricing || {
                        register: null,
                        renew: null,
                        transfer: null,
                        icannFee: 0.18,
                        currency: 'USD'
                    },
                    apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
                }
            });
        } else {
            // 3. If not available → build suggestions and fetch each price
            const keyword = domain.split('.')[0];
            console.log(`[Domain API] Step 3: Generating suggestions for keyword "${keyword}"`);
            const suggestions = [];

            // Check base keyword with different TLDs
            await Promise.all(COMMON_TLDS.map(async (tld) => {
                const suggestionDomain = `${keyword}.${tld}`;
                if (suggestionDomain === domain) return;

                try {
                    const suggestionResult = await namecheapRequest('namecheap.domains.check', {
                        DomainList: suggestionDomain
                    });

                    const suggestionData = suggestionResult.ApiResponse.CommandResponse.DomainCheckResult;
                    const isAvailable = suggestionData.$.Available === 'true';
                    const isPremiumName = suggestionData.$.IsPremiumName === 'true';
                    const suggestionPrice = suggestionData.$.Price ? parseFloat(suggestionData.$.Price) : null;

                    if (isAvailable) {
                        // Only fetch pricing for available suggestions
                        const priceXml = await namecheapRequest('namecheap.users.getPricing', {
                            ProductType: 'DOMAIN',
                            ProductCategory: 'REGISTER',
                            ProductName: tld.toUpperCase()
                        });
                        const registerPrice = extractOneYearPrice(priceXml);

                        suggestions.push({
                            domain: suggestionDomain,
                            available: true,
                            isPremium: isPremiumName,
                            status: 'success',
                            pricing: {
                                register: suggestionPrice || premiumRegistrationPrice || registerPrice || null,
                                currency: 'USD'
                            }
                        });
                    }
                } catch (error) {
                    console.error(`[Domain API] Error checking suggestion ${suggestionDomain}:`, error.message);
                }
            }));

            return res.json({
                status: "1",
                message: "Success",
                data: {
                    domain,
                    available: false,
                    isPremium,
                    status: "success",
                    pricing: {
                        register: price || premiumRegistrationPrice || null,
                        renew: premiumRenewalPrice,
                        transfer: premiumTransferPrice,
                        icannFee,
                        eapFee,
                        currency: 'USD'
                    },
                    suggestedDomains: suggestions,
                    apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
                }
            });
        }
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
        return res.status(400).json({ 
            success: false, 
            error: 'Invalid domain format',
            details: 'Domain must be a valid format and support modern TLDs'
        });
    }

    try {
        // First check if domain is available
        console.log(`[Domain API] Checking availability for domain: ${domain}`);
        const checkResult = await namecheapRequest('namecheap.domains.check', {
            DomainList: domain
        });

        // Handle IP validation error specifically
        if (checkResult?.ApiResponse?.Errors?.Error) {
            const error = checkResult.ApiResponse.Errors.Error;
            if (error.includes('Invalid request IP')) {
                return res.status(403).json({
                    success: false,
                    error: 'API IP validation failed',
                    details: {
                        message: 'Your server IP is not whitelisted in Namecheap API settings',
                        steps: [
                            '1. Log in to your Namecheap account',
                            '2. Go to Account > API Access',
                            '3. Add your server IP to the whitelist',
                            '4. Wait 5-10 minutes for changes to take effect'
                        ],
                        currentIP: NAMECHEAP_CLIENT_IP
                    }
                });
            }
        }

        const domainResult = checkResult.ApiResponse.CommandResponse.DomainCheckResult;
        const isAvailable = domainResult.$.Available === 'true';
        const isPremium = domainResult.$.IsPremiumName === 'true';
        const price = domainResult.$.Price ? parseFloat(domainResult.$.Price) : null;
        const premiumRegistrationPrice = domainResult.$.PremiumRegistrationPrice ? parseFloat(domainResult.$.PremiumRegistrationPrice) : null;
        const premiumRenewalPrice = domainResult.$.PremiumRenewalPrice ? parseFloat(domainResult.$.PremiumRenewalPrice) : null;
        const premiumTransferPrice = domainResult.$.PremiumTransferPrice ? parseFloat(domainResult.$.PremiumTransferPrice) : null;
        const icannFee = domainResult.$.IcannFee ? parseFloat(domainResult.$.IcannFee) : null;
        const eapFee = domainResult.$.EapFee ? parseFloat(domainResult.$.EapFee) : null;

        if (!isAvailable) {
            return res.status(400).json({
                success: false,
                error: 'Domain is not available for registration',
                details: {
                    domain,
                    isPremium,
                    price,
                    premiumRegistrationPrice,
                    premiumRenewalPrice,
                    premiumTransferPrice,
                    icannFee,
                    eapFee
                }
            });
        }

        // Prepare registration parameters
        const registrationParams = {
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
        };

        // Proceed with domain registration
        console.log(`[Domain API] Proceeding with registration for domain: ${domain}`);
        const xml = await namecheapRequest('namecheap.domains.create', registrationParams);

        // Verify registration was successful
        if (xml?.ApiResponse?.CommandResponse?.DomainCreateResult?.$?.Registered !== 'true') {
            throw new Error('Domain registration failed');
        }

        const chargedAmount = parseFloat(xml.ApiResponse.CommandResponse.DomainCreateResult.$.ChargedAmount);
        const domainId = xml.ApiResponse.CommandResponse.DomainCreateResult.$.DomainID;
        const orderId = xml.ApiResponse.CommandResponse.DomainCreateResult.$.OrderID;
        const transactionId = xml.ApiResponse.CommandResponse.DomainCreateResult.$.TransactionID;

        // Set up DNS for email service
        console.log(`[Domain API] Setting up DNS for email service on ${domain}`);
        const emailSetup = await configureEmailDns(domain);

        // Get domain info for additional details
        const domainInfo = await namecheapRequest('namecheap.domains.getInfo', {
            DomainName: domain
        });

        const domainDetails = domainInfo.ApiResponse.CommandResponse.DomainGetInfoResult;
        
        // Safely extract dates and status with fallbacks
        const expirationDate = domainDetails?.DomainDetails?.CreatedDate ? 
            new Date(domainDetails.DomainDetails.CreatedDate).toISOString() : 
            new Date(Date.now() + (parseInt(years) * 365 * 24 * 60 * 60 * 1000)).toISOString();
            
        const whoisGuardStatus = domainDetails?.Whoisguard?.Enabled === 'ENABLED';

        res.json({
            success: true,
            domain,
            data: {
                registration: {
                    chargedAmount,
                    domainId,
                    orderId,
                    transactionId,
                    expirationDate,
                    whoisGuardStatus
                },
                emailSetup,
                pricing: {
                    registration: price || premiumRegistrationPrice,
                    renewal: premiumRenewalPrice,
                    transfer: premiumTransferPrice,
                    icannFee,
                    eapFee,
                    currency: 'USD'
                }
            },
            nextSteps: {
                dnsPropagation: {
                    status: 'pending',
                    checkEndpoint: `/namecheap/domain/${domain}/dns-status`,
                    estimatedTime: '5-30 minutes'
                },
                emailSetup: {
                    status: emailSetup.dnsConfigured ? 'ready' : 'manual_configuration_needed',
                    instructions: emailSetup.dnsConfigured ? 
                        'DNS records configured successfully. Wait for propagation before creating email accounts.' :
                        'Please configure DNS records manually for email service.'
                },
                whoisGuard: {
                    status: whoisGuardStatus ? 'enabled' : 'disabled',
                    email: email
                }
            },
            apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production',
            sandboxWarning: NAMECHEAP_SANDBOX === 'true' ? 
                'Running in sandbox mode - Domain registration is simulated' : null
        });
    } catch (err) {
        console.error('[Domain API] Registration error:', {
            error: err.message,
            domain,
            status: err.response?.status,
            responseData: err.response?.data,
            stack: err.stack
        });

        // Handle specific error cases
        if (err.message.includes('Invalid request IP')) {
            return res.status(403).json({
                success: false,
                error: 'API IP validation failed',
                details: {
                    message: 'Your server IP is not whitelisted in Namecheap API settings',
                    steps: [
                        '1. Log in to your Namecheap account',
                        '2. Go to Account > API Access',
                        '3. Add your server IP to the whitelist',
                        '4. Wait 5-10 minutes for changes to take effect'
                    ],
                    currentIP: NAMECHEAP_CLIENT_IP
                }
            });
        }

        res.status(500).json({
            success: false,
            error: err.message,
            details: err.response?.data?.error || null,
            apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
        });
    }
});

router.get('/namecheap/domains/list', async (req, res) => {
    try {
        console.log('[Domain API] 📋 Fetching all domains for user');

        // Make request to Namecheap API
        const response = await namecheapRequest('namecheap.domains.getList', {
            Page: '1',
            PageSize: '100' // Maximum allowed by Namecheap API
        });

        // Extract domains from response
        const domainResult = response.ApiResponse.CommandResponse.DomainGetListResult;
        
        // Handle empty domain list
        if (!domainResult || !domainResult.Domain) {
            return res.json({
                success: true,
                data: {
                    domains: [],
                    total: 0,
                    apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production',
                    sandboxWarning: NAMECHEAP_SANDBOX === 'true' ? 
                        'Running in sandbox mode - No domains found' : null
                }
            });
        }

        // If only one domain, convert to array
        const domains = Array.isArray(domainResult.Domain) ? domainResult.Domain : [domainResult.Domain];

        // Get detailed information for each domain
        const detailedDomains = await Promise.all(domains.map(async (domain) => {
            // Initialize domain object with basic information
            const domainObj = {
                name: domain.$.Name,
                created: domain.$.Created,
                expires: domain.$.Expires,
                autoRenew: domain.$.AutoRenew === 'true',
                isLocked: domain.$.IsLocked === 'true',
                id: domain.$.ID,
                whoisGuard: domain.$.WhoisGuard === 'ENABLED',
                isPremium: domain.$.IsPremium === 'true',
                details: {
                    redirects: [], // Initialize empty redirects array
                    mailboxes: [], // Initialize empty mailboxes array
                    dnsRecords: [], // Initialize empty DNS records array
                    nameservers: [] // Initialize empty nameservers array
                }
            };

            try {
                // Get domain info
                const domainInfo = await namecheapRequest('namecheap.domains.getInfo', {
                    DomainName: domain.$.Name
                });

                const domainResult = domainInfo.ApiResponse.CommandResponse.DomainGetInfoResult;

                // Update domain details with basic info
                domainObj.details.status = domainResult.$.Status;
                domainObj.details.isExpired = domainResult.$.IsExpired === 'true';
                domainObj.details.isLocked = domainResult.$.IsLocked === 'true';
                domainObj.details.isPremium = domainResult.$.IsPremium === 'true';
                
                // Use the isOurDNS value from getInfo instead of the list value
                domainObj.isOurDNS = domainResult.DnsDetails.$.IsUsingOurDNS === 'true';
                domainObj.details.isOurDNS = domainObj.isOurDNS;

                // Get nameservers
                const nameservers = domainResult.DnsDetails.Nameserver;
                domainObj.details.nameservers = Array.isArray(nameservers) ?
                    nameservers.map(ns => typeof ns === 'string' ? ns : ns.$.Name) :
                    [typeof nameservers === 'string' ? nameservers : nameservers.$.Name];

                // Debug logging for DNS status
                console.log(`[Domain API] DNS status for ${domain.$.Name}:`, {
                    isOurDNS: domainObj.isOurDNS,
                    dnsDetails: domainResult.DnsDetails,
                    sandboxMode: NAMECHEAP_SANDBOX === 'true'
                });

                // Only try to get hosts if using Namecheap DNS
                if (domainObj.isOurDNS) {
                    try {
                        const dnsHosts = await namecheapRequest('namecheap.domains.dns.getHosts', {
                            DomainName: domain.$.Name
                        });

                        // Debug logging for raw DNS response
                        console.log(`[Domain API] Raw DNS hosts response for ${domain.$.Name}:`, 
                            JSON.stringify(dnsHosts, null, 2));

                        // Extract hosts from response with proper null checks
                        const hostsResult = dnsHosts?.ApiResponse?.CommandResponse?.DomainDNSGetHostsResult;
                        let hostsList = [];

                        if (hostsResult?.host) {
                            // Handle both array and single record cases
                            hostsList = Array.isArray(hostsResult.host) ? 
                                hostsResult.host : 
                                [hostsResult.host];
                        }

                        // Debug logging for parsed hosts
                        console.log(`[Domain API] Parsed hosts for ${domain.$.Name}:`, hostsList);

                        // Extract redirect information with improved error handling
                        domainObj.details.redirects = hostsList
                            .filter(host => {
                                const type = host?.$?.Type;
                                return type && ['URL', 'URL301', 'URL302', 'FRAME'].includes(type);
                            })
                            .map(host => ({
                                type: host.$.Type,
                                address: host.$.Address || '',
                                title: host.$.Title || '',
                                keywords: host.$.Keywords || '',
                                description: host.$.Description || '',
                                ttl: host.$.TTL || '1800',
                                host: host.$.Name || host.$.HostName || '@'
                            }));

                        // Add all DNS records with improved error handling
                        domainObj.details.dnsRecords = hostsList
                            .filter(host => host?.$?.Type) // Only include records with a type
                            .map(host => ({
                                type: host.$.Type,
                                name: host.$.Name || host.$.HostName || '@',
                                address: host.$.Address || '',
                                ttl: host.$.TTL || '1800',
                                mxPref: host.$.MXPref || '',
                                associatedAppTitle: host.$.AssociatedAppTitle || ''
                            }));

                    } catch (hostsError) {
                        console.error(`[Domain API] Error fetching hosts for domain ${domain.$.Name}:`, {
                            error: hostsError.message,
                            code: hostsError.response?.status,
                            data: hostsError.response?.data,
                            stack: hostsError.stack
                        });
                        
                        domainObj.details.hostsError = {
                            message: hostsError.message,
                            code: hostsError.response?.status,
                            data: hostsError.response?.data
                        };
                    }
                } else if (NAMECHEAP_SANDBOX === 'true') {
                    // In sandbox mode, add mock data for testing
                    console.log(`[Domain API] Adding mock DNS data for ${domain.$.Name} in sandbox mode`);
                    domainObj.details.redirects = [{
                        type: 'URL301',
                        address: 'https://example.com',
                        title: 'Mock Redirect',
                        ttl: '1800',
                        host: '@'
                    }];
                    domainObj.details.dnsRecords = [
                        {
                            type: 'A',
                            name: '@',
                            address: '192.168.1.1',
                            ttl: '1800'
                        },
                        {
                            type: 'MX',
                            name: '@',
                            address: 'mail.example.com',
                            ttl: '3600',
                            mxPref: '10'
                        }
                    ];
                }

                // Add contact information
                domainObj.details.contacts = {
                    registrant: domainResult.Registrant,
                    tech: domainResult.Tech,
                    admin: domainResult.Admin,
                    auxBilling: domainResult.AuxBilling
                };

                return domainObj;

            } catch (domainErr) {
                console.error(`[Domain API] Error fetching details for domain ${domain.$.Name}:`, {
                    error: domainErr.message,
                    code: domainErr.response?.status,
                    data: domainErr.response?.data,
                    stack: domainErr.stack
                });
                
                domainObj.details.error = {
                    message: domainErr.message,
                    code: domainErr.response?.status,
                    data: domainErr.response?.data
                };
                
                return domainObj; // Return basic info if detailed fetch fails
            }
        }));

        res.json({
            success: true,
            data: {
                domains: detailedDomains,
                total: detailedDomains.length,
                apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production',
                sandboxWarning: NAMECHEAP_SANDBOX === 'true' ? 
                    'Running in sandbox mode - DNS data may not be accurate' : null
            }
        });
    } catch (err) {
        console.error('[Domain API] ❌ Error fetching domains:', {
            error: err.message,
            status: err.response?.status,
            responseData: err.response?.data,
            stack: err.stack
        });

        res.status(500).json({
            success: false,
            error: err.message,
            details: err.response?.data?.error || null,
            apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
        });
    }
});



router.post('/namecheap/domain/redirect', async (req, res) => {
    const {
        domain,
        destinationUrl,
        type = '301',
        masked = false,
        title = '',
        keywords = '',
        description = ''
    } = req.body;

    // Validate inputs
    if (!domain || !destinationUrl) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: domain and destinationUrl are required'
        });
    }

    // More robust URL validation
    try {
        new URL(destinationUrl);
    } catch (error) {
        return res.status(400).json({
            success: false,
            error: 'Invalid destination URL format'
        });
    }

    // Validate redirect type
    if (!['301', '302'].includes(type)) {
        return res.status(400).json({
            success: false,
            error: 'Redirect type must be either "301" or "302"'
        });
    }

    // Validate domain format
    const domainParts = domain.split('.');
    if (domainParts.length < 2) {
        return res.status(400).json({
            success: false,
            error: 'Invalid domain format'
        });
    }

    try {
        // 1. Verify domain ownership and get domain info
        console.log(`[Redirect API] Checking domain info for ${domain}`);
        const domainInfo = await namecheapRequest('namecheap.domains.getInfo', {
            DomainName: domain
        });

        const domainResult = domainInfo.ApiResponse.CommandResponse.DomainGetInfoResult;
        const isOurDNS = domainResult.DnsDetails.$.IsUsingOurDNS === 'true';
        const nameservers = domainResult.DnsDetails.Nameserver;
        const nameserverList = Array.isArray(nameservers) ? nameservers : [nameservers];

        if (!isOurDNS) {
            return res.status(400).json({
                success: false,
                error: 'Domain must use Namecheap DNS servers for URL forwarding',
                details: {
                    currentNameservers: nameserverList,
                    requiredNameservers: [
                        'dns1.registrar-servers.com',
                        'dns2.registrar-servers.com'
                    ]
                }
            });
        }

        // 2. Split domain into SLD and TLD
        const sld = domainParts.slice(0, -1).join('.');
        const tld = domainParts[domainParts.length - 1];

        // 3. Get existing DNS records to preserve non-conflicting ones
        console.log(`[Redirect API] Getting existing DNS records for ${domain}`);
        const existingRecords = await namecheapRequest('namecheap.domains.dns.getHosts', {
            SLD: sld,
            TLD: tld
        });

        const currentHosts = existingRecords.ApiResponse.CommandResponse.DomainDNSGetHostsResult.host || [];
        const hostsArray = Array.isArray(currentHosts) ? currentHosts : [currentHosts];

        // 4. Filter out existing @ records that conflict with redirect
        const preservedRecords = hostsArray.filter(record => {
            const hostName = record.$.Name;
            const recordType = record.$.Type;
            
            // Remove existing @ records that are A, CNAME, URL301, URL302, or FRAME
            if (hostName === '@' && ['A', 'CNAME', 'URL301', 'URL302', 'FRAME'].includes(recordType)) {
                return false;
            }
            return true;
        }).map(record => ({
            HostName: record.$.Name,
            RecordType: record.$.Type,
            Address: record.$.Address,
            TTL: record.$.TTL || '1800',
            ...(record.$.MXPref && { MXPref: record.$.MXPref })
        }));

        // 5. Create redirect records
        console.log(`[Redirect API] Setting up redirect for ${domain} to ${destinationUrl}`);
        const redirectRecords = [];

        if (masked) {
            // For masked redirect, use FRAME record
            redirectRecords.push({
                HostName: '@',
                RecordType: 'FRAME',
                Address: destinationUrl,
                TTL: '1800',
                Title: title || domain,
                Keywords: keywords,
                Description: description
            });
        } else {
            // For regular redirect, use URL301 or URL302
            redirectRecords.push({
                HostName: '@',
                RecordType: type === '301' ? 'URL301' : 'URL302',
                Address: destinationUrl,
                TTL: '1800'
            });
        }

        // 6. Combine preserved records with new redirect records
        const allRecords = [...preservedRecords, ...redirectRecords];

        // Ensure we have at least one record (Namecheap requirement)
        if (allRecords.length === 0) {
            allRecords.push({
                HostName: '@',
                RecordType: 'A',
                Address: '192.0.2.1', // RFC5737 test address
                TTL: '1800'
            });
        }

        console.log(`[Redirect API] Updating DNS with ${allRecords.length} records`);

        // 7. Update DNS records
        const updateResponse = await namecheapRequest('namecheap.domains.dns.setHosts', {
            SLD: sld,
            TLD: tld,
            Hosts: JSON.stringify(allRecords)
        });

        // 8. Verify update was successful
        if (updateResponse.ApiResponse.$.Status !== 'OK') {
            const errors = updateResponse.ApiResponse.Errors?.Error;
            const errorMessage = Array.isArray(errors) ? errors.map(e => e._).join(', ') : errors?.$_ || 'Unknown error';
            throw new Error(`Failed to update DNS records: ${errorMessage}`);
        }

        // 9. Log success and return response
        console.log(`[Redirect API] Successfully updated redirect for ${domain}`);
        
        res.json({
            success: true,
            data: {
                domain,
                destinationUrl,
                type,
                masked,
                message: 'Domain redirect updated successfully',
                timestamp: new Date().toISOString(),
                nameservers: nameserverList,
                recordsUpdated: allRecords.length,
                preservedRecords: preservedRecords.length
            }
        });

    } catch (error) {
        console.error(`[Redirect Error] Domain: ${domain}`, {
            error: error.message,
            stack: error.stack,
            response: error.response?.data
        });

        // Handle specific error cases
        if (error.message.includes('Domain name not found') || error.message.includes('Domain not found')) {
            return res.status(404).json({
                success: false,
                error: 'Domain not found in your Namecheap account',
                domain,
                details: 'Please verify the domain is registered with your Namecheap account'
            });
        }

        if (error.message.includes('Invalid domain name')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid domain name format',
                domain,
                details: 'Please check the domain name spelling and format'
            });
        }

        if (error.message.includes('Authentication failed')) {
            return res.status(401).json({
                success: false,
                error: 'Namecheap API authentication failed',
                details: 'Please check your API credentials'
            });
        }

        res.status(500).json({
            success: false,
            error: error.message,
            domain,
            details: error.response?.data || null,
            timestamp: new Date().toISOString()
        });
    }
});


router.get('/namecheap/domain/redirects/:domain', async (req, res) => {
    const { domain } = req.params;

    try {
        // 1. Get domain info first
        const domainInfo = await namecheapRequest('namecheap.domains.getInfo', {
            DomainName: domain
        });

        const domainResult = domainInfo.ApiResponse.CommandResponse.DomainGetInfoResult;
        const isOurDNS = domainResult.DnsDetails.$.IsUsingOurDNS === 'true';
        
        if (!isOurDNS) {
            return res.status(400).json({
                success: false,
                error: 'Domain must use Namecheap DNS servers',
                currentNameservers: domainResult.DnsDetails.Nameserver
            });
        }

        // 2. Try to get DNS hosts
        let redirects = [];
        try {
            const dnsHosts = await namecheapRequest('namecheap.domains.dns.getHosts', {
                DomainName: domain
            });

            const hosts = dnsHosts.ApiResponse.CommandResponse?.DomainDNSGetHostsResult?.host;
            const hostsList = hosts ? (Array.isArray(hosts) ? hosts : [hosts]) : [];

            redirects = hostsList
                .filter(host => host.$ && ['URL', 'URL301', 'URL302', 'FRAME'].includes(host.$.Type))
                .map(host => ({
                    type: host.$.Type,
                    address: host.$.Address,
                    title: host.$.Title || '',
                    keywords: host.$.Keywords || '',
                    description: host.$.Description || '',
                    ttl: host.$.TTL,
                    host: host.$.Name || '@'
                }));

        } catch (error) {
            if (NAMECHEAP_SANDBOX === 'true') {
                console.warn('Sandbox mode - returning empty redirects');
                redirects = [];
            } else {
                throw error;
            }
        }

        res.json({
            success: true,
            data: {
                domain,
                redirects,
                count: redirects.length,
                isOurDNS: true,
                sandboxMode: NAMECHEAP_SANDBOX === 'true',
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error(`Error fetching redirects for ${domain}:`, error);
        
        if (error.message.includes('Domain name not found')) {
            return res.status(404).json({
                success: false,
                error: 'Domain not found in your Namecheap account'
            });
        }

        res.status(500).json({
            success: false,
            error: error.message,
            details: error.response?.data || null
        });
    }
});

/**
 * Set up DNS management for a domain
 */
router.post('/namecheap/domain/dns/setup', async (req, res) => {
    const { domain } = req.body;

    if (!domain) {
        return res.status(400).json({
            success: false,
            error: 'Domain is required'
        });
    }

    try {
        // Split domain into SLD and TLD
        const [sld, tld] = domain.split('.');

        // Set to Namecheap DNS servers
        const response = await namecheapRequest('namecheap.domains.dns.setDefault', {
            SLD: sld,
            TLD: tld
        });

        // Verify the response - Updated to match actual API response structure
        if (response?.ApiResponse?.CommandResponse?.DomainDNSSetDefaultResult?.$.Updated !== 'true') {
            throw new Error('Failed to set DNS servers');
        }

        res.json({
            success: true,
            message: 'DNS servers set to default',
            data: {
                domain,
                nameservers: [
                    'dns1.registrar-servers.com',
                    'dns2.registrar-servers.com'
                ],
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('[DNS API] Error setting up DNS:', {
            error: error.message,
            domain,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            error: error.message,
            details: error.response?.data || null
        });
    }
});

/**
 * Get detailed domain status and configuration
 */
router.get('/namecheap/domain/:domain/status', async (req, res) => {
    const { domain } = req.params;

    if (!domain) {
        return res.status(400).json({
            success: false,
            error: 'Domain is required'
        });
    }

    try {
        // Get domain info
        const domainInfo = await namecheapRequest('namecheap.domains.getInfo', {
            DomainName: domain
        });

        const result = domainInfo.ApiResponse.CommandResponse.DomainGetInfoResult;
        const dnsDetails = result.DnsDetails;
        const domainDetails = result.DomainDetails;

        // Get registrar lock status
        const lockInfo = await namecheapRequest('namecheap.domains.getRegistrarLock', {
            DomainName: domain
        });

        // Get privacy protection status
        const privacyInfo = await namecheapRequest('namecheap.domains.getPrivacy', {
            DomainName: domain
        });

        res.json({
            success: true,
            data: {
                domain,
                status: {
                    registration: result.$.Status,
                    isLocked: result.$.IsLocked === 'true',
                    autoRenew: result.$.AutoRenew === 'true',
                    isExpired: result.$.IsExpired === 'true',
                    isPremium: result.$.IsPremium === 'true'
                },
                dns: {
                    isUsingOurDNS: dnsDetails.$.IsUsingOurDNS === 'true',
                    nameservers: Array.isArray(dnsDetails.Nameserver) 
                        ? dnsDetails.Nameserver 
                        : [dnsDetails.Nameserver]
                },
                dates: {
                    created: domainDetails.$.CreatedDate,
                    expires: domainDetails.$.ExpiredDate,
                    lastRenewed: domainDetails.$.LastRenewedDate
                },
                security: {
                    registrarLock: lockInfo.ApiResponse.CommandResponse.DomainGetRegistrarLockResult.$.Status === 'true',
                    privacyProtection: privacyInfo.ApiResponse.CommandResponse.DomainGetPrivacyResult.$.Status === 'true'
                },
                contacts: {
                    registrant: result.Registrant,
                    tech: result.Tech,
                    admin: result.Admin,
                    auxBilling: result.AuxBilling
                },
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('[Domain API] Error getting domain status:', {
            error: error.message,
            domain,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            error: error.message,
            details: error.response?.data || null
        });
    }
});

/**
 * Manage domain auto-renewal
 */
router.put('/namecheap/domain/:domain/auto-renew', async (req, res) => {
    const { domain } = req.params;
    const { autoRenew } = req.body;

    if (!domain) {
        return res.status(400).json({
            success: false,
            error: 'Domain is required'
        });
    }

    if (typeof autoRenew !== 'boolean') {
        return res.status(400).json({
            success: false,
            error: 'Auto-renew status must be a boolean'
        });
    }

    try {
        // Get current domain info
        const domainInfo = await namecheapRequest('namecheap.domains.getInfo', {
            DomainName: domain
        });

        const result = domainInfo.ApiResponse.CommandResponse.DomainGetInfoResult;
        const currentAutoRenew = result.$.AutoRenew === 'true';

        // Only update if the status is different
        if (currentAutoRenew !== autoRenew) {
            const response = await namecheapRequest('namecheap.domains.setAutoRenew', {
                DomainName: domain,
                AutoRenew: autoRenew ? 'true' : 'false'
            });

            if (response?.ApiResponse?.CommandResponse?.DomainSetAutoRenewResult?.$.IsSuccess !== 'true') {
                throw new Error('Failed to update auto-renewal status');
            }
        }

        res.json({
            success: true,
            message: `Auto-renewal ${autoRenew ? 'enabled' : 'disabled'} successfully`,
            data: {
                domain,
                autoRenew,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('[Domain API] Error updating auto-renewal:', {
            error: error.message,
            domain,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            error: error.message,
            details: error.response?.data || null
        });
    }
});
/**
 *  _____________________________Check DNS propagation status for a domain _____________________________
 */
router.get('/namecheap/domain/:domain/dns-status', async (req, res) => {
    const { domain } = req.params;
    
    if (!domain) {
        return res.status(400).json({
            success: false,
            error: 'Domain is required'
        });
    }

    try {
        // Use DNS lookup to verify propagation
        const dns = require('dns').promises;
        const mxRecords = await dns.resolveMx(domain);
        
        const isPropagated = mxRecords.some(record => 
            record.exchange.includes('privateemail.com')
        );
        
        res.json({
            success: true,
            data: {
                domain,
                propagated: isPropagated,
                mxRecords,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('[DNS Status] Error checking propagation:', {
            error: error.message,
            domain,
            stack: error.stack
        });

        res.json({
            success: false,
            data: {
                domain,
                propagated: false,
                error: error.message,
                timestamp: new Date().toISOString()
            }
        });
    }
});

/**
 * _____________________________Create an email mailbox _____________________________
 */
router.post('/namecheap/domain/:domain/createemail', asyncHandler(async (req, res) => {
    const { domain } = req.params;
    const { username, password, quota = 500 } = req.body;

    // Validate inputs
    if (!username || !password) {
        return res.status(400).json({
            success: false,
            error: 'Username and password are required'
        });
    }

    // Validate password strength
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        return res.status(400).json({
            success: false,
            error: 'Password must be at least 8 characters and contain uppercase, lowercase, and numbers'
        });
    }

    try {
        // 1. Verify domain ownership and DNS setup
        const domainInfo = await namecheapRequest('namecheap.domains.getInfo', {
            DomainName: domain
        });

        const domainResult = domainInfo.ApiResponse.CommandResponse.DomainGetInfoResult;
        const isOurDNS = domainResult.DnsDetails.$.IsUsingOurDNS === 'true';

        if (!isOurDNS) {
            return res.status(400).json({
                success: false,
                error: 'Domain must use Namecheap DNS servers for email setup',
                details: {
                    currentNameservers: domainResult.DnsDetails.Nameserver,
                    requiredNameservers: [
                        'dns1.registrar-servers.com',
                        'dns2.registrar-servers.com'
                    ]
                }
            });
        }

        // 2. Configure email DNS if not already set up
        const emailSetup = await configureEmailDns(domain);
        if (!emailSetup.dnsConfigured) {
            return res.status(400).json({
                success: false,
                error: 'Email DNS configuration failed',
                details: emailSetup
            });
        }

        // 3. Create email account using cPanel API
        const emailAddress = `${username}@${domain}`;
        const cpanelResponse = await cpanelRequest('Email/add_pop', {
            email: username,
            domain: domain,
            password,
            quota: quota.toString()
        });

        if (!cpanelResponse.status) {
            throw new Error(cpanelResponse.errors?.[0] || 'Failed to create email account');
        }

        // 4. Log the email creation
        console.log(`[Email API] Created email ${emailAddress}`, {
            timestamp: new Date().toISOString(),
            domain,
            username,
            quota
        });

        res.json({
            success: true,
            data: {
                email: emailAddress,
                quota,
                status: 'active',
                dnsStatus: emailSetup,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('[Email API] Error creating email:', {
            error: error.message,
            domain,
            username,
            stack: error.stack
        });

        // Handle specific error cases
        if (error.message.includes('already exists')) {
            return res.status(409).json({
                success: false,
                error: 'Email account already exists',
                details: 'Please choose a different username'
            });
        }

        if (error.message.includes('Invalid domain')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid domain for email creation',
                details: 'The domain must be properly configured on the server'
            });
        }

        throw error; // Let the error handler middleware handle it
    }
}));

/**
 * List email accounts for a domain
 */
router.get('/namecheap/domain/:domain/emails', asyncHandler(async (req, res) => {
    const { domain } = req.params;

    try {
        // 1. Get domain info to verify ownership
        const domainInfo = await namecheapRequest('namecheap.domains.getInfo', {
            DomainName: domain
        });

        const domainResult = domainInfo.ApiResponse.CommandResponse.DomainGetInfoResult;
        const isOurDNS = domainResult.DnsDetails.$.IsUsingOurDNS === 'true';

        if (!isOurDNS) {
            return res.status(400).json({
                success: false,
                error: 'Domain must use Namecheap DNS servers',
                currentNameservers: domainResult.DnsDetails.Nameserver
            });
        }

        // 2. Get email accounts using cPanel API
        const cpanelResponse = await cpanelRequest('Email/list_pops', {
            domain
        });

        if (!cpanelResponse.status) {
            throw new Error(cpanelResponse.errors?.[0] || 'Failed to list email accounts');
        }

        // 3. Format email accounts data
        const emailAccounts = cpanelResponse.data.map(account => ({
            username: account.user,
            email: account.email,
            quota: parseInt(account.quota) || 0,
            used: parseInt(account.used) || 0,
            suspended: account.suspended === '1',
            created: account.created,
            lastLogin: account.last_login || null
        }));

        res.json({
            success: true,
            data: {
                domain,
                accounts: emailAccounts,
                count: emailAccounts.length,
                isOurDNS: true,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('[Email API] Error listing emails:', {
            error: error.message,
            domain,
            stack: error.stack
        });

        // Handle specific error cases
        if (error.message.includes('Domain not found')) {
            return res.status(404).json({
                success: false,
                error: 'Domain not found on server',
                details: 'Please ensure the domain is properly configured'
            });
        }

        throw error; // Let the error handler middleware handle it
    }
}));

/**
 * Configure email DNS records with WHM integration
 */
router.post('/dns/configure-email-dns', async (req, res) => {
  const { domain, dmarcEmail = `dmarc@${domain}` } = req.body;

  if (!domain) {
    return res.status(400).json({ success: false, error: 'Missing domain' });
  }

  try {
    // Get server IP
    const ipResponse = await axios.get('https://api.ipify.org?format=json');
    const ip = ipResponse.data.ip;

    // Get DKIM public key from WHM
    const dkimPublicKey = await getDkimPublicKey(domain);

    if (!dkimPublicKey) {
      return res.status(500).json({ success: false, error: 'Failed to fetch DKIM public key from WHM' });
    }

    // DNS records
    const records = [
      { HostName: '@', RecordType: 'A', Address: ip, TTL: '1800' },
      { HostName: '@', RecordType: 'MX', Address: `mail.${domain}`, MXPref: '10', TTL: '1800' },
      { HostName: '@', RecordType: 'TXT', Address: `v=spf1 a mx ip4:${ip} ~all`, TTL: '1800' },
      {
        HostName: 'default._domainkey',
        RecordType: 'TXT',
        Address: `v=DKIM1; k=rsa; p=${dkimPublicKey}`,
        TTL: '1800'
      },
      {
        HostName: '_dmarc',
        RecordType: 'TXT',
        Address: `v=DMARC1; p=none; rua=mailto:${dmarcEmail}`,
        TTL: '1800'
      }
    ];

    const [sld, ...tldParts] = domain.split('.');
    const tld = tldParts.join('.');

    const formattedParams = {
      SLD: sld,
      TLD: tld
    };

    records.forEach((record, i) => {
      formattedParams[`HostName${i + 1}`] = record.HostName;
      formattedParams[`RecordType${i + 1}`] = record.RecordType;
      formattedParams[`Address${i + 1}`] = record.Address;
      formattedParams[`TTL${i + 1}`] = record.TTL;
      if (record.RecordType === 'MX') {
        formattedParams[`MXPref${i + 1}`] = record.MXPref;
      }
    });

    const result = await namecheapRequest('namecheap.domains.dns.setHosts', {
      DomainName: domain,
      ...formattedParams
    });

    const success =
      result?.ApiResponse?.CommandResponse?.DomainDNSSetHostsResult?.$?.IsSuccess === 'true';

    if (!success) {
      return res.status(500).json({ success: false, error: 'Failed to set DNS records', response: result });
    }

    return res.json({
      success: true,
      domain,
      ip,
      dkimPublicKey,
      records
    });
  } catch (err) {
    console.error('[DNS CONFIG ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Helper function to get DKIM public key from WHM
async function getDkimPublicKey(domain) {
    const WHM_HOST = process.env.WHM_URL.startsWith('http') ? 
        process.env.WHM_URL : 
        `https://${process.env.WHM_URL}`;
    
    const url = `${WHM_HOST}/json-api/get_email_dkim?api.version=1&domain=${domain}`;

    try {
        const response = await axios.get(url, {
            headers: {
                Authorization: `WHM ${WHM_USERNAME}:${WHM_TOKEN}`
            },
            timeout: 10000 // 10 second timeout
        });

        if (!response.data || response.data.status === 0 || response.data.error) {
            throw new Error(response.data.error || response.data.errors?.[0] || 'Failed to fetch DKIM key');
        }

        return response.data?.data?.dkim?.public_key || null;
    } catch (error) {
        console.error('[DKIM API] Error fetching public key:', {
            error: error.message,
            domain,
            response: error.response?.data
        });
        throw error;
    }
}

module.exports = router;