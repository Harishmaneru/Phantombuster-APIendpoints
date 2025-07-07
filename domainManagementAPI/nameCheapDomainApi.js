require('dotenv').config();
const axios = require('axios');
const express = require('express');
const xml2js = require('xml2js');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoose = require('mongoose');
const router = express.Router();
const NodeCache = require('node-cache');
const CircuitBreaker = require('opossum');
const domainCache = new NodeCache({ stdTTL: 300 }); // 5 minute cache

// Add missing helper functions
const CONCURRENT_LIMIT = 5; // Limit concurrent API calls

// Helper function to create standardized error responses
function createErrorResponse(error, operation) {
    return {
        success: false,
        operation,
        error: error.message,
        details: error.response?.data || 'Unknown error occurred',
        timestamp: new Date().toISOString(),
        apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
    };
}

// Helper function for retry logic with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxRetries) {
                throw error;
            }
            
            const delay = baseDelay * Math.pow(2, attempt - 1);
            console.log(`[Retry] Attempt ${attempt} failed, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

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
        customNameservers: { type: Boolean, default: false },
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
    stripePayment: {
        sessionId: String,
        paymentIntentId: String,
        customerId: String,
        paymentStatus: String,
        amountPaid: Number,
        currency: String,
        paymentMethod: String,
        paymentDate: Date,
        receiptUrl: String,
        invoiceId: String,
        hostedInvoiceUrl: String,
        invoicePdf: String
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

// Industry-standard TLD priorities (ordered by commercial value)
const POPULAR_TLDS = ['com', 'net', 'org', 'io', 'co', 'ai', 'app', 'dev', 'tech', 'cloud', 'online', 'site', 'shop', 'store'];

// Common keyword variations for suggestions
const COMMON_VARIATIONS = [
    'app', 'hq', 'online', 'shop', 'site', 'store', 'hub', 'lab', 'pro', 'plus',
    'get', 'my', 'the', 'new', 'best', 'top', 'go', 'try', 'use', 'find'
];

// Variation patterns for keyword modifications
const VARIATION_PATTERNS = [
    (keyword) => `${keyword}app`,
    (keyword) => `${keyword}hq`,
    (keyword) => `${keyword}online`,
    (keyword) => `${keyword}shop`,
    (keyword) => `${keyword}site`,
    (keyword) => `get${keyword}`,
    (keyword) => `my${keyword}`,
    (keyword) => `the${keyword}`,
    (keyword) => `${keyword}-app`,
    (keyword) => `${keyword}-online`,
    (keyword) => `${keyword}-shop`
];

// Namecheap API Configuration
const {
    NAMECHEAP_API_USER,
    NAMECHEAP_API_KEY,
    NAMECHEAP_CLIENT_IP,
    NAMECHEAP_SANDBOX
} = process.env;

// cPanel/WHM Configuration
const CPANEL_HOST = process.env.WHM_HOST;
const CPANEL_USERNAME = process.env.CPANEL_MASTER_USER;
const CPANEL_TOKEN = process.env.CPANEL_TOKEN;
const WHM_USERNAME = process.env.CPANEL_MASTER_USER;
const WHM_TOKEN = process.env.WHM_TOKEN;

// Validate environment variables
if (!NAMECHEAP_API_USER || !NAMECHEAP_API_KEY || !NAMECHEAP_CLIENT_IP) {
    console.error('❌ Missing required Namecheap environment variables:');
    console.error('  - NAMECHEAP_API_USER:', NAMECHEAP_API_USER ? '✓' : '✗');
    console.error('  - NAMECHEAP_API_KEY:', NAMECHEAP_API_KEY ? '✓' : '✗');
    console.error('  - NAMECHEAP_CLIENT_IP:', NAMECHEAP_CLIENT_IP ? '✓' : '✗');
    throw new Error('Server initialization failed: Missing Namecheap environment variables');
}

// Validate WHM environment variables
if (!CPANEL_HOST || !CPANEL_USERNAME || !CPANEL_TOKEN || !WHM_TOKEN) {
    console.error('❌ Missing required WHM/cPanel environment variables:');
    console.error('  - WHM_HOST:', CPANEL_HOST ? '✓' : '✗');
    console.error('  - CPANEL_MASTER_USER:', CPANEL_USERNAME ? '✓' : '✗');
    console.error('  - CPANEL_TOKEN:', CPANEL_TOKEN ? '✓' : '✗');
    console.error('  - WHM_TOKEN:', WHM_TOKEN ? '✓' : '✗');
    console.warn('⚠️  Email functionality will be limited without WHM/cPanel configuration');
}

// Log API configuration
console.log(`[Namecheap API] Mode: ${NAMECHEAP_SANDBOX === 'true' ? 'SANDBOX' : 'PRODUCTION'}`);
console.log(`[Namecheap API] User: ${NAMECHEAP_API_USER}`);
console.log(`[cPanel/WHM] Host: ${CPANEL_HOST}`);
console.log(`[cPanel/WHM] User: ${CPANEL_USERNAME}`);


const BASE_URL = 'https://api.namecheap.com/xml.response';
// const BASE_URL = 'https://api.sandbox.namecheap.com/xml.response';



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
    const url = `https://${CPANEL_HOST}:2087/json-api/${endpoint}`;

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

// Helper: Get nameserver configuration for a user/domain
function getNameserverConfig(customNameservers = null, useNamecheapDNS = false) {
    const config = {
        nameservers: [],
        isCustom: false,
        isNamecheapDNS: false,
        useDefaults: false // Flag to indicate we should use Namecheap defaults
    };

    if (useNamecheapDNS) {
        // Use Namecheap's default DNS servers
        config.nameservers = [
            'dns1.registrar-servers.com',
            'dns2.registrar-servers.com'
        ];
        config.isNamecheapDNS = true;
    } else if (customNameservers && Array.isArray(customNameservers) && customNameservers.length >= 2) {
        // Validate custom nameservers
        const validNameservers = customNameservers.filter(ns => {
            return typeof ns === 'string' &&
                ns.length > 0 &&
                /^[a-zA-Z0-9.-]+$/.test(ns) &&
                ns.includes('.');
        });

        if (validNameservers.length >= 2) {
            config.nameservers = validNameservers.slice(0, 4); // Maximum 4 nameservers
            config.isCustom = true;
        } else {
            throw new Error('Invalid custom nameservers provided. Please provide at least 2 valid nameserver addresses.');
        }
    } else {
        // No specific preference - use whatever Namecheap provides by default
        config.useDefaults = true;
        config.nameservers = []; // Will be populated with actual defaults later
    }

    return config;
}

// Helper: Set domain nameservers
async function setDomainNameservers(domain, nameserverConfig) {
    const [sld, tld] = domain.split('.');

    if (nameserverConfig.isNamecheapDNS) {
        // Use Namecheap's default DNS servers
        const response = await namecheapRequest('namecheap.domains.dns.setDefault', {
            SLD: sld,
            TLD: tld
        });

        if (response?.ApiResponse?.CommandResponse?.DomainDNSSetDefaultResult?.$.Updated !== 'true') {
            throw new Error('Failed to set Namecheap DNS servers');
        }

        return {
            success: true,
            nameservers: nameserverConfig.nameservers,
            type: 'namecheap_default'
        };
    } else {
        // Use custom nameservers
        const nameserverString = nameserverConfig.nameservers.join(',');
        const response = await namecheapRequest('namecheap.domains.dns.setCustom', {
            SLD: sld,
            TLD: tld,
            NameServers: nameserverString
        });

        if (response?.ApiResponse?.CommandResponse?.DomainDNSSetCustomResult?.$.Updated !== 'true') {
            throw new Error('Failed to set custom nameservers');
        }

        return {
            success: true,
            nameservers: nameserverConfig.nameservers,
            type: 'custom'
        };
    }
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
    // Validate required environment variables
    if (!NAMECHEAP_API_USER || !NAMECHEAP_API_KEY || !NAMECHEAP_CLIENT_IP) {
        throw new Error('Missing required Namecheap API configuration');
    }

    // Build query parameters
    const queryParams = new URLSearchParams({
        ApiUser: NAMECHEAP_API_USER,
        ApiKey: NAMECHEAP_API_KEY,
        UserName: NAMECHEAP_API_USER,
        ClientIp: NAMECHEAP_CLIENT_IP,
        Command: command,
        ...params
    });

    // Construct the full URL with query parameters
    const url = `${BASE_URL}?${queryParams.toString()}`;

    try {
        console.log('[Namecheap API] Making request:', {
            command,
            params: { ...params, ApiKey: '***' },
            retryCount,
            url: url.replace(NAMECHEAP_API_KEY, '***')
        });

        // Use GET method instead of POST
        const response = await axios.get(url, {
            headers: {
                'Accept': 'application/xml',
                'Content-Type': 'application/xml'
            },
            maxRedirects: 5,
            timeout: 30000, // Increased timeout to 30 seconds
            validateStatus: function (status) {
                return status >= 200 && status < 500;
            }
        });

        // Add delay between retries
        if (retryCount > 0) {
            const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff with 10s max
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        // Validate response
        if (!response.data) {
            throw new Error('Empty response from Namecheap API');
        }

        // Handle non-XML responses
        if (typeof response.data === 'string') {
            if (response.data.includes('405 - HTTP verb used to access this page is not allowed')) {
                throw new Error('HTTP method not allowed. The API endpoint requires a different HTTP method.');
            }
            if (!response.data.trim().startsWith('<?xml')) {
                console.error('[Namecheap API] Unexpected response format:', response.data);
                throw new Error('Invalid response format from API');
            }
        }

        const parsed = await parseXmlResponse(response.data);

        // Enhanced response validation
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('Failed to parse API response');
        }

        if (!parsed.ApiResponse) {
            console.error('[Namecheap API] Invalid response structure:', parsed);
            throw new Error('Missing ApiResponse in parsed data');
        }

        // Check for API errors
        if (parsed.ApiResponse.Errors && parsed.ApiResponse.Errors.Error) {
            const errors = Array.isArray(parsed.ApiResponse.Errors.Error)
                ? parsed.ApiResponse.Errors.Error
                : [parsed.ApiResponse.Errors.Error];

            const errorMessages = errors.map(error =>
                typeof error === 'string' ? error : error._ || error.toString()
            ).join('; ');

            throw new Error(`Namecheap API error: ${errorMessages}`);
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

        // Enhanced retry logic
        if (retryCount < maxRetries) {
            const shouldRetry =
                !err.response || // Network error
                err.response.status >= 500 || // Server error
                err.response.status === 405 || // Method not allowed (try alternative method)
                err.message.includes('Invalid XML response') || // XML parsing error
                err.message.includes('Failed to parse API response') || // Parsing error
                err.message.includes('ECONNRESET') || // Connection reset
                err.message.includes('timeout'); // Timeout error

            if (shouldRetry) {
                console.log(`[Namecheap API] Retrying request (attempt ${retryCount + 1}/${maxRetries})...`);

                // If we got a 405, try POST method on retry
                if (err.response?.status === 405) {
                    console.log('[Namecheap API] Switching to POST method for retry');
                    try {
                        const postResponse = await axios.post(BASE_URL, queryParams.toString(), {
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded',
                                'Accept': 'application/xml'
                            },
                            timeout: 30000
                        });
                        if (postResponse.data) {
                            return await parseXmlResponse(postResponse.data);
                        }
                    } catch (postError) {
                        console.error('[Namecheap API] POST retry failed:', postError.message);
                    }
                }

                return namecheapRequest(command, params, retryCount + 1, maxRetries);
            }
        }

        // If we've exhausted retries or it's not a retryable error, throw with enhanced error info
        const error = new Error(`Namecheap API request failed: ${err.message}`);
        error.code = 'NAMECHEAP_API_ERROR';
        error.status = err.response?.status;
        error.command = command;
        error.params = { ...params, ApiKey: '***' };
        error.retryCount = retryCount;
        throw error;
    }
}

// Helper: Extract 1-year price from getPricing XML response with detailed pricing data
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
            currency: 'USD',
            detailed: {} // Store all detailed pricing data
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
            const categoryName = category.$.Name.toLowerCase();

            // Store simplified pricing
            switch (categoryName) {
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

            // Store detailed pricing data (all XML attributes)
            pricing.detailed[categoryName] = {
                duration: oneYearPrice.$.Duration,
                durationType: oneYearPrice.$.DurationType,
                price: parseFloat(oneYearPrice.$.Price),
                pricingType: oneYearPrice.$.PricingType,
                additionalCost: parseFloat(oneYearPrice.$.AdditionalCost || '0'),
                regularPrice: parseFloat(oneYearPrice.$.RegularPrice || oneYearPrice.$.Price),
                regularPriceType: oneYearPrice.$.RegularPriceType,
                regularAdditionalCost: parseFloat(oneYearPrice.$.RegularAdditionalCost || '0'),
                regularAdditionalCostType: oneYearPrice.$.RegularAdditionalCostType,
                yourPrice: parseFloat(oneYearPrice.$.YourPrice),
                yourPriceType: oneYearPrice.$.YourPriceType,
                yourAdditionalCost: parseFloat(oneYearPrice.$.YourAdditonalCost || '0'),
                yourAdditionalCostType: oneYearPrice.$.YourAdditonalCostType,
                promotionPrice: parseFloat(oneYearPrice.$.PromotionPrice || '0'),
                currency: oneYearPrice.$.Currency || 'USD',
                // Total cost
                totalCost: price + additionalCost,
                // Raw XML attributes for complete data
                rawAttributes: oneYearPrice.$
            };
        });

        // console.log(`[Pricing API] 📊 Detailed pricing extracted:`, {
        //     simplified: {
        //         register: pricing.register,
        //         renew: pricing.renew,
        //         transfer: pricing.transfer
        //     },
        //     detailed: pricing.detailed
        // });

        return pricing;
    } catch (err) {
        console.error('[Domain API] Error extracting price:', err.message);
        return null;
    }
}

// Helper: Extract pricing for specific duration from getPricing XML response
function extractPriceForDuration(xml, years) {
    try {
        const result = xml.ApiResponse.CommandResponse.UserGetPricingResult;
        const productType = result.ProductType;

        // Find all categories
        const categories = Array.isArray(productType.ProductCategory)
            ? productType.ProductCategory
            : [productType.ProductCategory];

        const pricing = {
            years: parseInt(years),
            register: null,
            renew: null,
            transfer: null,
            icannFee: 0.18 * parseInt(years), // ICANN fee per year
            currency: 'USD',
            totalCost: null,
            perYearCost: null,
            savings: null // compared to 1-year pricing
        };

        let oneYearRegisterPrice = null;

        // Extract prices from each category
        categories.forEach(category => {
            const product = category.Product;
            if (!product) return;

            const prices = Array.isArray(product.Price)
                ? product.Price
                : [product.Price];

            // Find pricing for requested duration
            const requestedYearPrice = prices.find(p => p.$.Duration === years.toString());

            // Also get 1-year price for comparison
            const oneYearPrice = prices.find(p => p.$.Duration === '1');

            if (requestedYearPrice) {
                const price = parseFloat(requestedYearPrice.$.YourPrice);
                const additionalCost = parseFloat(requestedYearPrice.$.YourAdditonalCost || '0');
                const totalPrice = price + additionalCost;

                switch (category.$.Name.toLowerCase()) {
                    case 'register':
                        pricing.register = totalPrice;
                        pricing.totalCost = totalPrice + pricing.icannFee;
                        pricing.perYearCost = (totalPrice + pricing.icannFee) / parseInt(years);
                        break;
                    case 'renew':
                        pricing.renew = totalPrice;
                        break;
                    case 'transfer':
                        pricing.transfer = totalPrice;
                        break;
                }
            }

            // Calculate savings compared to 1-year pricing
            if (oneYearPrice && category.$.Name.toLowerCase() === 'register') {
                const oneYearTotal = parseFloat(oneYearPrice.$.YourPrice) + parseFloat(oneYearPrice.$.YourAdditonalCost || '0') + 0.18;
                oneYearRegisterPrice = oneYearTotal;
                const multiYearEquivalent = oneYearTotal * parseInt(years);
                if (pricing.totalCost) {
                    pricing.savings = {
                        amount: multiYearEquivalent - pricing.totalCost,
                        percentage: ((multiYearEquivalent - pricing.totalCost) / multiYearEquivalent * 100).toFixed(2),
                        comparedToYearly: {
                            multiYear: pricing.totalCost,
                            yearly: multiYearEquivalent,
                            yearsCompared: parseInt(years)
                        }
                    };
                }
            }
        });

        return pricing;
    } catch (err) {
        console.error('[Domain API] Error extracting multi-year price:', err.message);
        return null;
    }
}

// Industry-standard suggestion generator (Robust Version)
async function generateProductionSuggestions(keyword, originalTld, isPrimaryAvailable, acceptPremiumPricing = false) {
    console.log(`[Suggestion Engine] Generating suggestions for "${keyword}.${originalTld}" (Available: ${isPrimaryAvailable})`);

    const results = {
        tldVariations: [],
        keywordVariations: [],
        premiumDomains: []
    };

    const checkedDomains = new Set(); // Prevent duplicates
    const maxSuggestions = {
        tldVariations: 6, // Reduced for better performance
        keywordVariations: 4 // Reduced for better performance
    };

    try {
        // A. TLD Variations (highest priority - check popular TLDs first)
        console.log(`[Suggestion Engine] Checking TLD variations for "${keyword}"`);
        const tldPromises = POPULAR_TLDS
            .filter(tld => tld !== originalTld.toLowerCase())
            .slice(0, 8) // Reduced to 8 TLDs for better performance
            .map(async (tld) => {
                const variant = `${keyword}.${tld}`;
                if (checkedDomains.has(variant)) return null;
                checkedDomains.add(variant);

                try {
                    const check = await namecheapRequest('namecheap.domains.check', {
                        DomainList: variant
                    });

                    const domainResult = check.ApiResponse.CommandResponse.DomainCheckResult;
                    const isAvailable = domainResult.$.Available === 'true';
                    const isPremium = domainResult.$.IsPremiumName === 'true';
                    const price = domainResult.$.Price ? parseFloat(domainResult.$.Price) : null;
                    const eapFee = domainResult.$.EapFee ? parseFloat(domainResult.$.EapFee) : 0;

                    // More strict availability check
                    const isValid = isAvailable &&
                        (!isPremium || (isPremium && price && acceptPremiumPricing)) &&
                        domainResult.$.ErrorNo === '0';

                    if (isValid) {
                        // Get pricing for this TLD (with fallback)
                        let pricing = null;
                        try {
                            pricing = await getPricingForTLD(tld);
                        } catch (pricingError) {
                            console.warn(`[Suggestion Engine] Pricing failed for ${variant}:`, pricingError.message);
                            pricing = {
                                register: null,
                                renew: null,
                                transfer: null,
                                icannFee: 0.18,
                                currency: 'USD'
                            };
                        }

                        // Get privacy protection info for this TLD (with fallback)
                        let privacyInfo = null;
                        try {
                            privacyInfo = await getPrivacyProtectionInfo(tld);
                        } catch (privacyError) {
                            console.warn(`[Suggestion Engine] Privacy info failed for ${variant}:`, privacyError.message);
                            privacyInfo = {
                                supported: null,
                                pricing: { cost: null, note: 'Unable to determine' },
                                dataSource: 'error_fallback'
                            };
                        }

                        return {
                            domain: variant,
                            type: 'tld_variation',
                            tld: tld,
                            available: isAvailable,
                            availableString: domainResult.$.Available,
                            isPremium,
                            price: isPremium ? price : null,
                            pricing: {
                                register: isPremium ? price : (pricing?.register || null),
                                renew: pricing?.renew || null,
                                transfer: pricing?.transfer || null,
                                icannFee: pricing?.icannFee || 0.18,
                                currency: 'USD'
                            },
                            privacyProtection: {
                                supported: privacyInfo?.supported,
                                cost: privacyInfo?.pricing?.cost || null,
                                note: privacyInfo?.pricing?.note || 'Unable to determine',
                                dataSource: privacyInfo?.dataSource || 'error_fallback'
                            },
                            priority: POPULAR_TLDS.indexOf(tld) + 1
                        };
                    }
                } catch (error) {
                    console.warn(`[Suggestion Engine] Error checking ${variant}:`, error.message);
                }
                return null;
            });

        const tldResults = await Promise.all(tldPromises);
        results.tldVariations = tldResults
            .filter(result => result !== null)
            .sort((a, b) => a.priority - b.priority) // Sort by TLD priority
            .slice(0, maxSuggestions.tldVariations);

        // B. Keyword Variations (if primary unavailable or need more suggestions)
        if (!isPrimaryAvailable || results.tldVariations.length < 4) {
            console.log(`[Suggestion Engine] Generating keyword variations for "${keyword}"`);

            const keywordPromises = [];

            // Generate variations using patterns
            VARIATION_PATTERNS.forEach(pattern => {
                const variant = pattern(keyword);
                const testTlds = [originalTld.toLowerCase(), 'com'].filter((tld, index, arr) => arr.indexOf(tld) === index);

                testTlds.forEach(tld => {
                    const domain = `${variant}.${tld}`;
                    if (!checkedDomains.has(domain) && keywordPromises.length < 20) {
                        checkedDomains.add(domain);

                        keywordPromises.push(
                            namecheapRequest('namecheap.domains.check', { DomainList: domain })
                                .then(async (check) => {
                                    const domainResult = check.ApiResponse.CommandResponse.DomainCheckResult;
                                    const isAvailable = domainResult.$.Available === 'true';
                                    const isPremium = domainResult.$.IsPremiumName === 'true';
                                    const price = domainResult.$.Price ? parseFloat(domainResult.$.Price) : null;
                                    const eapFee = domainResult.$.EapFee ? parseFloat(domainResult.$.EapFee) : 0;

                                    // More strict availability check
                                    const isValid = isAvailable &&
                                        (!isPremium || (isPremium && price && acceptPremiumPricing)) &&
                                        domainResult.$.ErrorNo === '0';

                                    if (isValid) {
                                        // Get pricing for this TLD (with fallback)
                                        let pricing = null;
                                        try {
                                            pricing = await getPricingForTLD(tld);
                                        } catch (pricingError) {
                                            console.warn(`[Suggestion Engine] Keyword variation pricing failed for ${domain}:`, pricingError.message);
                                            pricing = {
                                                register: null,
                                                renew: null,
                                                transfer: null,
                                                icannFee: 0.18,
                                                currency: 'USD'
                                            };
                                        }

                                        // Get privacy protection info for this TLD (with fallback)
                                        let privacyInfo = null;
                                        try {
                                            privacyInfo = await getPrivacyProtectionInfo(tld);
                                        } catch (privacyError) {
                                            console.warn(`[Suggestion Engine] Keyword variation privacy info failed for ${domain}:`, privacyError.message);
                                            privacyInfo = {
                                                supported: null,
                                                pricing: { cost: null, note: 'Unable to determine' },
                                                dataSource: 'error_fallback'
                                            };
                                        }

                                        return {
                                            domain,
                                            type: 'keyword_variation',
                                            tld: tld,
                                            available: isAvailable,
                                            availableString: domainResult.$.Available,
                                            isPremium,
                                            price: isPremium ? price : null,
                                            pricing: {
                                                register: isPremium ? price : (pricing?.register || null),
                                                renew: pricing?.renew || null,
                                                transfer: pricing?.transfer || null,
                                                icannFee: pricing?.icannFee || 0.18,
                                                currency: 'USD'
                                            },
                                            privacyProtection: {
                                                supported: privacyInfo?.supported,
                                                cost: privacyInfo?.pricing?.cost || null,
                                                note: privacyInfo?.pricing?.note || 'Unable to determine',
                                                dataSource: privacyInfo?.dataSource || 'error_fallback'
                                            },
                                            variation: variant,
                                            originalKeyword: keyword
                                        };
                                    }
                                    return null;
                                })
                                .catch(error => {
                                    console.warn(`[Suggestion Engine] Error checking keyword variation ${domain}:`, error.message);
                                    return null;
                                })
                        );
                    }
                });
            });

            const keywordResults = await Promise.all(keywordPromises);
            results.keywordVariations = keywordResults
                .filter(result => result !== null)
                .slice(0, maxSuggestions.keywordVariations);
        }

        // C. Premium domains (if enabled and budget allows)
        // Note: Namecheap requires separate premium search which is complex
        // For now, we'll identify premium domains from regular checks

        console.log(`[Suggestion Engine] Generated ${results.tldVariations.length} TLD variations and ${results.keywordVariations.length} keyword variations`);

        return results;

    } catch (error) {
        console.error('[Suggestion Engine] Error generating suggestions:', error.message);
        return results; // Return partial results
    }
}

// Get pricing for a specific TLD (cached approach for performance)
const pricingCache = new Map();
async function getPricingForTLD(tld) {
    const cacheKey = tld.toLowerCase();

    // console.log(`[Pricing API] 💰 Fetching pricing for TLD: .${tld}`);

    // Check cache first (cache for 1 hour)
    if (pricingCache.has(cacheKey)) {
        const cached = pricingCache.get(cacheKey);
        if (Date.now() - cached.timestamp < 3600000) { // 1 hour
            // console.log(`[Pricing API] ✅ Using cached pricing for .${tld}:`, cached.pricing);
            return cached.pricing;
        } else {
            // console.log(`[Pricing API] ⏰ Cache expired for .${tld}, fetching fresh pricing`);
        }
    }

    try {
        console.log(`[Pricing API] 🌐 Making Namecheap pricing API call for .${tld.toUpperCase()}`);

        const priceXml = await namecheapRequest('namecheap.users.getPricing', {
            ProductType: 'DOMAIN',
            ProductCategory: 'REGISTER',
            ProductName: tld.toUpperCase()
        });

        console.log(`[Pricing API] 📊 Raw pricing XML received for .${tld}`);

        const pricing = extractOneYearPrice(priceXml) || {
            register: null,
            renew: null,
            transfer: null,
            currency: 'USD'
        };

        console.log(`[Pricing API] ✅ Extracted pricing for .${tld}:`, {
            register: pricing.register,
            renew: pricing.renew,
            transfer: pricing.transfer,
            currency: pricing.currency
        });

        // Cache the result
        pricingCache.set(cacheKey, {
            pricing,
            timestamp: Date.now()
        });

        console.log(`[Pricing API] 💾 Cached pricing for .${tld} (expires in 1 hour)`);
        return pricing;

    } catch (error) {
        console.error(`[Pricing API] ❌ Failed to get pricing for TLD .${tld}:`, {
            error: error.message,
            tld,
            stack: error.stack
        });

        const fallbackPricing = {
            register: null,
            renew: null,
            transfer: null,
            currency: 'USD'
        };

        console.log(`[Pricing API] 🔄 Using fallback pricing for .${tld}:`, fallbackPricing);
        return fallbackPricing;
    }
}

// Generate domain groups for organized display (GoDaddy-style)
function generateDomainGroups(suggestions, originalTld) {
    const groups = [];

    // Group 1: Other extensions (TLD variations)
    if (suggestions.tldVariations.length > 0) {
        groups.push({
            name: "Other extensions",
            description: `Popular alternatives to .${originalTld}`,
            type: "tld_variations",
            domains: suggestions.tldVariations,
            count: suggestions.tldVariations.length
        });
    }

    // Group 2: Similar names (keyword variations)
    if (suggestions.keywordVariations.length > 0) {
        groups.push({
            name: "Similar names",
            description: "Creative variations of your search",
            type: "keyword_variations",
            domains: suggestions.keywordVariations,
            count: suggestions.keywordVariations.length
        });
    }

    // Group 3: Premium domains (if any found)
    const premiumDomains = [...suggestions.tldVariations, ...suggestions.keywordVariations]
        .filter(domain => domain.isPremium);

    if (premiumDomains.length > 0) {
        groups.push({
            name: "Premium domains",
            description: "High-value domains with special pricing",
            type: "premium_domains",
            domains: premiumDomains,
            count: premiumDomains.length
        });
    }

    return groups;
}

async function configureEmailDns(domain) {
    // 1. Fetch your server's public IP
    let ip;
    try {
        const ipResponse = await axios.get('https://api.ipify.org?format=json');
        ip = ipResponse.data.ip;
    } catch (err) {
        console.error('[Email DNS] Failed to fetch public IP:', err.message);
        throw new Error('Unable to determine server IP for DNS setup');
    }

    // 2. Get DKIM public key from WHM
    let dkimPublicKey;
    try {
        dkimPublicKey = await getDkimPublicKey(domain);
        if (!dkimPublicKey) {
            throw new Error('Empty DKIM key');
        }
    } catch (err) {
        console.error('[Email DNS] Failed to fetch DKIM key from WHM:', err.message);
        throw new Error('Unable to fetch DKIM public key');
    }

    // 3. Build all necessary records
    //    - A record for "@" → server IP
    //    - MX  record for "@" → mail.<domain>, priority 10
    //    - SPF TXT for "@" → v=spf1 a mx ip4:<ip> ~all
    //    - DKIM TXT for "default._domainkey" → "v=DKIM1; k=rsa; p=<public_key>"
    //    - DMARC TXT for "_dmarc" → "v=DMARC1; p=none; rua=mailto:dmarc@<domain>"
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
            Address: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}`,
            TTL: '1800'
        }
    ];

    // 4. Split into SLD/TLD
    const parts = domain.split('.');
    const sld = parts.slice(0, -1).join('.');
    const tld = parts[parts.length - 1];

    try {
        // 5. Push all records at once
        const response = await namecheapRequest('namecheap.domains.dns.setHosts', {
            SLD: sld,
            TLD: tld,
            Hosts: JSON.stringify(records)
        });

        const successFlag =
            response?.ApiResponse?.CommandResponse?.DomainDNSSetHostsResult?.$?.IsSuccess === 'true';

        if (!successFlag) {
            throw new Error('DNS configuration failed at Namecheap');
        }

        return {
            dnsConfigured: true,
            recordsApplied: records,
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

//_________________Get Wallet Balance and Credits Information______________

router.get('/namecheap/wallet/balance', async (req, res) => {
    try {
        console.log('[Wallet API] Fetching account balance and credits...');

        const response = await namecheapRequest('namecheap.users.getBalances');
        const balanceResult = response.ApiResponse.CommandResponse.UserGetBalancesResult;

        // Extract detailed balance information from XML attributes
        const accountBalance = parseFloat(balanceResult.$.AccountBalance) || 0;
        const availableBalance = parseFloat(balanceResult.$.AvailableBalance) || accountBalance;
        const fundsOnHold = parseFloat(balanceResult.$.FundsRequiredForAutoRenew) || 0;

        // Calculate additional metrics
        const totalFunds = accountBalance;
        const usableFunds = availableBalance;
        const reservedFunds = totalFunds - usableFunds;

        // Determine balance status
        let balanceStatus = 'healthy';
        let balanceMessage = 'Account balance is sufficient';

        if (accountBalance < 10) {
            balanceStatus = 'low';
            balanceMessage = 'Account balance is low - consider adding funds';
        } else if (accountBalance < 50) {
            balanceStatus = 'moderate';
            balanceMessage = 'Account balance is moderate';
        }

        if (accountBalance <= 0) {
            balanceStatus = 'insufficient';
            balanceMessage = 'Insufficient funds - please add money to your account';
        }

        res.json({
            success: true,
            data: {
                balance: {
                    total: accountBalance,
                    available: usableFunds,
                    reserved: reservedFunds,
                    onHold: fundsOnHold,
                    currency: 'USD'
                },
                status: {
                    level: balanceStatus,
                    message: balanceMessage,
                    canRegisterDomains: accountBalance > 0,
                    recommendAddFunds: accountBalance < 50
                },
                account: {
                    username: NAMECHEAP_API_USER,
                    apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production',
                    sandboxMode: NAMECHEAP_SANDBOX === 'true'
                },
                recommendations: {
                    minimumBalance: 50,
                    suggestedTopUp: accountBalance < 50 ? Math.ceil((100 - accountBalance) / 10) * 10 : 0,
                    autoRenewBuffer: fundsOnHold > 0 ? 'Funds reserved for auto-renewal' : 'No auto-renewal reservations'
                }
            },
            timestamp: new Date().toISOString(),
            lastChecked: new Date().toISOString()
        });

    } catch (err) {
        console.error('[Wallet API] ❌ Error fetching balance:', {
            error: err.message,
            stack: err.stack,
            timestamp: new Date().toISOString()
        });

        // Handle specific error cases
        if (err.message.includes('Authentication failed') || err.message.includes('Invalid API key')) {
            return res.status(401).json({
                success: false,
                error: 'Authentication failed',
                details: 'Please check your Namecheap API credentials',
                errorCode: 'AUTH_FAILED',
                apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
            });
        }

        if (err.message.includes('Invalid request IP')) {
            return res.status(403).json({
                success: false,
                error: 'IP not whitelisted',
                details: 'Your server IP is not whitelisted in Namecheap API settings',
                errorCode: 'IP_NOT_WHITELISTED',
                apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
            });
        }

        res.status(500).json({
            success: false,
            error: err.message,
            details: 'Failed to fetch wallet balance from Namecheap API',
            errorCode: 'API_ERROR',
            apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production',
            timestamp: new Date().toISOString()
        });
    }
});


//_________________Get Account Information and Usage Statistics______________

router.get('/namecheap/wallet/account-info', async (req, res) => {
    try {
        console.log('[Account API] 📊 Fetching account information...');

        // Get balance information
        const balanceResponse = await namecheapRequest('namecheap.users.getBalances');
        const balanceResult = balanceResponse.ApiResponse.CommandResponse.UserGetBalancesResult;

        // Try to get pricing information for common TLDs to show spending estimates
        let pricingInfo = {};
        try {
            const pricingResponse = await namecheapRequest('namecheap.users.getPricing', {
                ProductType: 'DOMAIN',
                ProductCategory: 'REGISTER'
            });

            // Extract pricing for common TLDs
            const productType = pricingResponse.ApiResponse.CommandResponse.UserGetPricingResult.ProductType;
            const categories = Array.isArray(productType.ProductCategory)
                ? productType.ProductCategory
                : [productType.ProductCategory];

            categories.forEach(category => {
                if (category.$.Name.toLowerCase() === 'register') {
                    const products = Array.isArray(category.Product) ? category.Product : [category.Product];
                    products.slice(0, 5).forEach(product => { // Get first 5 TLD prices
                        const prices = Array.isArray(product.Price) ? product.Price : [product.Price];
                        const oneYearPrice = prices.find(p => p.$.Duration === '1');
                        if (oneYearPrice && product.$.Name) {
                            pricingInfo[product.$.Name.toLowerCase()] = {
                                register: parseFloat(oneYearPrice.$.YourPrice) + parseFloat(oneYearPrice.$.YourAdditonalCost || '0'),
                                currency: 'USD'
                            };
                        }
                    });
                }
            });
        } catch (pricingError) {
            console.warn('[Account API] Could not fetch pricing info:', pricingError.message);
        }

        const accountBalance = parseFloat(balanceResult.$.AccountBalance) || 0;

        // Calculate how many domains can be registered with current balance
        const estimatedDomains = {
            com: pricingInfo.com ? Math.floor(accountBalance / pricingInfo.com.register) : 0,
            net: pricingInfo.net ? Math.floor(accountBalance / pricingInfo.net.register) : 0,
            org: pricingInfo.org ? Math.floor(accountBalance / pricingInfo.org.register) : 0
        };

        res.json({
            success: true,
            data: {
                account: {
                    username: NAMECHEAP_API_USER,
                    balance: accountBalance,
                    currency: 'USD',
                    apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
                },
                capabilities: {
                    estimatedDomains,
                    canRegister: accountBalance > 0,
                    minimumForRegistration: Math.min(...Object.values(pricingInfo).map(p => p.register).filter(Boolean)) || 10
                },
                pricing: pricingInfo,
                usage: {
                    balanceStatus: accountBalance > 50 ? 'healthy' : accountBalance > 10 ? 'moderate' : 'low',
                    recommendedTopUp: accountBalance < 100 ? 100 - accountBalance : 0,
                    lastChecked: new Date().toISOString()
                }
            },
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('[Account API] ❌ Error fetching account info:', {
            error: err.message,
            stack: err.stack
        });

        res.status(500).json({
            success: false,
            error: err.message,
            details: 'Failed to fetch account information',
            apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
        });
    }
});

// _________________________Domain Availability Checker (Optimized & Reliable)______________
router.get('/namecheap/domain/check/:domain', async (req, res) => {
    const domain = req.params.domain;
    const startTime = Date.now();

    // Enhanced domain validation
    if (!isValidDomain(domain)) {
        console.error(`[Domain API] Invalid domain format: ${domain}`);
        return res.status(400).json({
            status: "0",
            message: "Invalid domain format",
            data: null,
            apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production',
            processingTime: Date.now() - startTime
        });
    }

    try {
        // Parse domain into keyword and TLD
        const domainParts = domain.split('.');
        const keyword = domainParts.slice(0, -1).join('.');
        const originalTld = domainParts[domainParts.length - 1];

        console.log(`[Domain API] Checking "${keyword}.${originalTld}"`);

        // 1. Primary domain availability check with caching and error handling
        console.log(`[Domain API] Step 1: Primary availability check for ${domain}`);
        
        let primaryCheck, domainResult, isAvailable, isPremium, price, icannFee;
        
        try {
            // Check cache first
            const cacheKey = `domain_check_${domain}`;
            primaryCheck = getCachedData(cacheKey);
            
            if (!primaryCheck) {
                primaryCheck = await namecheapRequest('namecheap.domains.check', {
                    DomainList: domain
                });
                setCachedData(cacheKey, primaryCheck);
            } else {
                console.log(`[Domain API] Using cached data for ${domain}`);
            }

            domainResult = primaryCheck.ApiResponse.CommandResponse.DomainCheckResult;
            isAvailable = domainResult.$.Available === 'true';
            isPremium = domainResult.$.IsPremiumName === 'true';
            price = domainResult.$.Price ? parseFloat(domainResult.$.Price) : null;
            icannFee = domainResult.$.IcannFee ? parseFloat(domainResult.$.IcannFee) : 0.18;
        } catch (primaryError) {
            console.error(`[Domain API] Primary check failed for ${domain}:`, primaryError.message);
            return res.status(200).json({
                status: "0",
                message: "Unable to check domain availability at this time",
                data: {
                    domain,
                    available: null,
                    isPremium: null,
                    error: "Primary availability check failed",
                    processingTime: Date.now() - startTime
                },
                apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
            });
        }

        // 2. Get pricing for primary domain (with fallback)
        let primaryPricing = null;
        try {
            primaryPricing = await getPricingForTLD(originalTld);
        } catch (pricingError) {
            console.warn(`[Domain API] Pricing fetch failed for ${domain}:`, pricingError.message);
            primaryPricing = {
                register: null,
                renew: null,
                transfer: null,
                currency: 'USD'
            };
        }

        // 3. Get privacy protection information (with fallback)
        let privacyInfo = null;
        try {
            console.log(`[Domain API] Step 2.5: Getting privacy protection info for .${originalTld}`);
            privacyInfo = await getPrivacyProtectionInfo(originalTld);
        } catch (privacyError) {
            console.warn(`[Domain API] Privacy info fetch failed for ${domain}:`, privacyError.message);
            privacyInfo = {
                supported: null,
                available: null,
                pricing: { cost: null, currency: 'USD' },
                restrictions: ['Unable to determine privacy protection'],
                dataSource: 'error_fallback'
            };
        }

        // 4. Generate suggestions with better error handling
        let suggestions = {
            tldVariations: [],
            keywordVariations: [],
            premiumDomains: []
        };
        
        try {
            console.log(`[Domain API] Step 3: Generating suggestions for ${domain}`);
            
            const suggestionsPromise = generateProductionSuggestions(keyword, originalTld, isAvailable, false);
            suggestions = await Promise.race([
                suggestionsPromise,
                new Promise((resolve) => setTimeout(() => {
                    console.log('[Domain API] Suggestions generation timed out, using empty results');
                    resolve({
                        tldVariations: [],
                        keywordVariations: [],
                        premiumDomains: []
                    });
                }, 8000)) // Reduced to 8 second timeout
            ]);
        } catch (suggestionsError) {
            console.warn(`[Domain API] Suggestions generation failed for ${domain}:`, suggestionsError.message);
            // Continue with empty suggestions
        }

        // 5. Create domain groups (with error handling)
        let groups = [];
        try {
            groups = generateDomainGroups(suggestions, originalTld);
        } catch (groupsError) {
            console.warn(`[Domain API] Groups generation failed for ${domain}:`, groupsError.message);
            groups = [];
        }

        // 6. Calculate summary statistics
        const totalSuggestions = suggestions.tldVariations.length + suggestions.keywordVariations.length;
        const premiumCount = [...suggestions.tldVariations, ...suggestions.keywordVariations]
            .filter(d => d.isPremium).length;

        // 7. Build robust response
        const response = {
            status: "1",
            message: "Success",
            data: {
                // Primary domain information
                domain,
                keyword,
                tld: originalTld,
                available: isAvailable,
                availabilityStatus: isAvailable ? "AVAILABLE" : "UNAVAILABLE",
                namecheapAvailable: domainResult.$.Available,
                isPremium,

                // Primary domain pricing (with fallbacks)
                pricing: {
                    register: isPremium ? price : (primaryPricing?.register || null),
                    renew: primaryPricing?.renew || null,
                    transfer: primaryPricing?.transfer || null,
                    icannFee: icannFee || 0.18,
                    currency: 'USD',
                    isPremiumPricing: isPremium,
                    totalFirstYear: isPremium ?
                        (price || 0) + (icannFee || 0.18) :
                        (primaryPricing?.register || 0) + (icannFee || 0.18),
                    premiumDetails: isPremium ? {
                        registrationPrice: price
                    } : null
                },

                // Privacy Protection Information (with fallbacks)
                privacyProtection: {
                    supported: privacyInfo?.supported,
                    available: privacyInfo?.available,
                    pricing: privacyInfo?.pricing || { cost: null, currency: 'USD' },
                    restrictions: privacyInfo?.restrictions || ['Unable to determine'],
                    recommendation: privacyInfo?.supported === true ?
                        'Recommended for privacy and security' :
                        privacyInfo?.supported === false ?
                            'Consider alternative TLD if privacy is important' :
                            'Privacy support unknown - check during registration',
                    dataSource: privacyInfo?.dataSource || 'error_fallback',
                    note: 'Privacy information may be incomplete due to API limitations'
                },

                // Suggestions (with fallbacks)
                suggestions: {
                    tldVariations: suggestions.tldVariations || [],
                    keywordVariations: suggestions.keywordVariations || [],
                    premiumDomains: suggestions.premiumDomains || []
                },

                groups: groups || [],

                // Summary statistics
                summary: {
                    totalSuggestions,
                    tldVariationCount: suggestions.tldVariations?.length || 0,
                    keywordVariationCount: suggestions.keywordVariations?.length || 0,
                    premiumCount,
                    recommendedAction: isAvailable ? 'register' : 'consider_alternatives',
                    bestAlternative: totalSuggestions > 0 ?
                        (suggestions.tldVariations?.[0] || suggestions.keywordVariations?.[0]) : null
                },

                // Metadata
                metadata: {
                    searchKeyword: keyword,
                    originalTld,
                    processingTime: Date.now() - startTime,
                    apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production',
                    timestamp: new Date().toISOString(),
                    cacheHits: pricingCache.size,
                    suggestionAlgorithm: 'production_v2_robust'
                }
            }
        };

        // 8. Add availability-specific messaging
        if (isAvailable) {
            response.data.message = isPremium ?
                'Premium domain available for registration' :
                'Domain available for registration';
            response.data.nextSteps = {
                action: 'register',
                requiredFields: ['userId', 'contactInfo', 'years', 'nameservers'],
                optionalFields: ['enablePrivacy'],
                privacyNote: privacyInfo?.supported ?
                    'Privacy protection can be enabled during registration (free)' :
                    'Privacy protection not available for this TLD'
            };
        } else {
            response.data.message = totalSuggestions > 0 ?
                `Domain unavailable. Found ${totalSuggestions} alternative${totalSuggestions === 1 ? '' : 's'}` :
                'Domain unavailable. Consider trying different keywords or extensions.';
            response.data.nextSteps = {
                action: 'select_alternative',
                suggestions: totalSuggestions,
                recommendedGroup: groups.length > 0 ? groups[0].name : null
            };
        }

        // 9. Add sandbox mode warnings
        if (NAMECHEAP_SANDBOX === 'true') {
            response.data.sandboxWarning = {
                mode: 'sandbox',
                note: 'Running in sandbox mode - availability and pricing may not reflect real-world data',
                limitations: [
                    'Some domains are reserved in sandbox',
                    'Pricing may be simulated',
                    'Suggestions may be limited'
                ]
            };
        }

        console.log(`[Domain API] ✅ Check completed for ${domain} in ${Date.now() - startTime}ms`);
        console.log(`[Domain API] Results: Available=${isAvailable}, Premium=${isPremium}, Suggestions=${totalSuggestions}`);

        res.json(response);

    } catch (err) {
        console.error('[Domain API] ❌ Unexpected error in domain check:', {
            error: err.message,
            domain,
            status: err.response?.status,
            responseData: err.response?.data,
            stack: err.stack,
            processingTime: Date.now() - startTime,
            timestamp: new Date().toISOString()
        });

        // Return 200 with error info instead of 500
        res.status(200).json({
            status: "0",
            message: "Domain check completed with errors",
            data: {
                domain,
                available: null,
                isPremium: null,
                error: "Unexpected error occurred during domain check",
                processingTime: Date.now() - startTime,
                timestamp: new Date().toISOString()
            },
            error: {
                type: 'unexpected_error',
                details: err.message,
                domain,
                recoveryOptions: [
                    'Try again in a few moments',
                    'Check domain spelling',
                    'Contact support if problem persists'
                ]
            },
            apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
        });
    }
});



//  _________________________Get pricing for all TLDs and actions______________

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


//  _________________________Bulk Domain Pricing Check______________

router.post('/namecheap/domain/bulk-pricing', apiLimiter, asyncHandler(async (req, res) => {
    const operation = 'BULK_PRICING_CHECK';
    const { domains, years = 1 } = req.body;
    const startTime = Date.now();

    // Validate input
    if (!domains || !Array.isArray(domains) || domains.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'Domains array is required',
            details: 'Please provide an array of domains to check',
            example: {
                domains: ['example.com', 'test.net', 'mydomain.org'],
                years: 2
            }
        });
    }

    // Limit the number of domains to prevent API abuse
    if (domains.length > 50) {
        return res.status(400).json({
            success: false,
            error: 'Too many domains requested',
            details: 'Maximum 50 domains allowed per request',
            provided: domains.length,
            limit: 50
        });
    }

    // Validate each domain format
    const invalidDomains = domains.filter(domain => !isValidDomain(domain));
    if (invalidDomains.length > 0) {
        return res.status(400).json({
            success: false,
            error: 'Invalid domain format(s) detected',
            invalidDomains,
            details: 'Please check the format of the provided domains'
        });
    }

    // Validate years
    const yearsInt = parseInt(years);
    if (isNaN(yearsInt) || yearsInt < 1 || yearsInt > 10) {
        return res.status(400).json({
            success: false,
            error: 'Invalid years parameter',
            details: 'Years must be between 1 and 10',
            provided: years
        });
    }

    try {
        console.log(`[Bulk Pricing API] Checking ${domains.length} domains for ${years} year(s)`);

        // Step 1: Bulk availability check with timeout
        const domainList = domains.join(',');
        console.log(`[Bulk Pricing API] Making bulk availability check for: ${domainList}`);

        const bulkCheckPromise = namecheapRequest('namecheap.domains.check', {
            DomainList: domainList
        });

        const bulkCheck = await Promise.race([
            bulkCheckPromise,
            new Promise((_, reject) => setTimeout(() => {
                reject(new Error('Bulk availability check timed out'));
            }, 15000)) // 15 second timeout
        ]);

        // Parse the bulk check results
        const checkResults = bulkCheck.ApiResponse.CommandResponse.DomainCheckResult;
        const resultsArray = Array.isArray(checkResults) ? checkResults : [checkResults];

        // Step 2: Get unique TLDs for pricing lookup
        const uniqueTlds = [...new Set(domains.map(domain => {
            return domain.split('.').pop().toUpperCase();
        }))];

        console.log(`[Bulk Pricing API] Getting pricing for ${uniqueTlds.length} unique TLDs: ${uniqueTlds.join(', ')}`);

        // Step 3: Fetch pricing for all unique TLDs with timeout
        const tldPricingPromises = uniqueTlds.map(async (tld) => {
            try {
                if (yearsInt === 1) {
                    const pricingPromise = getPricingForTLD(tld);
                    const pricing = await Promise.race([
                        pricingPromise,
                        new Promise((_, reject) => setTimeout(() => {
                            reject(new Error('Pricing fetch timeout'));
                        }, 10000)) // 10 second timeout
                    ]);
                    return { tld, pricing };
                } else {
                    // Get multi-year pricing with timeout
                    const priceXmlPromise = namecheapRequest('namecheap.users.getPricing', {
                        ProductType: 'DOMAIN',
                        ProductCategory: 'REGISTER',
                        ProductName: tld
                    });
                    
                    const priceXml = await Promise.race([
                        priceXmlPromise,
                        new Promise((_, reject) => setTimeout(() => {
                            reject(new Error('Pricing XML fetch timeout'));
                        }, 10000)) // 10 second timeout
                    ]);
                    
                    let pricing;
                    try {
                        pricing = extractPriceForDuration(priceXml, years);
                    } catch (extractionError) {
                        console.warn(`[Bulk Pricing API] Failed to extract pricing for .${tld}:`, extractionError.message);
                        throw new Error(`Pricing extraction failed: ${extractionError.message}`);
                    }
                    
                    return { tld, pricing };
                }
            } catch (error) {
                console.warn(`[Bulk Pricing API] Failed to get pricing for .${tld}:`, error.message);
                return {
                    tld,
                    pricing: {
                        register: null,
                        renew: null,
                        transfer: null,
                        currency: 'USD',
                        error: error.message
                    }
                };
            }
        });

        const tldPricingResults = await Promise.all(tldPricingPromises);
        const tldPricingMap = {};
        tldPricingResults.forEach(result => {
            tldPricingMap[result.tld] = result.pricing;
        });

        // Step 4: Combine availability and pricing data
        const results = resultsArray.map(domainResult => {
            const domain = domainResult.$.Domain;
            const isAvailable = domainResult.$.Available === 'true';
            const isPremium = domainResult.$.IsPremiumName === 'true';
            const price = domainResult.$.Price ? parseFloat(domainResult.$.Price) : null;
            const icannFee = domainResult.$.IcannFee ? parseFloat(domainResult.$.IcannFee) : 0.18;

            const tld = domain.split('.').pop().toUpperCase();
            const tldPricing = tldPricingMap[tld] || { register: null, renew: null, transfer: null };

            return {
                domain,
                tld: tld.toLowerCase(),
                available: isAvailable,
                isPremium,
                years: yearsInt,
                pricing: {
                    register: isPremium ? price : tldPricing.register,
                    renew: tldPricing.renew,
                    transfer: tldPricing.transfer,
                    icannFee: yearsInt === 1 ? icannFee : icannFee * yearsInt,
                    currency: 'USD',
                    totalFirstYear: isPremium ?
                        (price || 0) + icannFee :
                        (tldPricing.register || 0) + icannFee,
                    totalForYears: yearsInt === 1 ?
                        (isPremium ? (price || 0) : (tldPricing.register || 0)) + icannFee :
                        tldPricing.totalCost || null,
                    perYearCost: yearsInt === 1 ?
                        (isPremium ? (price || 0) : (tldPricing.register || 0)) + icannFee :
                        tldPricing.perYearCost || null,
                    savings: yearsInt > 1 ? tldPricing.savings : null,
                    isPremiumPricing: isPremium,
                    pricingError: tldPricing.error || null
                },
                status: isAvailable ? 'available' : 'unavailable',
                checkTimestamp: new Date().toISOString()
            };
        });

        // Step 5: Calculate summary statistics
        const summary = {
            totalDomains: domains.length,
            availableDomains: results.filter(r => r.available).length,
            unavailableDomains: results.filter(r => !r.available).length,
            premiumDomains: results.filter(r => r.isPremium).length,
            totalEstimatedCost: results
                .filter(r => r.available && r.pricing.totalFirstYear)
                .reduce((sum, r) => sum + r.pricing.totalFirstYear, 0),
            uniqueTlds: uniqueTlds.length,
            years: yearsInt,
            processingTime: Date.now() - startTime
        };

        // Step 6: Group results by availability and TLD
        const groupedResults = {
            available: results.filter(r => r.available),
            unavailable: results.filter(r => !r.available),
            premium: results.filter(r => r.isPremium),
            byTld: {}
        };

        // Group by TLD
        results.forEach(result => {
            const tld = result.tld;
            if (!groupedResults.byTld[tld]) {
                groupedResults.byTld[tld] = [];
            }
            groupedResults.byTld[tld].push(result);
        });

        console.log(`[Bulk Pricing API] ✅ Processed ${domains.length} domains in ${Date.now() - startTime}ms`);

        res.json({
            success: true,
            data: {
                summary,
                results,
                grouped: groupedResults,
                metadata: {
                    requestedDomains: domains.length,
                    processedDomains: results.length,
                    years: yearsInt,
                    processingTime: Date.now() - startTime,
                    timestamp: new Date().toISOString(),
                    pricingCacheHits: pricingCache.size
                }
            },
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('[Bulk Pricing API] ❌ Error in bulk pricing check:', {
            error: err.message,
            domainsCount: domains.length,
            years,
            processingTime: Date.now() - startTime
        });

        const errorResponse = createErrorResponse(err, operation);
        errorResponse.details = {
            requestedDomains: domains.length,
            years: yearsInt,
            processingTime: Date.now() - startTime,
            recoveryOptions: [
                'Try with fewer domains (max 50 per request)',
                'Check if all domains have valid format',
                'Retry the request after a moment',
                'Contact support if the issue persists'
            ]
        };
        res.status(500).json(errorResponse);
    }
}));





//  _________________________Alternative: Get multi-year pricing with query parameter______________

router.get('/namecheap/domain/:domain/pricing', apiLimiter, asyncHandler(async (req, res) => {
    const operation = 'GET_DOMAIN_PRICING';
    const { domain } = req.params;
    const { years = '1' } = req.query;

    console.log(`[Domain Pricing API] 💰 Getting ${years}-year pricing for domain: ${domain} (query param version)`);

    // Validate domain
    if (!isValidDomain(domain)) {
        console.error(`[Domain Pricing API] Invalid domain format: ${domain}`);
        return res.status(400).json({
            success: false,
            error: "Invalid domain format",
            data: null,
            apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
        });
    }

    // Validate years (1-10 years supported)
    const yearsInt = parseInt(years);
    if (isNaN(yearsInt) || yearsInt < 1 || yearsInt > 10) {
        return res.status(400).json({
            success: false,
            error: "Years must be between 1 and 10",
            data: null,
            apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
        });
    }

    try {
        // 1. Check if domain is available
        console.log(`[Domain Pricing API] Step 1: Checking availability for ${domain}`);
        const checkResult = await namecheapRequest('namecheap.domains.check', {
            DomainList: domain
        });

        const domainResult = checkResult.ApiResponse.CommandResponse.DomainCheckResult;
        const available = domainResult.$.Available === 'true';
        const isPremium = domainResult.$.IsPremiumName === 'true';
        const price = domainResult.$.Price ? parseFloat(domainResult.$.Price) : null;

        if (!available) {
            return res.status(200).json({
                success: true,
                message: "Domain is not available for registration",
                data: {
                    domain,
                    available: false,
                    isPremium,
                    price,
                    note: "This domain is already registered or reserved"
                },
                apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
            });
        }

        // 2. Get TLD and fetch multi-year pricing with caching
        const tld = domain.split('.').pop().toUpperCase();
        console.log(`[Domain Pricing API] Step 2: Fetching ${years}-year pricing for TLD ${tld}`);

        // Check cache first
        const pricingCacheKey = `pricing_${tld}_${years}`;
        let priceXml = getCachedData(pricingCacheKey);
        
        if (!priceXml) {
            priceXml = await namecheapRequest('namecheap.users.getPricing', {
                ProductType: 'DOMAIN',
                ProductCategory: 'REGISTER',
                ProductName: tld
            });
            setCachedData(pricingCacheKey, priceXml);
        } else {
            console.log(`[Domain Pricing API] Using cached pricing data for .${tld} (${years} years)`);
        }

        // Use appropriate extraction function based on years with error handling
        let pricing;
        try {
            pricing = yearsInt === 1
                ? extractOneYearPrice(priceXml)
                : extractPriceForDuration(priceXml, years);
        } catch (extractionError) {
            console.error(`[Domain Pricing API] Error extracting pricing for ${domain}:`, extractionError.message);
            return res.status(500).json({
                success: false,
                error: "Failed to extract pricing information",
                data: {
                    domain,
                    years: yearsInt,
                    available: true,
                    tld,
                    message: "Pricing extraction failed",
                    extractionError: extractionError.message
                },
                apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
            });
        }

        if (!pricing || pricing.register === null) {
            return res.status(200).json({
                success: true,
                message: `${years}-year pricing not available for this TLD`,
                data: {
                    domain,
                    years: yearsInt,
                    available: true,
                    tld,
                    pricing: null,
                    message: `This TLD may not support ${years}-year registration`,
                    note: "Try checking with different year values (2-10 years) or contact support for pricing information"
                },
                apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
            });
        }

        // 3. For premium domains, add premium pricing if available
        if (isPremium && price) {
            pricing.premiumNote = "This is a premium domain with special pricing";
            pricing.premiumPrice = price;
            pricing.isPremium = true;
        }

        // 4. Add error handling for missing pricing data
        if (!pricing || typeof pricing !== 'object') {
            console.error(`[Domain Pricing API] Invalid pricing data for ${domain}:`, pricing);
            return res.status(500).json({
                success: false,
                error: "Failed to extract pricing information",
                data: {
                    domain,
                    years: yearsInt,
                    available: true,
                    tld,
                    message: "Pricing extraction failed"
                },
                apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
            });
        }

        // 4. Format response based on whether it's 1-year or multi-year
        const responseData = {
            domain,
            available: true,
            isPremium,
            years: yearsInt,
            pricing: pricing
        };

        // Add multi-year specific data if applicable
        if (yearsInt > 1 && pricing.savings) {
            responseData.comparison = {
                oneYearTotal: pricing.perYearCost,
                multiYearTotal: pricing.totalCost,
                savingsInfo: {
                    youSave: `$${pricing.savings.amount.toFixed(2)}`,
                    percentageSaved: `${pricing.savings.percentage}%`,
                    explanation: `Registering for ${years} years saves you $${pricing.savings.amount.toFixed(2)} compared to renewing annually`
                }
            };

            responseData.breakdown = {
                registrationFee: pricing.register,
                icannFee: pricing.icannFee,
                subtotal: pricing.register + pricing.icannFee,
                total: pricing.totalCost,
                currency: pricing.currency
            };
        }

        res.json({
            success: true,
            data: responseData,
            apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production',
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error('[Domain Pricing API] ❌ Error in pricing process:', {
            error: err.message,
            domain,
            years,
            status: err.response?.status,
            responseData: err.response?.data,
            stack: err.stack,
            timestamp: new Date().toISOString()
        });

        const errorResponse = createErrorResponse(err, operation);
        errorResponse.details = {
            domain,
            years: yearsInt,
            apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
        };
        res.status(500).json(errorResponse);
    }
}));





//__________Register a domain__________

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
        enablePrivacy = false,
        customNameservers = null,
        useNamecheapDNS = false,
        acceptPremiumPricing = false
    } = req.body;

    const userId = req.userId;

    try {
        // Use the extracted registration function
        const result = await registerDomainWithNamecheap({
            userId,
            domain,
            firstName,
            lastName,
            email,
            phone,
            address1,
            address2,
            city,
            stateProvince,
            country,
            postalCode,
            years,
            enablePrivacy,
            customNameservers,
            useNamecheapDNS,
            acceptPremiumPricing
        });

        // Return the result directly
        res.json(result);

    } catch (error) {
        console.error('[Domain API] Registration error:', {
            error: error.message,
            domain,
            userId,
            stack: error.stack
        });

        // Handle specific error cases
        if (error.message.includes('Invalid request IP')) {
            const errorMatch = error.message.match(/Invalid request IP: (\d+\.\d+\.\d+\.\d+)/);
            const ipAddress = errorMatch ? errorMatch[1] : process.env.NAMECHEAP_CLIENT_IP;
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
                    ipAddress: ipAddress,
                    errorNumber: '1011150',
                    errorMessage: `Invalid request IP: ${ipAddress}`
                }
            });
        }

        if (error.message.includes('premium domain') || error.message.includes('Premium price')) {
            return res.status(400).json({
                success: false,
                error: 'Premium domain registration failed',
                details: {
                    message: 'This is a premium domain that requires additional pricing information',
                    domain,
                    isPremium: true,
                    steps: [
                        '1. Check domain pricing first using the check endpoint',
                        '2. Confirm you want to pay the premium price',
                        '3. Ensure your account has sufficient balance',
                        '4. Try the registration again'
                    ],
                    errorMessage: error.message,
                    checkPricingEndpoint: `/namecheap/domain/check/${domain}`
                }
            });
        }

        res.status(500).json({
            success: false,
            error: error.message,
            details: error.message,
            apiMode: process.env.NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
        });
    }
});

// router.get('/namecheap/domains/list', validateUserId, async (req, res) => {
//     const userId = req.userId;

//     try {
//         console.log(`[Domain API] 📋 Fetching domains for user: ${userId}`);

//         // Get user domains from database
//         const userDomains = await getUserDomainsFromDatabase(userId);

//         if (userDomains.length === 0) {
//             return res.json({
//                 success: true,
//                 userId,
//                 data: {
//                     domains: [],
//                     total: 0,
//                     message: 'No domains found for this user',
//                     apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
//                 }
//             });
//         }

//         // For each domain in database, get live status from Namecheap API
//         const detailedDomains = await Promise.all(userDomains.map(async (dbDomain) => {
//             const domainObj = {
//                 // Database information
//                 _id: dbDomain._id,
//                 userId: dbDomain.userId,
//                 domain: dbDomain.domain,
//                 registrationData: dbDomain.registrationData,
//                 contactInfo: dbDomain.contactInfo,
//                 domainStatus: dbDomain.domainStatus,
//                 dnsConfiguration: dbDomain.dnsConfiguration,
//                 redirects: dbDomain.redirects || [],
//                 emailAccounts: dbDomain.emailAccounts || [],
//                 pricing: dbDomain.pricing,
//                 stripePayment: dbDomain.stripePayment || null,
//                 createdAt: dbDomain.createdAt,
//                 updatedAt: dbDomain.updatedAt,

//                 // Initialize live status
//                 liveStatus: {
//                     available: false,
//                     error: null,
//                     lastChecked: new Date().toISOString()
//                 }
//             };

//             try {
//                 // Get live domain info from Namecheap (optional - can be disabled for performance)
//                 const domainInfo = await namecheapRequest('namecheap.domains.getInfo', {
//                     DomainName: dbDomain.domain
//                 });

//                 const namecheapResult = domainInfo.ApiResponse.CommandResponse.DomainGetInfoResult;

//                 // Update live status from Namecheap API
//                 domainObj.liveStatus = {
//                     available: true,
//                     status: namecheapResult.$.Status,
//                     isExpired: namecheapResult.$.IsExpired === 'true',
//                     isLocked: namecheapResult.$.IsLocked === 'true',
//                     autoRenew: namecheapResult.$.AutoRenew === 'true',
//                     isPremium: namecheapResult.$.IsPremium === 'true',
//                     lastChecked: new Date().toISOString(),
//                     nameservers: Array.isArray(namecheapResult.DnsDetails.Nameserver)
//                         ? namecheapResult.DnsDetails.Nameserver
//                         : [namecheapResult.DnsDetails.Nameserver],
//                     isUsingNamecheapDNS: namecheapResult.DnsDetails.$.IsUsingOurDNS === 'true'
//                 };

//                 // 🔁 Fetch live redirects from DNS hosts
//                 try {
//                     const dnsHosts = await namecheapRequest('namecheap.domains.dns.getHosts', {
//                         DomainName: dbDomain.domain
//                     });

//                     const hosts = dnsHosts.ApiResponse.CommandResponse?.DomainDNSGetHostsResult?.host;
//                     const hostsList = hosts ? (Array.isArray(hosts) ? hosts : [hosts]) : [];

//                     const liveRedirects = hostsList
//                         .filter(host => host.$ && ['URL301', 'URL302', 'FRAME'].includes(host.$.Type))
//                         .map(host => ({
//                             type: host.$.Type,
//                             address: host.$.Address,
//                             title: host.$.Title || '',
//                             keywords: host.$.Keywords || '',
//                             description: host.$.Description || '',
//                             ttl: host.$.TTL,
//                             host: host.$.Name || '@',
//                             lastUpdated: new Date().toISOString(),
//                             source: 'live_dns'
//                         }));

//                     // Update redirects with live data if available, otherwise use database data
//                     domainObj.redirects = liveRedirects.length > 0 ? liveRedirects : dbDomain.redirects || [];

//                     // Add metadata about redirect source
//                     domainObj.redirectMetadata = {
//                         source: liveRedirects.length > 0 ? 'live_dns' : 'database',
//                         liveCount: liveRedirects.length,
//                         databaseCount: dbDomain.redirects?.length || 0,
//                         lastSync: new Date().toISOString()
//                     };

//                     console.log(`[Domain API] Fetched ${liveRedirects.length} live redirects for ${dbDomain.domain}`);
//                 } catch (redirectError) {
//                     console.warn(`[Domain API] Could not fetch live redirects for ${dbDomain.domain}:`, redirectError.message);
//                     // Fallback to database redirects
//                     domainObj.redirects = dbDomain.redirects || [];
//                     domainObj.redirectMetadata = {
//                         source: 'database_fallback',
//                         error: redirectError.message,
//                         databaseCount: dbDomain.redirects?.length || 0,
//                         lastSync: new Date().toISOString()
//                     };
//                 }

//                 // Update database with live information if there are significant changes
//                 const updateData = {};
//                 let needsUpdate = false;

//                 if (domainObj.domainStatus.autoRenew !== (namecheapResult.$.AutoRenew === 'true')) {
//                     updateData['domainStatus.autoRenew'] = namecheapResult.$.AutoRenew === 'true';
//                     needsUpdate = true;
//                 }

//                 if (domainObj.domainStatus.isLocked !== (namecheapResult.$.IsLocked === 'true')) {
//                     updateData['domainStatus.isLocked'] = namecheapResult.$.IsLocked === 'true';
//                     needsUpdate = true;
//                 }

//                 if (needsUpdate) {
//                     await updateDomainInDatabase(userId, dbDomain.domain, updateData);
//                     console.log(`[Domain API] Updated live status for ${dbDomain.domain}`);
//                 }

//             } catch (namecheapError) {
//                 console.error(`[Domain API] Error fetching live status for ${dbDomain.domain}:`, {
//                     error: namecheapError.message,
//                     userId,
//                     domain: dbDomain.domain
//                 });

//                 domainObj.liveStatus = {
//                     available: false,
//                     error: namecheapError.message,
//                     lastChecked: new Date().toISOString(),
//                     note: 'Using cached database information'
//                 };

//                 // Use database redirects as fallback
//                 domainObj.redirects = dbDomain.redirects || [];
//                 domainObj.redirectMetadata = {
//                     source: 'database_error_fallback',
//                     error: namecheapError.message,
//                     databaseCount: dbDomain.redirects?.length || 0,
//                     lastSync: new Date().toISOString()
//                 };
//             }

//             return domainObj;
//         }));

//         // Sort domains by creation date (newest first)
//         detailedDomains.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

//         res.json({
//             success: true,
//             userId,
//             data: {
//                 domains: detailedDomains,
//                 total: detailedDomains.length,
//                 apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production',
//                 dataSource: 'database_with_live_sync',
//                 lastSync: new Date().toISOString(),
//                 sandboxWarning: NAMECHEAP_SANDBOX === 'true' ?
//                     'Running in sandbox mode - Live status may not be accurate' : null
//             }
//         });

//     } catch (err) {
//         console.error('[Domain API] ❌ Error fetching user domains:', {
//             error: err.message,
//             userId,
//             stack: err.stack
//         });

//         res.status(500).json({
//             success: false,
//             userId,
//             error: err.message,
//             details: 'Failed to fetch user domains from database',
//             apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
//         });
//     }
// });


// Cache for API responses to avoid hitting rate limits
const apiCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Simple cache helper function
function getCachedData(key) {
    const cached = apiCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }
    return null;
}

function setCachedData(key, data) {
    apiCache.set(key, {
        data,
        timestamp: Date.now()
    });
}


// Rate limiting queue
class RateLimitedQueue {
    constructor(maxCallsPerMinute = 18) { // Leave buffer for other operations
        this.queue = [];
        this.processing = false;
        this.maxCallsPerMinute = maxCallsPerMinute;
        this.callTimes = [];
    }

    async add(apiCall) {
        return new Promise((resolve, reject) => {
            this.queue.push({ apiCall, resolve, reject });
            this.process();
        });
    }

    async process() {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;

        while (this.queue.length > 0) {
            // Clean old call times (older than 1 minute)
            const now = Date.now();
            this.callTimes = this.callTimes.filter(time => now - time < 60000);

            // Check if we need to wait
            if (this.callTimes.length >= this.maxCallsPerMinute) {
                const oldestCall = Math.min(...this.callTimes);
                const waitTime = 60000 - (now - oldestCall) + 100; // Add small buffer
                console.log(`[Rate Limit] Waiting ${waitTime}ms before next call`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }

            const { apiCall, resolve, reject } = this.queue.shift();
            
            try {
                this.callTimes.push(now);
                const result = await apiCall();
                resolve(result);
            } catch (error) {
                reject(error);
            }

            // Small delay between calls
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        this.processing = false;
    }
}

const rateLimitedQueue = new RateLimitedQueue();

router.get('/namecheap/domains/list', validateUserId, async (req, res) => {
    const userId = req.userId;
    const includeLiveStatus = req.query.live === 'true';
    const forceRefresh = req.query.refresh === 'true';
    const timeout = parseInt(req.query.timeout) || 8000;

    try {
        console.log(`[Domain API] 📋 Fetching domains for user: ${userId}, live: ${includeLiveStatus}`);

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

        // Return quick response with database data only
        if (!includeLiveStatus) {
            const quickDomains = userDomains.map(dbDomain => ({
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
                stripePayment: dbDomain.stripePayment || null,
                createdAt: dbDomain.createdAt,
                updatedAt: dbDomain.updatedAt,
                liveStatus: {
                    available: false,
                    note: 'Live status not requested - use ?live=true for real-time data',
                    lastChecked: null
                }
            }));

            // Sort by creation date (newest first)
            quickDomains.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            return res.json({
                success: true,
                userId,
                data: {
                    domains: quickDomains,
                    total: quickDomains.length,
                    apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production',
                    dataSource: 'database_only',
                    responseTime: 'fast',
                    note: 'Add ?live=true to get real-time status (slower response)'
                }
            });
        }

        // Cached API call function
        const getCachedApiData = async (cacheKey, apiCall, forceRefresh = false) => {
            if (!forceRefresh && apiCache.has(cacheKey)) {
                const cached = apiCache.get(cacheKey);
                if (Date.now() - cached.timestamp < CACHE_DURATION) {
                    console.log(`[Cache] Using cached data for ${cacheKey}`);
                    return cached.data;
                }
                apiCache.delete(cacheKey);
            }

            try {
                const data = await rateLimitedQueue.add(apiCall);
                apiCache.set(cacheKey, {
                    data,
                    timestamp: Date.now()
                });
                return data;
            } catch (error) {
                console.error(`[API Error] ${cacheKey}:`, error.message);
                throw error;
            }
        };

        // For live status, implement with caching and rate limiting
        const fetchDomainDetails = async (dbDomain) => {
            const domainObj = {
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
                stripePayment: dbDomain.stripePayment || null,
                createdAt: dbDomain.createdAt,
                updatedAt: dbDomain.updatedAt,
                liveStatus: {
                    available: false,
                    error: null,
                    lastChecked: new Date().toISOString(),
                    cached: false
                }
            };

            try {
                // Fetch domain info with caching and rate limiting
                const domainInfo = await getCachedApiData(
                    `domain_info_${dbDomain.domain}`,
                    () => namecheapRequest('namecheap.domains.getInfo', {
                        DomainName: dbDomain.domain
                    }),
                    forceRefresh
                );

                const namecheapResult = domainInfo.ApiResponse.CommandResponse.DomainGetInfoResult;

                // Update live status
                const cacheKey = `domain_info_${dbDomain.domain}`;
                const isCached = apiCache.has(cacheKey) && !forceRefresh;
                
                domainObj.liveStatus = {
                    available: true,
                    status: namecheapResult.$.Status,
                    isExpired: namecheapResult.$.IsExpired === 'true',
                    isLocked: namecheapResult.$.IsLocked === 'true',
                    autoRenew: namecheapResult.$.AutoRenew === 'true',
                    isPremium: namecheapResult.$.IsPremium === 'true',
                    lastChecked: new Date().toISOString(),
                    cached: isCached,
                    nameservers: Array.isArray(namecheapResult.DnsDetails.Nameserver)
                        ? namecheapResult.DnsDetails.Nameserver
                        : [namecheapResult.DnsDetails.Nameserver],
                    isUsingNamecheapDNS: namecheapResult.DnsDetails.$.IsUsingOurDNS === 'true'
                };

                // Only fetch DNS hosts if using Namecheap DNS and not recently cached
                if (namecheapResult.DnsDetails.$.IsUsingOurDNS === 'true') {
                    try {
                        const dnsHosts = await getCachedApiData(
                            `dns_hosts_${dbDomain.domain}`,
                            () => namecheapRequest('namecheap.domains.dns.getHosts', {
                                DomainName: dbDomain.domain
                            }),
                            forceRefresh
                        );

                        const hosts = dnsHosts.ApiResponse.CommandResponse?.DomainDNSGetHostsResult?.host;
                        const hostsList = hosts ? (Array.isArray(hosts) ? hosts : [hosts]) : [];

                        const liveRedirects = hostsList
                            .filter(host => host.$ && ['URL301', 'URL302', 'FRAME'].includes(host.$.Type))
                            .map(host => ({
                                type: host.$.Type,
                                address: host.$.Address,
                                title: host.$.Title || '',
                                keywords: host.$.Keywords || '',
                                description: host.$.Description || '',
                                ttl: host.$.TTL,
                                host: host.$.Name || '@',
                                lastUpdated: new Date().toISOString(),
                                source: 'live_dns'
                            }));

                        domainObj.redirects = liveRedirects.length > 0 ? liveRedirects : dbDomain.redirects || [];
                        domainObj.redirectMetadata = {
                            source: liveRedirects.length > 0 ? 'live_dns' : 'database',
                            liveCount: liveRedirects.length,
                            databaseCount: dbDomain.redirects?.length || 0,
                            lastSync: new Date().toISOString(),
                            cached: apiCache.has(`dns_hosts_${dbDomain.domain}`)
                        };

                    } catch (redirectError) {
                        console.warn(`[Domain API] DNS hosts fetch failed for ${dbDomain.domain}:`, redirectError.message);
                        domainObj.redirects = dbDomain.redirects || [];
                        domainObj.redirectMetadata = {
                            source: 'database_fallback',
                            error: redirectError.message,
                            databaseCount: dbDomain.redirects?.length || 0,
                            lastSync: new Date().toISOString()
                        };
                    }
                } else {
                    // Not using Namecheap DNS, use database redirects
                    domainObj.redirects = dbDomain.redirects || [];
                    domainObj.redirectMetadata = {
                        source: 'database_external_dns',
                        note: 'Using external DNS - live redirects not available',
                        databaseCount: dbDomain.redirects?.length || 0,
                        lastSync: new Date().toISOString()
                    };
                }

                // Background database update (non-blocking)
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
                    // Non-blocking update
                    updateDomainInDatabase(userId, dbDomain.domain, updateData)
                        .then(() => console.log(`[Domain API] Updated live status for ${dbDomain.domain}`))
                        .catch(err => console.warn(`[Domain API] Background update failed for ${dbDomain.domain}:`, err.message));
                }

            } catch (namecheapError) {
                console.error(`[Domain API] Live status fetch failed for ${dbDomain.domain}:`, namecheapError.message);

                domainObj.liveStatus = {
                    available: false,
                    error: namecheapError.message,
                    lastChecked: new Date().toISOString(),
                    note: 'Using cached database information'
                };

                domainObj.redirects = dbDomain.redirects || [];
                domainObj.redirectMetadata = {
                    source: 'database_error_fallback',
                    error: namecheapError.message,
                    databaseCount: dbDomain.redirects?.length || 0,
                    lastSync: new Date().toISOString()
                };
            }

            return domainObj;
        };

        // Process domains sequentially to respect rate limits (no parallel processing)
        const detailedDomains = [];
        let processedCount = 0;
        
        for (const dbDomain of userDomains) {
            try {
                const domainDetails = await Promise.race([
                    fetchDomainDetails(dbDomain),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Domain fetch timeout')), timeout)
                    )
                ]);
                detailedDomains.push(domainDetails);
                processedCount++;
                
                // Progress logging
                console.log(`[Domain API] Processed ${processedCount}/${userDomains.length} domains for user ${userId}`);
                
            } catch (error) {
                console.error(`[Domain API] Failed to process domain ${dbDomain.domain}:`, error.message);
                
                // Add domain with error status
                detailedDomains.push({
                    ...dbDomain,
                    liveStatus: {
                        available: false,
                        error: error.message,
                        lastChecked: new Date().toISOString(),
                        note: 'Using database information due to API error'
                    }
                });
                processedCount++;
            }
        }

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
                timeout: timeout,
                concurrentLimit: CONCURRENT_LIMIT,
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

    if (!domain || !destinationUrl) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: userId, domain and destinationUrl are required'
        });
    }

    try {
        new URL(destinationUrl);
    } catch (error) {
        return res.status(400).json({
            success: false,
            error: 'Invalid destination URL format'
        });
    }

    if (!['301', '302'].includes(type)) {
        return res.status(400).json({
            success: false,
            error: 'Redirect type must be either "301" or "302"'
        });
    }

    const domainParts = domain.split('.');
    if (domainParts.length < 2) {
        return res.status(400).json({
            success: false,
            error: 'Invalid domain format'
        });
    }

    try {
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

        const sld = domainParts.slice(0, -1).join('.');
        const tld = domainParts[domainParts.length - 1];

        const existingRecords = await namecheapRequest('namecheap.domains.dns.getHosts', {
            SLD: sld,
            TLD: tld
        });

        const currentHosts = existingRecords.ApiResponse.CommandResponse.DomainDNSGetHostsResult.host || [];
        const hostsArray = Array.isArray(currentHosts) ? currentHosts : [currentHosts];

        const preservedRecords = hostsArray.filter(record => {
            const hostName = record.$.Name;
            const recordType = record.$.Type;

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

        const redirectRecords = [];

        if (masked) {
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
            redirectRecords.push({
                HostName: '@',
                RecordType: type === '301' ? 'URL301' : 'URL302',
                Address: destinationUrl,
                TTL: '1800'
            });
        }

        // Optional: redirect www as well
        redirectRecords.push({
            HostName: 'www',
            RecordType: masked ? 'FRAME' : (type === '301' ? 'URL301' : 'URL302'),
            Address: destinationUrl,
            TTL: '1800',
            ...(masked ? {
                Title: title || domain,
                Keywords: keywords,
                Description: description
            } : {})
        });

        const allRecords = [...preservedRecords, ...redirectRecords];

        if (allRecords.length === 0) {
            allRecords.push({
                HostName: '@',
                RecordType: 'A',
                Address: '192.0.2.1',
                TTL: '1800'
            });
        }

        console.log(`[Redirect API] Updating DNS with ${allRecords.length} records`);

        // 🔧 Flatten record list for API
        const hostParams = {};
        allRecords.forEach((record, index) => {
            const i = index + 1;
            hostParams[`HostName${i}`] = record.HostName;
            hostParams[`RecordType${i}`] = record.RecordType;
            hostParams[`Address${i}`] = record.Address;
            hostParams[`TTL${i}`] = record.TTL;
            if (record.MXPref) hostParams[`MXPref${i}`] = record.MXPref;
            if (record.Title) hostParams[`Title${i}`] = record.Title;
            if (record.Keywords) hostParams[`Keywords${i}`] = record.Keywords;
            if (record.Description) hostParams[`Description${i}`] = record.Description;
        });

        const updateResponse = await namecheapRequest('namecheap.domains.dns.setHosts', {
            SLD: sld,
            TLD: tld,
            ...hostParams
        });

        if (updateResponse.ApiResponse.$.Status !== 'OK') {
            const errors = updateResponse.ApiResponse.Errors?.Error;
            const errorMessage = Array.isArray(errors)
                ? errors.map(e => e._).join(', ')
                : errors?._ || 'Unknown error';
            throw new Error(`Failed to update DNS records: ${errorMessage}`);
        }

        const redirectData = {
            type: masked ? 'FRAME' : (type === '301' ? 'URL301' : 'URL302'),
            destinationUrl,
            masked,
            title,
            keywords,
            description,
            createdAt: new Date()
        };

        const updateResult = await updateDomainInDatabase(userId, domain, {
            redirects: [redirectData],
            'dnsConfiguration.lastDNSUpdate': new Date()
        });

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

        if (error.message.includes('Domain name not found') || error.message.includes('Domain not found')) {
            return res.status(404).json({
                success: false,
                userId,
                error: 'Domain not found in your Namecheap account',
                domain
            });
        }

        if (error.message.includes('Invalid domain name')) {
            return res.status(400).json({
                success: false,
                userId,
                error: 'Invalid domain name format',
                domain
            });
        }

        if (error.message.includes('Authentication failed')) {
            return res.status(401).json({
                success: false,
                userId,
                error: 'Namecheap API authentication failed'
            });
        }

        res.status(500).json({
            success: false,
            userId,
            error: error.message,
            domain,
            timestamp: new Date().toISOString()
        });
    }
});

// router.post('/namecheap/domain/redirect', validateUserId, async (req, res) => {
//     const {
//         domain,
//         destinationUrl,
//         type = '301',
//         masked = false,
//         title = '',
//         keywords = '',
//         description = ''
//     } = req.body;

//     const userId = req.userId;

//     // Validate inputs
//     if (!domain || !destinationUrl) {
//         return res.status(400).json({
//             success: false,
//             error: 'Missing required fields: userId, domain and destinationUrl are required'
//         });
//     }

//     // More robust URL validation
//     try {
//         new URL(destinationUrl);
//     } catch (error) {
//         return res.status(400).json({
//             success: false,
//             error: 'Invalid destination URL format'
//         });
//     }

//     // Validate redirect type
//     if (!['301', '302'].includes(type)) {
//         return res.status(400).json({
//             success: false,
//             error: 'Redirect type must be either "301" or "302"'
//         });
//     }

//     // Validate domain format
//     const domainParts = domain.split('.');
//     if (domainParts.length < 2) {
//         return res.status(400).json({
//             success: false,
//             error: 'Invalid domain format'
//         });
//     }

//     try {
//         // 1. Verify domain ownership through database
//         const userDomain = await NamecheapDomain.findOne({
//             userId,
//             domain: domain.toLowerCase()
//         });

//         if (!userDomain) {
//             return res.status(404).json({
//                 success: false,
//                 error: 'Domain not found for this user',
//                 details: 'Please ensure the domain is registered under your account'
//             });
//         }

//         console.log(`[Redirect API] Setting up redirect for ${domain} (User: ${userId})`);

//         // 2. Verify domain ownership and get domain info from Namecheap
//         const domainInfo = await namecheapRequest('namecheap.domains.getInfo', {
//             DomainName: domain
//         });

//         const domainResult = domainInfo.ApiResponse.CommandResponse.DomainGetInfoResult;
//         const isOurDNS = domainResult.DnsDetails.$.IsUsingOurDNS === 'true';
//         const nameservers = domainResult.DnsDetails.Nameserver;
//         const nameserverList = Array.isArray(nameservers) ? nameservers : [nameservers];

//         if (!isOurDNS) {
//             return res.status(400).json({
//                 success: false,
//                 error: 'Domain must use Namecheap DNS servers for URL forwarding',
//                 details: {
//                     currentNameservers: nameserverList,
//                     requiredNameservers: [
//                         'dns1.registrar-servers.com',
//                         'dns2.registrar-servers.com'
//                     ]
//                 }
//             });
//         }

//         // 3. Split domain into SLD and TLD
//         const sld = domainParts.slice(0, -1).join('.');
//         const tld = domainParts[domainParts.length - 1];

//         // 4. Get existing DNS records to preserve non-conflicting ones
//         console.log(`[Redirect API] Getting existing DNS records for ${domain}`);
//         const existingRecords = await namecheapRequest('namecheap.domains.dns.getHosts', {
//             SLD: sld,
//             TLD: tld
//         });

//         const currentHosts = existingRecords.ApiResponse.CommandResponse.DomainDNSGetHostsResult.host || [];
//         const hostsArray = Array.isArray(currentHosts) ? currentHosts : [currentHosts];

//         // 5. Filter out existing @ records that conflict with redirect
//         const preservedRecords = hostsArray.filter(record => {
//             const hostName = record.$.Name;
//             const recordType = record.$.Type;

//             // Remove existing @ records that are A, CNAME, URL301, URL302, or FRAME
//             if (hostName === '@' && ['A', 'CNAME', 'URL301', 'URL302', 'FRAME'].includes(recordType)) {
//                 return false;
//             }
//             return true;
//         }).map(record => ({
//             HostName: record.$.Name,
//             RecordType: record.$.Type,
//             Address: record.$.Address,
//             TTL: record.$.TTL || '1800',
//             ...(record.$.MXPref && { MXPref: record.$.MXPref })
//         }));

//         // 6. Create redirect records
//         console.log(`[Redirect API] Setting up redirect for ${domain} to ${destinationUrl}`);
//         const redirectRecords = [];

//         if (masked) {
//             // For masked redirect, use FRAME record
//             redirectRecords.push({
//                 HostName: '@',
//                 RecordType: 'FRAME',
//                 Address: destinationUrl,
//                 TTL: '1800',
//                 Title: title || domain,
//                 Keywords: keywords,
//                 Description: description
//             });
//         } else {
//             // For regular redirect, use URL301 or URL302
//             redirectRecords.push({
//                 HostName: '@',
//                 RecordType: type === '301' ? 'URL301' : 'URL302',
//                 Address: destinationUrl,
//                 TTL: '1800'
//             });
//         }

//         // 7. Combine preserved records with new redirect records
//         const allRecords = [...preservedRecords, ...redirectRecords];

//         // Ensure we have at least one record (Namecheap requirement)
//         if (allRecords.length === 0) {
//             allRecords.push({
//                 HostName: '@',
//                 RecordType: 'A',
//                 Address: '192.0.2.1', // RFC5737 test address
//                 TTL: '1800'
//             });
//         }

//         console.log(`[Redirect API] Updating DNS with ${allRecords.length} records`);

//         // 8. Update DNS records
//         const updateResponse = await namecheapRequest('namecheap.domains.dns.setHosts', {
//             SLD: sld,
//             TLD: tld,
//             Hosts: JSON.stringify(allRecords)
//         });

//         // 9. Verify update was successful
//         if (updateResponse.ApiResponse.$.Status !== 'OK') {
//             const errors = updateResponse.ApiResponse.Errors?.Error;
//             const errorMessage = Array.isArray(errors) ? errors.map(e => e._).join(', ') : errors?.$_ || 'Unknown error';
//             throw new Error(`Failed to update DNS records: ${errorMessage}`);
//         }

//         // 10. Update database with redirect information
//         const redirectData = {
//             type: type === '301' ? 'URL301' : 'URL302',
//             destinationUrl,
//             masked,
//             title,
//             keywords,
//             description,
//             createdAt: new Date()
//         };

//         // Remove existing redirects and add new one
//         const updateResult = await updateDomainInDatabase(userId, domain, {
//             redirects: [redirectData],
//             'dnsConfiguration.lastDNSUpdate': new Date()
//         });

//         // 11. Log success and return response
//         console.log(`[Redirect API] Successfully updated redirect for ${domain} (User: ${userId})`);

//         res.json({
//             success: true,
//             userId,
//             data: {
//                 domain,
//                 destinationUrl,
//                 type,
//                 masked,
//                 message: 'Domain redirect updated successfully',
//                 timestamp: new Date().toISOString(),
//                 nameservers: nameserverList,
//                 recordsUpdated: allRecords.length,
//                 preservedRecords: preservedRecords.length,
//                 databaseRecord: {
//                     _id: updateResult._id,
//                     updatedAt: updateResult.updatedAt
//                 }
//             }
//         });

//     } catch (error) {
//         console.error(`[Redirect Error] Domain: ${domain} (User: ${userId})`, {
//             error: error.message,
//             stack: error.stack,
//             response: error.response?.data
//         });

//         // Handle specific error cases
//         if (error.message.includes('Domain name not found') || error.message.includes('Domain not found')) {
//             return res.status(404).json({
//                 success: false,
//                 userId,
//                 error: 'Domain not found in your Namecheap account',
//                 domain,
//                 details: 'Please verify the domain is registered with your Namecheap account'
//             });
//         }

//         if (error.message.includes('Invalid domain name')) {
//             return res.status(400).json({
//                 success: false,
//                 userId,
//                 error: 'Invalid domain name format',
//                 domain,
//                 details: 'Please check the domain name spelling and format'
//             });
//         }

//         if (error.message.includes('Authentication failed')) {
//             return res.status(401).json({
//                 success: false,
//                 userId,
//                 error: 'Namecheap API authentication failed',
//                 details: 'Please check your API credentials'
//             });
//         }

//         res.status(500).json({
//             success: false,
//             userId,
//             error: error.message,
//             domain,
//             details: error.response?.data || null,
//             timestamp: new Date().toISOString()
//         });
//     }
// });


//________Manage domain auto-renewal__________

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



//________List email accounts for a domain__________

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




//__________Helper function to get DKIM public key from WHM__________
async function getDkimPublicKey(domain) {
    const WHM_HOST = CPANEL_HOST;

    const url = `https://${WHM_HOST}/json-api/get_email_dkim?api.version=1&domain=${domain}`;

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

// Helper: Fetch Stripe invoice details including hosted_invoice_url
async function fetchStripeInvoiceDetails(invoiceId) {
    if (!invoiceId) {
        return null;
    }

    try {
        // Import stripe dynamically to avoid circular dependencies
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        const invoice = await stripe.invoices.retrieve(invoiceId);

        return {
            id: invoice.id,
            hosted_invoice_url: invoice.hosted_invoice_url,
            invoice_pdf: invoice.invoice_pdf,
            status: invoice.status,
            amount_paid: invoice.amount_paid ? invoice.amount_paid / 100 : null,
            currency: invoice.currency,
            created: new Date(invoice.created * 1000).toISOString()
        };
    } catch (error) {
        console.error('[Stripe Invoice API] Error fetching invoice details:', {
            error: error.message,
            invoiceId,
            stack: error.stack
        });
        return null;
    }
}




//__________Transfer Domain Endpoint__________

router.post('/namecheap/domain/transfer', validateUserId, asyncHandler(async (req, res) => {
    const { domain, authCode, years = 1 } = req.body;
    const userId = req.userId;

    if (!domain || !authCode) {
        return res.status(400).json({
            success: false,
            error: 'Domain and authCode are required'
        });
    }

    const [sld, tld] = domain.split('.');

    try {
        const response = await namecheapRequest('namecheap.domains.transfer.create', {
            SLD: sld,
            TLD: tld,
            AuthCode: authCode,
            Years: years
        });

        res.json({
            success: true,
            userId,
            data: response.ApiResponse.CommandResponse.DomainTransferCreateResult.$,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error(`[Transfer API] Transfer failed: ${domain}`, error.message);
        res.status(500).json({
            success: false,
            userId,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}));


//__________Transfer Domain Status Endpoint__________

router.get('/namecheap/domain/transfer/status/:domain', validateUserId, asyncHandler(async (req, res) => {
    const { domain } = req.params;
    const userId = req.userId;

    const [sld, tld] = domain.split('.');

    try {
        const response = await namecheapRequest('namecheap.domains.transfer.getStatus', {
            SLD: sld,
            TLD: tld
        });

        res.json({
            success: true,
            userId,
            domain,
            status: response.ApiResponse.CommandResponse.DomainTransferGetStatusResult,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error(`[Transfer Status API] Error checking status for ${domain}:`, error.message);
        res.status(500).json({
            success: false,
            userId,
            error: error.message,
            domain,
            timestamp: new Date().toISOString()
        });
    }
}));

//________________Api for fetching contact information of domain registration_______________________

router.get('/namecheap/user/:userId/contact-info', validateUserId, asyncHandler(async (req, res) => {
    const userId = req.userId;

    try {
        console.log(`[Contact API] 📋 Fetching latest contact information for user: ${userId}`);

        // Get all user domains from database, sorted by most recent
        const userDomains = await getUserDomainsFromDatabase(userId);

        if (userDomains.length === 0) {
            return res.json({
                success: true,
                userId,
                data: {
                    latestContactInfo: null,
                    totalDomains: 0,
                    message: 'No domains found for this user',
                    apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
                }
            });
        }

        // Find the most recently updated domain with contact info
        const latestDomain = userDomains
            .filter(domain => domain.contactInfo && domain.contactInfo.firstName)
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];

        if (!latestDomain) {
            return res.json({
                success: true,
                userId,
                data: {
                    latestContactInfo: null,
                    totalDomains: userDomains.length,
                    message: 'No contact information found in domains',
                    apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
                }
            });
        }

        // Extract and format the latest contact information
        const latestContactInfo = {
            firstName: latestDomain.contactInfo.firstName,
            lastName: latestDomain.contactInfo.lastName,
            email: latestDomain.contactInfo.email,
            phone: latestDomain.contactInfo.phone,
            address1: latestDomain.contactInfo.address1,
            address2: latestDomain.contactInfo.address2 || '',
            city: latestDomain.contactInfo.city,
            stateProvince: latestDomain.contactInfo.stateProvince,
            country: latestDomain.contactInfo.country,
            postalCode: latestDomain.contactInfo.postalCode
        };

        // Get all domains using this contact info
        const domainsWithSameContact = userDomains.filter(domain => {
            return domain.contactInfo &&
                domain.contactInfo.email === latestContactInfo.email &&
                domain.contactInfo.firstName === latestContactInfo.firstName &&
                domain.contactInfo.lastName === latestContactInfo.lastName;
        }).map(domain => ({
            domain: domain.domain,
            registrationDate: domain.registrationData.registrationDate,
            expirationDate: domain.registrationData.expirationDate,
            isActive: domain.domainStatus.isActive,
            lastUpdated: domain.updatedAt
        }));

        res.json({
            success: true,
            userId,
            data: {
                latestContactInfo,
                sourceDomain: latestDomain.domain,
                lastUpdated: latestDomain.updatedAt,
                domainsUsingThisContact: domainsWithSameContact,
                totalDomainsWithContact: domainsWithSameContact.length,
                totalDomains: userDomains.length,
                apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`[Contact API] ❌ Error fetching latest contact info for user ${userId}:`, {
            error: error.message,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            userId,
            error: error.message,
            details: 'Failed to fetch latest contact information from database',
            apiMode: NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
        });
    }
}));

// Cache for privacy protection information to avoid repeated API calls
const privacyCache = new Map();

// Helper function to get privacy protection information for a TLD dynamically
async function getPrivacyProtectionInfo(tld) {
    const cacheKey = tld.toLowerCase();

    // Check cache first (cache for 1 hour)
    if (privacyCache.has(cacheKey)) {
        const cached = privacyCache.get(cacheKey);
        if (Date.now() - cached.timestamp < 3600000) { // 1 hour
            console.log(`[Privacy API] ✅ Using cached privacy info for .${tld}:`, cached.info);
            return cached.info;
        }
    }

    try {
        console.log(`[Privacy API] 🔍 Checking privacy protection support for .${tld} via Namecheap API`);

        // Method 1: Try to get privacy protection pricing from Namecheap pricing API
        let privacySupported = null;
        let privacyCost = null;

        try {
            const pricingResponse = await namecheapRequest('namecheap.users.getPricing', {
                ProductType: 'WHOISGUARD',
                ProductName: tld.toUpperCase()
            });

            // If we get a successful response, privacy protection is supported
            if (pricingResponse?.ApiResponse?.CommandResponse?.UserGetPricingResult) {
                privacySupported = true;
                privacyCost = 0; // Namecheap offers free privacy protection
                console.log(`[Privacy API] ✅ Privacy protection confirmed via pricing API for .${tld}`);
            }
        } catch (pricingError) {
            // If pricing API fails, it might mean privacy protection is not supported
            console.log(`[Privacy API] ⚠️ Privacy pricing API failed for .${tld}:`, pricingError.message);
        }

        // Method 2: If pricing API didn't work, check if TLD is in known unsupported list
        if (privacySupported === null) {
            console.log(`[Privacy API] 🔍 Checking .${tld} against known restrictions`);

            // Only include TLDs that are definitively known to NOT support privacy protection
            const knownUnsupportedTlds = [
                'uk', 'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', // UK domains
                'ca', // Canada
                'com.au', 'net.au', 'org.au', 'asn.au', 'id.au', // Australia
                'fr', 'de', 'it', 'es', 'nl', 'be' // Some European ccTLDs
            ];

            const normalizedTld = tld.toLowerCase();
            privacySupported = !knownUnsupportedTlds.includes(normalizedTld);
            privacyCost = privacySupported ? 0 : null;

            console.log(`[Privacy API] 📋 Based on known restrictions, .${tld} privacy support: ${privacySupported}`);
        }

        // Build the response
        const privacyInfo = {
            supported: privacySupported,
            available: privacySupported,
            pricing: {
                cost: privacyCost,
                currency: 'USD',
                period: 'yearly',
                note: privacySupported ? 'Free with domain registration' : 'Not supported for this TLD'
            },
            restrictions: privacySupported ? [] : [
                'Privacy protection not available for this TLD',
                'Registry policy restrictions',
                'Contact information will be publicly visible'
            ],
            dataSource: privacySupported === true && privacyCost === 0 ? 'namecheap_api' : 'known_restrictions'
        };

        // Cache the result
        privacyCache.set(cacheKey, {
            info: privacyInfo,
            timestamp: Date.now()
        });

        console.log(`[Privacy API] ✅ Privacy info determined for .${tld}:`, {
            supported: privacyInfo.supported,
            cost: privacyInfo.pricing.cost,
            dataSource: privacyInfo.dataSource
        });

        return privacyInfo;

    } catch (error) {
        console.error(`[Privacy API] ❌ Error getting privacy info for .${tld}:`, error.message);

        // Return a safe fallback
        const fallbackInfo = {
            supported: null, // Unknown
            available: null,
            pricing: {
                cost: null,
                currency: 'USD',
                period: 'yearly',
                note: 'Unable to determine - check during registration'
            },
            restrictions: ['Unable to determine privacy protection availability'],
            dataSource: 'error_fallback'
        };

        // Cache the fallback for a shorter time (5 minutes)
        privacyCache.set(cacheKey, {
            info: fallbackInfo,
            timestamp: Date.now() - 3300000 // Expire in 5 minutes instead of 1 hour
        });

        return fallbackInfo;
    }
}

// Revalidate domain availability before registration
async function revalidateDomainAvailability(domain, acceptPremiumPricing = false) {
    console.log(`[Domain Validation] Revalidating availability for domain: ${domain}`);

    try {
        const checkResult = await namecheapRequest('namecheap.domains.check', {
            DomainList: domain
        });

        const domainResult = checkResult.ApiResponse.CommandResponse.DomainCheckResult;
        const isAvailable = domainResult.$.Available === 'true';
        const isPremium = domainResult.$.IsPremiumName === 'true';
        const price = domainResult.$.Price ? parseFloat(domainResult.$.Price) : null;
        const eapFee = domainResult.$.EapFee ? parseFloat(domainResult.$.EapFee) : 0;
        const errorNo = domainResult.$.ErrorNo;

        // Strict validation
        const isValid = isAvailable &&
            (!isPremium || (isPremium && price && acceptPremiumPricing)) &&
            errorNo === '0';

        if (!isValid) {
            const error = {
                success: false,
                message: "Domain is no longer available or has changed status",
                details: {
                    domain,
                    isAvailable,
                    isPremium,
                    price,
                    eapFee,
                    errorNo,
                    acceptPremiumPricing
                },
                nextSteps: ["recheck availability", "select alternative"]
            };

            if (isPremium && !acceptPremiumPricing) {
                error.message = "Premium domain requires explicit acceptance";
                error.details.totalCost = (price || 0) + eapFee;
            }

            throw error;
        }

        return {
            success: true,
            domain,
            isPremium,
            price,
            eapFee,
            totalCost: (price || 0) + eapFee
        };
    } catch (error) {
        console.error(`[Domain Validation] Error revalidating domain ${domain}:`, error);
        throw error;
    }
}

// Extracted domain registration function for reuse in other modules
async function registerDomainWithNamecheap(registrationData) {
    const {
        userId,
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
        enablePrivacy = false,
        customNameservers = null,
        useNamecheapDNS = false,
        acceptPremiumPricing = false,
        // Optional Stripe payment information
        stripePaymentInfo = null
    } = registrationData;

    // Validate required fields
    if (!domain || !firstName || !lastName || !email || !phone || !address1 || !city || !stateProvince || !country || !postalCode) {
        throw new Error('Missing required registration fields: domain, firstName, lastName, email, phone, address1, city, stateProvince, country, postalCode are required');
    }

    // Validate nameserver configuration
    let nameserverConfig;
    try {
        nameserverConfig = getNameserverConfig(customNameservers, useNamecheapDNS);
    } catch (error) {
        throw new Error(`Invalid nameserver configuration: ${error.message}`);
    }

    if (!isValidDomain(domain)) {
        throw new Error('Invalid domain format - Domain must be a valid format and support modern TLDs');
    }

    // Ensure database connection
    await connectToMongoDB();

    // Check if domain already exists for this user
    const existingDomain = await NamecheapDomain.findOne({
        userId,
        domain: domain.toLowerCase()
    });

    if (existingDomain) {
        throw new Error(`Domain already registered for this user. Registration date: ${existingDomain.registrationData.registrationDate}, Expiration: ${existingDomain.registrationData.expirationDate}`);
    }

    // Revalidate domain availability before proceeding with registration
    const validationResult = await revalidateDomainAvailability(domain, acceptPremiumPricing);

    // If we get here, the domain is available and valid for registration
    const { isPremium, price, eapFee } = validationResult;

    // Register domain with Namecheap
    console.log(`[Domain Registration] Registering domain: ${domain} (User: ${userId}), Premium: ${isPremium}`);
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

    // Add premium pricing parameters if it's a premium domain
    if (isPremium) {
        console.log(`[Domain Registration] Adding premium pricing - Price: ${price}, EAP Fee: ${domainResult.$.EapFee || 0}`);

        if (price) {
            registrationParams.PremiumPrice = price.toString();
        }

        const eapFee = domainResult.$.EapFee ? parseFloat(domainResult.$.EapFee) : 0;
        if (eapFee > 0) {
            registrationParams.EapFee = eapFee.toString();
        }

        registrationParams.AcceptPremiumPricing = 'true';
    }

    const registrationResult = await namecheapRequest('namecheap.domains.create', registrationParams);

    // Get domain info to see what nameservers Namecheap assigned by default
    console.log(`[Domain Registration] Checking default nameservers assigned by Namecheap for ${domain}`);
    const domainInfo = await namecheapRequest('namecheap.domains.getInfo', {
        DomainName: domain
    });

    const registeredDomainResult = domainInfo.ApiResponse.CommandResponse.DomainGetInfoResult;
    const defaultNameservers = Array.isArray(registeredDomainResult.DnsDetails.Nameserver)
        ? registeredDomainResult.DnsDetails.Nameserver
        : [registeredDomainResult.DnsDetails.Nameserver];
    const isUsingNamecheapDNS = registeredDomainResult.DnsDetails.$.IsUsingOurDNS === 'true';

    // Only set custom nameservers if user specifically requested them
    let nameserverResult;
    let finalNameservers = defaultNameservers;
    let finalIsNamecheapDNS = isUsingNamecheapDNS;
    let finalIsCustom = false;

    if (!nameserverConfig.useDefaults) {
        console.log(`[Domain Registration] Setting custom nameservers for ${domain}:`, nameserverConfig);
        nameserverResult = await setDomainNameservers(domain, nameserverConfig);
        finalNameservers = nameserverConfig.nameservers;
        finalIsNamecheapDNS = nameserverConfig.isNamecheapDNS;
        finalIsCustom = nameserverConfig.isCustom;
    } else {
        console.log(`[Domain Registration] Using Namecheap default nameservers for ${domain}:`, defaultNameservers);
        nameserverResult = {
            success: true,
            nameservers: defaultNameservers,
            type: 'namecheap_provided_default'
        };
    }

    // Prepare domain data for database
    const domainData = {
        domain: domain.toLowerCase(),
        registrationData: {
            domainId: registrationResult.ApiResponse.CommandResponse.DomainCreateResult.$.DomainID,
            orderId: registrationResult.ApiResponse.CommandResponse.DomainCreateResult.$.OrderID,
            transactionId: registrationResult.ApiResponse.CommandResponse.DomainCreateResult.$.TransactionID,
            chargedAmount: parseFloat(registrationResult.ApiResponse.CommandResponse.DomainCreateResult.$.ChargedAmount),
            registrationDate: new Date(),
            expirationDate: new Date(Date.now() + (parseInt(years) * 365 * 24 * 60 * 60 * 1000)),
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
            whoisGuardEnabled: enablePrivacy,
            isPremium,
            status: 'active'
        },
        dnsConfiguration: {
            isUsingNamecheapDNS: finalIsNamecheapDNS,
            nameservers: finalNameservers,
            customNameservers: finalIsCustom,
            emailDNSConfigured: false,
            emailDNSConfiguredAt: null,
            lastDNSUpdate: new Date()
        },
        pricing: {
            registrationPrice: price,
            currency: 'USD'
        },
        apiMode: process.env.NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production'
    };

    // Add Stripe payment information if provided
    if (stripePaymentInfo) {
        domainData.stripePayment = {
            sessionId: stripePaymentInfo.sessionId,
            paymentIntentId: stripePaymentInfo.paymentIntentId,
            customerId: stripePaymentInfo.customerId,
            paymentStatus: stripePaymentInfo.paymentStatus,
            amountPaid: stripePaymentInfo.amountPaid,
            currency: stripePaymentInfo.currency,
            paymentMethod: stripePaymentInfo.paymentMethod,
            paymentDate: stripePaymentInfo.paymentDate || new Date(),
            receiptUrl: stripePaymentInfo.receiptUrl,
            invoiceId: stripePaymentInfo.invoiceId,
            hostedInvoiceUrl: stripePaymentInfo.hostedInvoiceUrl,
            invoicePdf: stripePaymentInfo.invoicePdf
        };
        console.log(`[Domain Registration] Added Stripe payment info for ${domain}:`, {
            sessionId: stripePaymentInfo.sessionId,
            amountPaid: stripePaymentInfo.amountPaid,
            paymentStatus: stripePaymentInfo.paymentStatus,
            hostedInvoiceUrl: stripePaymentInfo.hostedInvoiceUrl,
            invoicePdf: stripePaymentInfo.invoicePdf,
            invoiceId: stripePaymentInfo.invoiceId
        });
    }

    // Save domain to database
    const savedDomain = await saveDomainToDatabase(userId, domainData);

    // Return comprehensive registration result
    const result = {
        success: true,
        userId,
        domain,
        data: {
            registration: {
                chargedAmount: domainData.registrationData.chargedAmount,
                domainId: domainData.registrationData.domainId,
                orderId: domainData.registrationData.orderId,
                transactionId: domainData.registrationData.transactionId,
                expirationDate: domainData.registrationData.expirationDate
            },
            dns: {
                nameservers: domainData.dnsConfiguration.nameservers,
                nameserverType: nameserverResult.type,
                customNameservers: domainData.dnsConfiguration.customNameservers,
                isUsingNamecheapDNS: domainData.dnsConfiguration.isUsingNamecheapDNS,
                emailConfigured: false
            },
            databaseRecord: {
                _id: savedDomain._id,
                createdAt: savedDomain.createdAt
            },
            stripePayment: stripePaymentInfo ? {
                sessionId: stripePaymentInfo.sessionId,
                amountPaid: stripePaymentInfo.amountPaid,
                paymentStatus: stripePaymentInfo.paymentStatus,
                paymentDate: stripePaymentInfo.paymentDate,
                hostedInvoiceUrl: stripePaymentInfo.hostedInvoiceUrl,
                invoicePdf: stripePaymentInfo.invoicePdf,
                invoiceId: stripePaymentInfo.invoiceId
            } : null
        },
        nextSteps: {
            dnsPropagation: {
                status: 'pending',
                checkEndpoint: `/namecheap/domain/${domain}/dns-status?userId=${userId}`,
                estimatedTime: '24-48 hours'
            },
            emailSetup: {
                status: 'pending_dns',
                instructions: 'Please wait for DNS propagation before creating email accounts',
                createEmailEndpoint: `/namecheap/domain/${domain}/createemail`
            }
        },
        apiMode: process.env.NAMECHEAP_SANDBOX === 'true' ? 'sandbox' : 'production',
        sandboxWarning: process.env.NAMECHEAP_SANDBOX === 'true' ?
            'Running in sandbox mode - Domain registration is simulated' : null
    };

    console.log(`[Domain Registration] ✅ Successfully registered ${domain} for user ${userId}`);
    return result;
}

// Cache instance with 5 minute TTL by default
const cache = new NodeCache({ stdTTL: 300 });

// Circuit breaker configuration
const breakerOptions = {
    timeout: 10000, // 10 seconds
    errorThresholdPercentage: 50,
    resetTimeout: 30000 // 30 seconds
};

// Create circuit breakers for different API operations
const namecheapBreaker = new CircuitBreaker(async (command, params) => {
    return await namecheapRequest(command, params);
}, breakerOptions);

const cpanelBreaker = new CircuitBreaker(async (endpoint, params) => {
    return await cpanelRequest(endpoint, params);
}, breakerOptions);

const whmBreaker = new CircuitBreaker(async (endpoint, params) => {
    return await whmRequest(endpoint, params);
}, breakerOptions);





// Contact info endpoint with caching and retries
router.get('/contact-info/:domain', apiLimiter, asyncHandler(async (req, res) => {
    const operation = 'GET_CONTACT_INFO';
    try {
        const { domain } = req.params;

        // Check cache
        const cacheKey = `contact_info_${domain}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            return res.json({
                success: true,
                operation,
                data: cached,
                source: 'cache'
            });
        }

        const result = await retryWithBackoff(async () => {
            return await namecheapBreaker.fire('namecheap.domains.getContacts', {
                DomainName: domain
            });
        });

        const contactInfo = result.ApiResponse.CommandResponse.DomainContactsResult;

        // Cache the result
        cache.set(cacheKey, contactInfo, 300);

        res.json({
            success: true,
            operation,
            data: contactInfo
        });

    } catch (error) {
        const errorResponse = createErrorResponse(error, operation);
        res.status(error.status || 500).json(errorResponse);
    }
}));


// Get transfer status endpoint
router.get('/transfer/:domain/status', apiLimiter, asyncHandler(async (req, res) => {
    const operation = 'GET_TRANSFER_STATUS';
    try {
        const { domain } = req.params;

        if (!isValidDomain(domain)) {
            throw new Error('Invalid domain format');
        }

        // Check cache
        const cacheKey = `transfer_status_${domain}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            return res.json({
                ...cached,
                source: 'cache'
            });
        }

        // Get transfer status with retries and circuit breaker
        const result = await retryWithBackoff(async () => {
            return await namecheapBreaker.fire('namecheap.domains.transfer.getStatus', {
                DomainName: domain
            });
        });

        const statusResult = {
            success: true,
            domain,
            status: result.ApiResponse.CommandResponse.TransferGetStatusResult.Status,
            transferable: result.ApiResponse.CommandResponse.TransferGetStatusResult.Transferable === 'true',
            authCodeRequired: result.ApiResponse.CommandResponse.TransferGetStatusResult.AuthCodeRequired === 'true',
            timestamp: new Date().toISOString()
        };

        // Cache the result for a shorter period since transfer status can change
        cache.set(cacheKey, statusResult, 60); // Cache for 1 minute

        res.json(statusResult);

    } catch (error) {
        const errorResponse = createErrorResponse(error, operation);
        res.status(error.status || 500).json(errorResponse);
    }
}));


//_______________API for delete Domain____




module.exports = {
    router,
    registerDomainWithNamecheap,
    NamecheapDomain
};