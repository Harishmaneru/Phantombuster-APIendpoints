require('dotenv').config();
const axios = require('axios');
const express = require('express');
const xml2js = require('xml2js');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoose = require('mongoose');
const router = express.Router();

// MongoDB Connection
const mongoURI = process.env.ONEPGR_MONGO_URI;

const connectToMongoDB = async () => {
    try {
        if (mongoose.connection.readyState === 1) {
            console.log('[Namecheap API] MongoDB already connected');
            return;
        }

        await mongoose.connect(mongoURI, {
            dbName: 'onepgr_apps',
            serverSelectionTimeoutMS: 15000,
            socketTimeoutMS: 45000,
            maxPoolSize: 10
        });
        console.log('[Namecheap API] Connected to MongoDB onepgr_apps database');
    } catch (error) {
        console.error('[Namecheap API] MongoDB connection error:', error);
        throw error;
    }
};

// Initialize MongoDB connection
connectToMongoDB();

// Domain Schema for storing user domain data
const domainSchema = new mongoose.Schema({
    userId: { 
        type: String, 
        required: true, 
        index: true 
    },
    domain: { 
        type: String, 
        required: true, 
        lowercase: true,
        index: true 
    },
    registrationData: {
        domainId: String,
        orderId: String,
        transactionId: String,
        chargedAmount: Number,
        registrationDate: { type: Date, default: Date.now },
        expirationDate: Date,
        years: { type: Number, default: 1 }
    },
    contactInfo: {
        firstName: String,
        lastName: String,
        email: String,
        phone: String,
        address1: String,
        address2: String,
        city: String,
        stateProvince: String,
        country: String,
        postalCode: String
    },
    domainStatus: {
        isActive: { type: Boolean, default: true },
        isLocked: { type: Boolean, default: false },
        autoRenew: { type: Boolean, default: false },
        whoisGuardEnabled: { type: Boolean, default: false },
        isPremium: { type: Boolean, default: false },
        status: { type: String, default: 'active' }
    },
    dnsConfiguration: {
        isUsingNamecheapDNS: { type: Boolean, default: true },
        nameservers: [String],
        emailDNSConfigured: { type: Boolean, default: false },
        emailDNSConfiguredAt: Date,
        lastDNSUpdate: Date
    },
    redirects: [{
        type: { type: String, enum: ['URL301', 'URL302', 'FRAME'] },
        destinationUrl: String,
        masked: { type: Boolean, default: false },
        title: String,
        keywords: String,
        description: String,
        createdAt: { type: Date, default: Date.now }
    }],
    emailAccounts: [{
        username: String,
        email: String,
        quota: { type: Number, default: 500 },
        createdAt: { type: Date, default: Date.now },
        suspended: { type: Boolean, default: false }
    }],
    pricing: {
        registrationPrice: Number,
        renewalPrice: Number,
        transferPrice: Number,
        icannFee: Number,
        currency: { type: String, default: 'USD' }
    },
    apiMode: { 
        type: String, 
        enum: ['sandbox', 'production'], 
        default: process.env.NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production' 
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, {
    collection: 'namecheap_domains',
    timestamps: true
});

// Compound index for efficient queries
domainSchema.index({ userId: 1, domain: 1 }, { unique: true });
domainSchema.index({ userId: 1, createdAt: -1 });

// Domain model
const NamecheapDomain = mongoose.model('NamecheapDomain', domainSchema);

// Middleware to ensure database connection
const ensureDbConnection = async (req, res, next) => {
    try {
        await connectToMongoDB();
        next();
    } catch (error) {
        console.error('[Namecheap API] Database connection failed:', error);
        res.status(500).json({
            success: false,
            error: 'Database connection failed',
            details: error.message
        });
    }
};

// Middleware to validate userId
const validateUserId = (req, res, next) => {
    const userId = req.body.userId || req.query.userId || req.params.userId;
    
    if (!userId) {
        return res.status(400).json({
            success: false,
            error: 'User ID is required',
            details: 'Please provide userId in request body, query parameters, or URL path'
        });
    }
    
    // Add userId to request object for easy access
    req.userId = userId;
    next();
};

// Helper function to save domain to database
async function saveDomainToDatabase(userId, domainData) {
    try {
        const existingDomain = await NamecheapDomain.findOne({
            userId,
            domain: domainData.domain.toLowerCase()
        });

        if (existingDomain) {
            // Update existing domain
            const updatedDomain = await NamecheapDomain.findOneAndUpdate(
                { userId, domain: domainData.domain.toLowerCase() },
                { 
                    ...domainData,
                    updatedAt: new Date()
                },
                { new: true, upsert: false }
            );
            console.log('[Database] Domain updated:', updatedDomain.domain);
            return updatedDomain;
        } else {
            // Create new domain record
            const newDomain = new NamecheapDomain({
                userId,
                ...domainData
            });
            const savedDomain = await newDomain.save();
            console.log('[Database] New domain saved:', savedDomain.domain);
            return savedDomain;
        }
    } catch (error) {
        console.error('[Database] Error saving domain:', error);
        throw error;
    }
}

// Helper function to get user domains from database
async function getUserDomainsFromDatabase(userId, filters = {}) {
    try {
        const query = { userId, ...filters };
        const domains = await NamecheapDomain.find(query)
            .sort({ createdAt: -1 })
            .lean();
        
        console.log(`[Database] Retrieved ${domains.length} domains for user ${userId}`);
        return domains;
    } catch (error) {
        console.error('[Database] Error retrieving domains:', error);
        throw error;
    }
}

// Helper function to update domain in database
async function updateDomainInDatabase(userId, domain, updateData) {
    try {
        const updatedDomain = await NamecheapDomain.findOneAndUpdate(
            { userId, domain: domain.toLowerCase() },
            { 
                ...updateData,
                updatedAt: new Date()
            },
            { new: true }
        );
        
        if (!updatedDomain) {
            throw new Error('Domain not found for this user');
        }
        
        console.log('[Database] Domain updated:', updatedDomain.domain);
        return updatedDomain;
    } catch (error) {
        console.error('[Database] Error updating domain:', error);
        throw error;
    }
}

// Apply database connection middleware to all routes
router.use(ensureDbConnection);

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
router.post('/namecheap/domain/register', validateUserId, async (req, res) => {
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

    // userId is already validated and available in req.userId
    const userId = req.userId;

    // Validate required fields
    if (!domain || !firstName || !lastName || !email || !phone || !address1 || !city || !stateProvince || !country || !postalCode) {
        return res.status(400).json({
            success: false,
            error: 'Missing required registration fields',
            required: ['userId', 'domain', 'firstName', 'lastName', 'email', 'phone', 'address1', 'city', 'stateProvince', 'country', 'postalCode']
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
        // Check if domain already exists for this user
        const existingDomain = await NamecheapDomain.findOne({
            userId,
            domain: domain.toLowerCase()
        });

        if (existingDomain) {
            return res.status(400).json({
                success: false,
                error: 'Domain already registered for this user',
                details: {
                    domain,
                    registrationDate: existingDomain.registrationData.registrationDate,
                    expirationDate: existingDomain.registrationData.expirationDate
                }
            });
        }

        // First check if domain is available
        console.log(`[Domain API] Checking availability for domain: ${domain} (User: ${userId})`);
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
        console.log(`[Domain API] Proceeding with registration for domain: ${domain} (User: ${userId})`);
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

        // Prepare domain data for database
        const domainData = {
            domain: domain.toLowerCase(),
            registrationData: {
                domainId,
                orderId,
                transactionId,
                chargedAmount,
                registrationDate: new Date(),
                expirationDate: new Date(expirationDate),
                years: parseInt(years)
            },
            contactInfo: {
                firstName,
                lastName,
                email,
                phone,
                address1,
                address2,
                city,
                stateProvince,
                country,
                postalCode
            },
            domainStatus: {
                isActive: true,
                isLocked: false,
                autoRenew: false,
                whoisGuardEnabled: whoisGuardStatus,
                isPremium,
                status: 'active'
            },
            dnsConfiguration: {
                isUsingNamecheapDNS: true,
                nameservers: ['dns1.registrar-servers.com', 'dns2.registrar-servers.com'],
                emailDNSConfigured: emailSetup.dnsConfigured,
                emailDNSConfiguredAt: emailSetup.dnsConfigured ? new Date() : null,
                lastDNSUpdate: new Date()
            },
            pricing: {
                registrationPrice: price || premiumRegistrationPrice,
                renewalPrice: premiumRenewalPrice,
                transferPrice: premiumTransferPrice,
                icannFee,
                currency: 'USD'
            },
            apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
        };

        // Save domain to database
        const savedDomain = await saveDomainToDatabase(userId, domainData);

        res.json({
            success: true,
            userId,
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
                },
                databaseRecord: {
                    _id: savedDomain._id,
                    createdAt: savedDomain.createdAt
                }
            },
            nextSteps: {
                dnsPropagation: {
                    status: 'pending',
                    checkEndpoint: `/namecheap/domain/${domain}/dns-status?userId=${userId}`,
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

router.get('/namecheap/domains/list', validateUserId, async (req, res) => {
    const userId = req.userId;
    
    try {
        console.log(`[Domain API] 📋 Fetching domains for user: ${userId}`);

        // Get user domains from database
        const userDomains = await getUserDomainsFromDatabase(userId);

        if (userDomains.length === 0) {
            return res.json({
                success: true,
                userId,
                data: {
                    domains: [],
                    total: 0,
                    message: 'No domains found for this user',
                    apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
                }
            });
        }

        // For each domain in database, get live status from Namecheap API
        const detailedDomains = await Promise.all(userDomains.map(async (dbDomain) => {
            const domainObj = {
                // Database information
                _id: dbDomain._id,
                userId: dbDomain.userId,
                domain: dbDomain.domain,
                registrationData: dbDomain.registrationData,
                contactInfo: dbDomain.contactInfo,
                domainStatus: dbDomain.domainStatus,
                dnsConfiguration: dbDomain.dnsConfiguration,
                redirects: dbDomain.redirects || [],
                emailAccounts: dbDomain.emailAccounts || [],
                pricing: dbDomain.pricing,
                createdAt: dbDomain.createdAt,
                updatedAt: dbDomain.updatedAt,
                
                // Initialize live status
                liveStatus: {
                    available: false,
                    error: null,
                    lastChecked: new Date().toISOString()
                }
            };

            try {
                // Get live domain info from Namecheap (optional - can be disabled for performance)
                const domainInfo = await namecheapRequest('namecheap.domains.getInfo', {
                    DomainName: dbDomain.domain
                });

                const namecheapResult = domainInfo.ApiResponse.CommandResponse.DomainGetInfoResult;

                // Update live status from Namecheap API
                domainObj.liveStatus = {
                    available: true,
                    status: namecheapResult.$.Status,
                    isExpired: namecheapResult.$.IsExpired === 'true',
                    isLocked: namecheapResult.$.IsLocked === 'true',
                    autoRenew: namecheapResult.$.AutoRenew === 'true',
                    isPremium: namecheapResult.$.IsPremium === 'true',
                    lastChecked: new Date().toISOString(),
                    nameservers: Array.isArray(namecheapResult.DnsDetails.Nameserver) 
                        ? namecheapResult.DnsDetails.Nameserver 
                        : [namecheapResult.DnsDetails.Nameserver],
                    isUsingNamecheapDNS: namecheapResult.DnsDetails.$.IsUsingOurDNS === 'true'
                };

                // Update database with live information if there are significant changes
                const updateData = {};
                let needsUpdate = false;

                if (domainObj.domainStatus.autoRenew !== (namecheapResult.$.AutoRenew === 'true')) {
                    updateData['domainStatus.autoRenew'] = namecheapResult.$.AutoRenew === 'true';
                    needsUpdate = true;
                }

                if (domainObj.domainStatus.isLocked !== (namecheapResult.$.IsLocked === 'true')) {
                    updateData['domainStatus.isLocked'] = namecheapResult.$.IsLocked === 'true';
                    needsUpdate = true;
                }

                if (needsUpdate) {
                    await updateDomainInDatabase(userId, dbDomain.domain, updateData);
                    console.log(`[Domain API] Updated live status for ${dbDomain.domain}`);
                }

            } catch (namecheapError) {
                console.error(`[Domain API] Error fetching live status for ${dbDomain.domain}:`, {
                    error: namecheapError.message,
                    userId,
                    domain: dbDomain.domain
                });
                
                domainObj.liveStatus = {
                    available: false,
                    error: namecheapError.message,
                    lastChecked: new Date().toISOString(),
                    note: 'Using cached database information'
                };
            }

            return domainObj;
        }));

        // Sort domains by creation date (newest first)
        detailedDomains.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json({
            success: true,
            userId,
            data: {
                domains: detailedDomains,
                total: detailedDomains.length,
                apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production',
                dataSource: 'database_with_live_sync',
                lastSync: new Date().toISOString(),
                sandboxWarning: NAMECHEAP_SANDBOX === 'true' ? 
                    'Running in sandbox mode - Live status may not be accurate' : null
            }
        });

    } catch (err) {
        console.error('[Domain API] ❌ Error fetching user domains:', {
            error: err.message,
            userId,
            stack: err.stack
        });

        res.status(500).json({
            success: false,
            userId,
            error: err.message,
            details: 'Failed to fetch user domains from database',
            apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
        });
    }
});



router.post('/namecheap/domain/redirect', validateUserId, async (req, res) => {
    const {
        domain,
        destinationUrl,
        type = '301',
        masked = false,
        title = '',
        keywords = '',
        description = ''
    } = req.body;

    const userId = req.userId;

    // Validate inputs
    if (!domain || !destinationUrl) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: userId, domain and destinationUrl are required'
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
        // 1. Verify domain ownership through database
        const userDomain = await NamecheapDomain.findOne({
            userId,
            domain: domain.toLowerCase()
        });

        if (!userDomain) {
            return res.status(404).json({
                success: false,
                error: 'Domain not found for this user',
                details: 'Please ensure the domain is registered under your account'
            });
        }

        console.log(`[Redirect API] Setting up redirect for ${domain} (User: ${userId})`);

        // 2. Verify domain ownership and get domain info from Namecheap
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

        // 3. Split domain into SLD and TLD
        const sld = domainParts.slice(0, -1).join('.');
        const tld = domainParts[domainParts.length - 1];

        // 4. Get existing DNS records to preserve non-conflicting ones
        console.log(`[Redirect API] Getting existing DNS records for ${domain}`);
        const existingRecords = await namecheapRequest('namecheap.domains.dns.getHosts', {
            SLD: sld,
            TLD: tld
        });

        const currentHosts = existingRecords.ApiResponse.CommandResponse.DomainDNSGetHostsResult.host || [];
        const hostsArray = Array.isArray(currentHosts) ? currentHosts : [currentHosts];

        // 5. Filter out existing @ records that conflict with redirect
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

        // 6. Create redirect records
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

        // 7. Combine preserved records with new redirect records
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

        // 8. Update DNS records
        const updateResponse = await namecheapRequest('namecheap.domains.dns.setHosts', {
            SLD: sld,
            TLD: tld,
            Hosts: JSON.stringify(allRecords)
        });

        // 9. Verify update was successful
        if (updateResponse.ApiResponse.$.Status !== 'OK') {
            const errors = updateResponse.ApiResponse.Errors?.Error;
            const errorMessage = Array.isArray(errors) ? errors.map(e => e._).join(', ') : errors?.$_ || 'Unknown error';
            throw new Error(`Failed to update DNS records: ${errorMessage}`);
        }

        // 10. Update database with redirect information
        const redirectData = {
            type: type === '301' ? 'URL301' : 'URL302',
            destinationUrl,
            masked,
            title,
            keywords,
            description,
            createdAt: new Date()
        };

        // Remove existing redirects and add new one
        const updateResult = await updateDomainInDatabase(userId, domain, {
            redirects: [redirectData],
            'dnsConfiguration.lastDNSUpdate': new Date()
        });

        // 11. Log success and return response
        console.log(`[Redirect API] Successfully updated redirect for ${domain} (User: ${userId})`);
        
        res.json({
            success: true,
            userId,
            data: {
                domain,
                destinationUrl,
                type,
                masked,
                message: 'Domain redirect updated successfully',
                timestamp: new Date().toISOString(),
                nameservers: nameserverList,
                recordsUpdated: allRecords.length,
                preservedRecords: preservedRecords.length,
                databaseRecord: {
                    _id: updateResult._id,
                    updatedAt: updateResult.updatedAt
                }
            }
        });

    } catch (error) {
        console.error(`[Redirect Error] Domain: ${domain} (User: ${userId})`, {
            error: error.message,
            stack: error.stack,
            response: error.response?.data
        });

        // Handle specific error cases
        if (error.message.includes('Domain name not found') || error.message.includes('Domain not found')) {
            return res.status(404).json({
                success: false,
                userId,
                error: 'Domain not found in your Namecheap account',
                domain,
                details: 'Please verify the domain is registered with your Namecheap account'
            });
        }

        if (error.message.includes('Invalid domain name')) {
            return res.status(400).json({
                success: false,
                userId,
                error: 'Invalid domain name format',
                domain,
                details: 'Please check the domain name spelling and format'
            });
        }

        if (error.message.includes('Authentication failed')) {
            return res.status(401).json({
                success: false,
                userId,
                error: 'Namecheap API authentication failed',
                details: 'Please check your API credentials'
            });
        }

        res.status(500).json({
            success: false,
            userId,
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
router.post('/namecheap/domain/:domain/createemail', validateUserId, asyncHandler(async (req, res) => {
    const { domain } = req.params;
    const { username, password, quota = 1024 } = req.body;
    const userId = req.userId;

    // Validate inputs
    if (!username || !password) {
        return res.status(400).json({
            success: false,
            error: 'Username and password are required'
        });
    }

    // Password strength check
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        return res.status(400).json({
            success: false,
            error: 'Password must be at least 8 characters and contain uppercase, lowercase, and numbers'
        });
    }

    // Quota check (max 10GB = 10240 MB)
    if (isNaN(quota) || quota < 50 || quota > 10240) {
        return res.status(400).json({
            success: false,
            error: 'Quota must be between 50 MB and 10240 MB (10 GB)'
        });
    }

    try {
        const userDomain = await NamecheapDomain.findOne({ userId, domain: domain.toLowerCase() });
        if (!userDomain) {
            return res.status(404).json({
                success: false,
                error: 'Domain not found for this user',
                details: 'Please ensure the domain is registered under your account'
            });
        }

        const domainInfo = await namecheapRequest('namecheap.domains.getInfo', { DomainName: domain });
        const domainResult = domainInfo.ApiResponse.CommandResponse.DomainGetInfoResult;
        const isOurDNS = domainResult.DnsDetails.$.IsUsingOurDNS === 'true';

        if (!isOurDNS) {
            return res.status(400).json({
                success: false,
                error: 'Domain must use Namecheap DNS servers for email setup',
                details: {
                    currentNameservers: domainResult.DnsDetails.Nameserver,
                    requiredNameservers: ['dns1.registrar-servers.com', 'dns2.registrar-servers.com']
                }
            });
        }

        const emailSetup = await configureEmailDns(domain);
        if (!emailSetup.dnsConfigured) {
            return res.status(400).json({
                success: false,
                error: 'Email DNS configuration failed',
                details: emailSetup
            });
        }

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

        const emailAccountData = {
            username,
            email: emailAddress,
            quota,
            createdAt: new Date(),
            suspended: false
        };

        await updateDomainInDatabase(userId, domain, {
            $push: { emailAccounts: emailAccountData },
            'dnsConfiguration.emailDNSConfigured': true,
            'dnsConfiguration.emailDNSConfiguredAt': emailSetup.dnsConfigured ? new Date() : userDomain.dnsConfiguration.emailDNSConfiguredAt
        });

        res.json({
            success: true,
            userId,
            data: {
                email: emailAddress,
                quota,
                status: 'active',
                dnsStatus: emailSetup,
                timestamp: new Date().toISOString(),
                message: 'Email account created with default quota (recommended 500MB–2GB for shared plans)'
            }
        });

    } catch (error) {
        console.error(`[Email API] Error creating email for ${domain} (User: ${userId}):`, {
            error: error.message,
            domain,
            username,
            stack: error.stack
        });

        if (error.message.includes('already exists')) {
            return res.status(409).json({
                success: false,
                userId,
                error: 'Email account already exists',
                details: 'Please choose a different username'
            });
        }

        if (error.message.includes('Invalid domain')) {
            return res.status(400).json({
                success: false,
                userId,
                error: 'Invalid domain for email creation',
                details: 'The domain must be properly configured on the server'
            });
        }

        throw error;
    }
}));


/**
 * List email accounts for a domain
 */
router.get('/namecheap/domain/:domain/emails', validateUserId, asyncHandler(async (req, res) => {
    const { domain } = req.params;
    const userId = req.userId;

    try {
        // 1. Verify domain ownership through database
        const userDomain = await NamecheapDomain.findOne({
            userId,
            domain: domain.toLowerCase()
        });

        if (!userDomain) {
            return res.status(404).json({
                success: false,
                error: 'Domain not found for this user',
                details: 'Please ensure the domain is registered under your account'
            });
        }

        console.log(`[Email API] Listing emails for ${domain} (User: ${userId})`);

        // 2. Get domain info to verify DNS setup
        const domainInfo = await namecheapRequest('namecheap.domains.getInfo', {
            DomainName: domain
        });

        const domainResult = domainInfo.ApiResponse.CommandResponse.DomainGetInfoResult;
        const isOurDNS = domainResult.DnsDetails.$.IsUsingOurDNS === 'true';

        if (!isOurDNS) {
            return res.status(400).json({
                success: false,
                userId,
                error: 'Domain must use Namecheap DNS servers',
                currentNameservers: domainResult.DnsDetails.Nameserver,
                databaseAccounts: userDomain.emailAccounts || []
            });
        }

        // 3. Get live email accounts using cPanel API
        let liveEmailAccounts = [];
        let cpanelError = null;

        try {
            const cpanelResponse = await cpanelRequest('Email/list_pops', {
                domain
            });

            if (cpanelResponse.status) {
                liveEmailAccounts = cpanelResponse.data.map(account => ({
                    username: account.user,
                    email: account.email,
                    quota: parseInt(account.quota) || 0,
                    used: parseInt(account.used) || 0,
                    suspended: account.suspended === '1',
                    created: account.created,
                    lastLogin: account.last_login || null,
                    source: 'cpanel_live'
                }));
            } else {
                cpanelError = cpanelResponse.errors?.[0] || 'Failed to list email accounts';
            }
        } catch (error) {
            cpanelError = error.message;
            console.warn(`[Email API] cPanel error for ${domain}, using database data:`, error.message);
        }

        // 4. Combine database and live data
        const databaseAccounts = userDomain.emailAccounts || [];
        const combinedAccounts = [];

        // Add live accounts
        liveEmailAccounts.forEach(liveAccount => {
            combinedAccounts.push({
                ...liveAccount,
                inDatabase: databaseAccounts.some(dbAccount => dbAccount.email === liveAccount.email),
                dataSource: 'live_cpanel'
            });
        });

        // Add database-only accounts (not found in live data)
        databaseAccounts.forEach(dbAccount => {
            const foundInLive = liveEmailAccounts.find(liveAccount => liveAccount.email === dbAccount.email);
            if (!foundInLive) {
                combinedAccounts.push({
                    username: dbAccount.username,
                    email: dbAccount.email,
                    quota: dbAccount.quota || 0,
                    used: 0,
                    suspended: dbAccount.suspended || false,
                    created: dbAccount.createdAt,
                    lastLogin: null,
                    inDatabase: true,
                    dataSource: 'database_only',
                    note: 'Account exists in database but not found in live cPanel data'
                });
            }
        });

        res.json({
            success: true,
            userId,
            data: {
                domain,
                accounts: combinedAccounts,
                count: combinedAccounts.length,
                isOurDNS: true,
                timestamp: new Date().toISOString(),
                dataSource: 'combined_live_and_database',
                cpanelStatus: cpanelError ? 'error' : 'success',
                cpanelError,
                databaseEmailCount: databaseAccounts.length,
                liveEmailCount: liveEmailAccounts.length
            }
        });

    } catch (error) {
        console.error(`[Email API] Error listing emails for ${domain} (User: ${userId}):`, {
            error: error.message,
            domain,
            stack: error.stack
        });

        // Handle specific error cases
        if (error.message.includes('Domain not found')) {
            return res.status(404).json({
                success: false,
                userId,
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

/**
 * Get user domain statistics and overview
 */
router.get('/namecheap/user/:userId/stats', validateUserId, async (req, res) => {
    const userId = req.userId;

    try {
        console.log(`[Domain API] 📊 Fetching domain statistics for user: ${userId}`);

        // Get all user domains from database
        const userDomains = await getUserDomainsFromDatabase(userId);

        // Calculate statistics
        const stats = {
            totalDomains: userDomains.length,
            activeDomains: userDomains.filter(d => d.domainStatus.isActive).length,
            expiredDomains: userDomains.filter(d => d.domainStatus.status === 'expired').length,
            premiumDomains: userDomains.filter(d => d.domainStatus.isPremium).length,
            autoRenewEnabled: userDomains.filter(d => d.domainStatus.autoRenew).length,
            whoisGuardEnabled: userDomains.filter(d => d.domainStatus.whoisGuardEnabled).length,
            emailConfigured: userDomains.filter(d => d.dnsConfiguration.emailDNSConfigured).length,
            totalEmailAccounts: userDomains.reduce((sum, d) => sum + (d.emailAccounts?.length || 0), 0),
            totalRedirects: userDomains.reduce((sum, d) => sum + (d.redirects?.length || 0), 0),
            
            // Pricing summary
            totalSpent: userDomains.reduce((sum, d) => sum + (d.registrationData.chargedAmount || 0), 0),
            upcomingRenewals: userDomains.filter(d => {
                const expirationDate = new Date(d.registrationData.expirationDate);
                const thirtyDaysFromNow = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));
                return expirationDate <= thirtyDaysFromNow;
            }).length,

            // Domain distribution by TLD
            tldDistribution: {},
            
            // Registration timeline (last 6 months)
            registrationTimeline: {}
        };

        // Calculate TLD distribution
        userDomains.forEach(domain => {
            const tld = domain.domain.split('.').pop().toUpperCase();
            stats.tldDistribution[tld] = (stats.tldDistribution[tld] || 0) + 1;
        });

        // Calculate registration timeline (last 6 months)
        const sixMonthsAgo = new Date(Date.now() - (6 * 30 * 24 * 60 * 60 * 1000));
        userDomains.forEach(domain => {
            const regDate = new Date(domain.registrationData.registrationDate);
            if (regDate >= sixMonthsAgo) {
                const monthKey = regDate.toISOString().substring(0, 7); // YYYY-MM format
                stats.registrationTimeline[monthKey] = (stats.registrationTimeline[monthKey] || 0) + 1;
            }
        });

        // Get recent domains (last 10)
        const recentDomains = userDomains
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 10)
            .map(d => ({
                domain: d.domain,
                registrationDate: d.registrationData.registrationDate,
                expirationDate: d.registrationData.expirationDate,
                status: d.domainStatus.status,
                emailAccounts: d.emailAccounts?.length || 0,
                redirects: d.redirects?.length || 0
            }));

        // Get domains expiring soon (next 60 days)
        const sixtyDaysFromNow = new Date(Date.now() + (60 * 24 * 60 * 60 * 1000));
        const expiringSoon = userDomains
            .filter(d => {
                const expirationDate = new Date(d.registrationData.expirationDate);
                return expirationDate <= sixtyDaysFromNow;
            })
            .sort((a, b) => new Date(a.registrationData.expirationDate) - new Date(b.registrationData.expirationDate))
            .map(d => ({
                domain: d.domain,
                expirationDate: d.registrationData.expirationDate,
                daysUntilExpiration: Math.ceil((new Date(d.registrationData.expirationDate) - new Date()) / (24 * 60 * 60 * 1000)),
                autoRenew: d.domainStatus.autoRenew
            }));

        res.json({
            success: true,
            userId,
            data: {
                stats,
                recentDomains,
                expiringSoon,
                recommendations: {
                    enableAutoRenew: stats.activeDomains - stats.autoRenewEnabled,
                    setupEmail: stats.activeDomains - stats.emailConfigured,
                    enableWhoisGuard: stats.activeDomains - stats.whoisGuardEnabled
                },
                lastUpdated: new Date().toISOString(),
                apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
            }
        });

    } catch (error) {
        console.error(`[Domain API] ❌ Error fetching user stats for ${userId}:`, {
            error: error.message,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            userId,
            error: error.message,
            details: 'Failed to fetch user domain statistics'
        });
    }
});

/**
 * List email accounts for a domain (Simple cPanel API endpoint)
 */
router.get('/namecheap/domain/:domain/listemails', async (req, res) => {
    const { domain } = req.params;

    if (!domain) {
        return res.status(400).json({
            status: "-1",
            message: "Domain parameter is required",
            data: null
        });
    }

    try {
        console.log(`[Email List API] Fetching email accounts for domain: ${domain}`);

        // Call cPanel API to list email accounts
        const response = await cpanelRequest('Email/list_pops', {
            domain: domain
        });

        if (response.status === 1) {
            // Format the email accounts data
            const emailAccounts = response.data.map(account => ({
                email: account.email || `${account.user}@${domain}`,
                username: account.user,
                diskUsed: account.disk_used_b ? `${(account.disk_used_b / 1024 / 1024).toFixed(1)} MB` : account.disk_used,
                diskQuota: account.quota ? (account.quota === 'unlimited' ? 'Unlimited' : `${account.quota} MB`) : 'N/A',
                suspended: account.suspended === '1',
                suspendedIncoming: account.suspended_incoming === '1',
                suspendedLogin: account.suspended_login === '1',
                created: account.humandiskused || account._diskused || 'Unknown',
                lastLogin: account.last_login || null
            }));

            res.status(200).json({
                status: "1",
                message: "Email accounts fetched successfully.",
                data: emailAccounts,
                domain: domain,
                count: emailAccounts.length,
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(500).json({
                status: "-1",
                message: "Failed to fetch email accounts from cPanel.",
                data: response.errors || response,
                domain: domain
            });
        }
    } catch (error) {
        console.error(`[Email List API] Error fetching email accounts for ${domain}:`, {
            error: error.message,
            stack: error.stack
        });

        // Handle specific error cases
        if (error.message.includes('Domain not found')) {
            return res.status(404).json({
                status: "-1",
                message: "Domain not found on the server",
                error: error.message,
                domain: domain
            });
        }

        if (error.message.includes('Authentication failed')) {
            return res.status(401).json({
                status: "-1",
                message: "cPanel authentication failed",
                error: "Please check cPanel credentials",
                domain: domain
            });
        }

        res.status(500).json({
            status: "-1",
            message: "Server error while fetching email accounts",
            error: error.message,
            domain: domain
        });
    }
});

module.exports = router;