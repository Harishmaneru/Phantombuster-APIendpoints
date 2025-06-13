# User-Based Namecheap Domain Management API

## Overview

This API has been updated to support multiple users with user-specific domain management. Each domain registration, redirect, and email setup is now tied to a specific user ID, ensuring data isolation and proper access control.

## Database Schema

### Collection: `namecheap_domains`

```javascript
{
  userId: String,                    // Required - User identifier
  domain: String,                    // Required - Domain name (lowercase)
  
  registrationData: {
    domainId: String,               // Namecheap domain ID
    orderId: String,                // Namecheap order ID
    transactionId: String,          // Namecheap transaction ID
    chargedAmount: Number,          // Amount charged for registration
    registrationDate: Date,         // When domain was registered
    expirationDate: Date,           // When domain expires
    years: Number                   // Registration period in years
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
    isActive: Boolean,              // Domain active status
    isLocked: Boolean,              // Registrar lock status
    autoRenew: Boolean,             // Auto-renewal enabled
    whoisGuardEnabled: Boolean,     // Privacy protection enabled
    isPremium: Boolean,             // Premium domain status
    status: String                  // Current status (active, expired, etc.)
  },
  
  dnsConfiguration: {
    isUsingNamecheapDNS: Boolean,   // Using Namecheap DNS servers
    nameservers: [String],          // Current nameservers
    emailDNSConfigured: Boolean,    // Email DNS records configured
    emailDNSConfiguredAt: Date,     // When email DNS was configured
    lastDNSUpdate: Date             // Last DNS modification
  },
  
  redirects: [{
    type: String,                   // URL301, URL302, FRAME
    destinationUrl: String,         // Redirect target URL
    masked: Boolean,                // Whether redirect is masked
    title: String,                  // Frame title (for FRAME redirects)
    keywords: String,               // Meta keywords
    description: String,            // Meta description
    createdAt: Date                 // When redirect was created
  }],
  
  emailAccounts: [{
    username: String,               // Email username
    email: String,                  // Full email address
    quota: Number,                  // Mailbox quota in MB
    createdAt: Date,                // When account was created
    suspended: Boolean              // Account suspension status
  }],
  
  pricing: {
    registrationPrice: Number,      // Registration cost
    renewalPrice: Number,           // Renewal cost
    transferPrice: Number,          // Transfer cost
    icannFee: Number,               // ICANN fee
    currency: String                // Price currency (USD)
  },
  
  apiMode: String,                  // 'sandbox' or 'production'
  createdAt: Date,                  // Record creation timestamp
  updatedAt: Date                   // Last update timestamp
}
```

### Indexes

```javascript
// Compound unique index for user-domain combination
{ userId: 1, domain: 1 } // unique: true

// Index for efficient user queries
{ userId: 1, createdAt: -1 }

// Index for domain lookups
{ domain: 1 }
```

## Authentication & User Validation

All endpoints now require a `userId` parameter which can be provided in:
- Request body: `{ "userId": "user123", ... }`
- Query parameters: `?userId=user123`
- URL path: `/user/user123/stats`

The `validateUserId` middleware ensures:
- userId is present and valid
- User has access to requested resources
- Proper error responses for unauthorized access

## Updated API Endpoints

### 1. Domain Registration
**POST** `/namecheap/domain/register`

```json
{
  "userId": "user123",
  "domain": "example.com",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "address1": "123 Main St",
  "city": "New York",
  "stateProvince": "NY",
  "country": "US",
  "postalCode": "10001",
  "years": "1",
  "enablePrivacy": false
}
```

**Features:**
- Validates user ownership before registration
- Checks for duplicate domain registration per user
- Automatically saves registration data to database
- Configures email DNS if requested
- Returns database record ID for tracking

### 2. List User Domains
**GET** `/namecheap/domains/list?userId=user123`

**Features:**
- Returns only domains owned by the specified user
- Combines database data with live Namecheap API status
- Shows domain statistics and configuration
- Includes email account counts and redirect information
- Automatically syncs critical status changes to database

### 3. Domain Redirect Setup
**POST** `/namecheap/domain/redirect`

```json
{
  "userId": "user123",
  "domain": "example.com",
  "destinationUrl": "https://newsite.com",
  "type": "301",
  "masked": false,
  "title": "Redirect Title",
  "keywords": "redirect, domain",
  "description": "Domain redirect description"
}
```

**Features:**
- Verifies domain ownership through database
- Updates DNS records via Namecheap API
- Saves redirect configuration to database
- Preserves existing DNS records when possible

### 4. Email Account Creation
**POST** `/namecheap/domain/:domain/createemail`

```json
{
  "userId": "user123",
  "username": "contact",
  "password": "SecurePass123",
  "quota": 500
}
```

**Features:**
- Validates domain ownership per user
- Creates email account via cPanel API
- Updates database with email account information
- Configures email DNS automatically if needed

### 5. List Email Accounts
**GET** `/namecheap/domain/:domain/emails?userId=user123`

**Features:**
- Combines live cPanel data with database records
- Shows discrepancies between live and stored data
- Handles cPanel API failures gracefully
- Returns comprehensive email account information

### 6. User Statistics Dashboard
**GET** `/namecheap/user/:userId/stats`

Returns comprehensive user statistics:

```json
{
  "success": true,
  "userId": "user123",
  "data": {
    "stats": {
      "totalDomains": 5,
      "activeDomains": 4,
      "expiredDomains": 1,
      "premiumDomains": 1,
      "autoRenewEnabled": 3,
      "whoisGuardEnabled": 2,
      "emailConfigured": 3,
      "totalEmailAccounts": 8,
      "totalRedirects": 2,
      "totalSpent": 89.50,
      "upcomingRenewals": 1,
      "tldDistribution": {
        "COM": 3,
        "NET": 1,
        "ORG": 1
      },
      "registrationTimeline": {
        "2024-01": 2,
        "2024-02": 1,
        "2024-03": 2
      }
    },
    "recentDomains": [...],
    "expiringSoon": [...],
    "recommendations": {
      "enableAutoRenew": 1,
      "setupEmail": 1,
      "enableWhoisGuard": 2
    }
  }
}
```

## Error Handling

### User Validation Errors
```json
{
  "success": false,
  "error": "User ID is required",
  "details": "Please provide userId in request body, query parameters, or URL path"
}
```

### Domain Ownership Errors
```json
{
  "success": false,
  "error": "Domain not found for this user",
  "details": "Please ensure the domain is registered under your account"
}
```

### Database Errors
```json
{
  "success": false,
  "error": "Database connection failed",
  "details": "MongoDB connection timeout"
}
```

## Migration from Non-User-Based System

### Existing Data
If you have existing domain data without userIds, you'll need to:

1. **Identify Domain Ownership**: Determine which domains belong to which users
2. **Data Migration**: Update existing records with appropriate userIds
3. **API Updates**: Update frontend to include userId in all requests

### Migration Script Example
```javascript
// Example migration for existing domains
await NamecheapDomain.updateMany(
  { userId: { $exists: false } }, // Find records without userId
  { 
    $set: { 
      userId: "default_user", // or determine actual user
      updatedAt: new Date()
    }
  }
);
```

## Security Considerations

1. **User Isolation**: Each user can only access their own domains
2. **Input Validation**: All inputs are validated and sanitized
3. **Error Messages**: Don't leak sensitive information in error responses
4. **Rate Limiting**: Applied per IP address and user
5. **Audit Logging**: All user actions are logged with timestamps

## Database Performance

1. **Indexed Queries**: All user queries use indexes for fast performance
2. **Pagination**: Large result sets should implement pagination
3. **Caching**: Consider implementing Redis cache for frequently accessed data
4. **Connection Pooling**: MongoDB connection pool is configured for optimal performance

## Frontend Integration Examples

### JavaScript/React Example
```javascript
const userId = getCurrentUserId(); // Get from auth system

// Register a domain
const registerDomain = async (domainData) => {
  const response = await fetch('/namecheap/domain/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      ...domainData
    })
  });
  return response.json();
};

// Get user domains
const getUserDomains = async () => {
  const response = await fetch(`/namecheap/domains/list?userId=${userId}`);
  return response.json();
};

// Get user statistics
const getUserStats = async () => {
  const response = await fetch(`/namecheap/user/${userId}/stats`);
  return response.json();
};
```

### cURL Examples
```bash
# Register a domain
curl -X POST "http://localhost:3000/namecheap/domain/register" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "domain": "example.com",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "address1": "123 Main St",
    "city": "New York",
    "stateProvince": "NY",
    "country": "US",
    "postalCode": "10001"
  }'

# List user domains
curl "http://localhost:3000/namecheap/domains/list?userId=user123"

# Create email account
curl -X POST "http://localhost:3000/namecheap/domain/example.com/createemail" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "username": "contact",
    "password": "SecurePass123",
    "quota": 500
  }'

# Get user statistics
curl "http://localhost:3000/namecheap/user/user123/stats"
```

## Environment Variables

Ensure these environment variables are set:

```env
# MongoDB Connection
ONEPGR_MONGO_URI=mongodb://username:password@host:port/database

# Namecheap API Configuration
NAMECHEAP_API_USER=your_api_user
NAMECHEAP_API_KEY=your_api_key
NAMECHEAP_CLIENT_IP=your_server_ip
NAMECHEAP_SANDBOX=true  # or false for production

# cPanel/WHM Configuration (for email)
CPANEL_HOST=your_cpanel_host
CPANEL_USERNAME=your_cpanel_user
CPANEL_TOKEN=your_cpanel_token
WHM_HOST=your_whm_host
WHM_USERNAME=your_whm_user
WHM_TOKEN=your_whm_token
```

## Monitoring & Logging

The system provides comprehensive logging:

- **Database Operations**: All CRUD operations are logged
- **API Requests**: Namecheap API calls with retry logic
- **User Actions**: Domain registrations, redirects, email creation
- **Error Tracking**: Detailed error logs with stack traces
- **Performance Metrics**: Response times and success rates

## Support & Troubleshooting

### Common Issues

1. **"User ID is required"**: Ensure userId is included in request
2. **"Domain not found for this user"**: Verify domain ownership and userId
3. **"Database connection failed"**: Check MongoDB connection string
4. **"Invalid request IP"**: Whitelist server IP in Namecheap API settings

### Debug Mode
Set `NODE_ENV=development` for detailed debug logging.

### Health Check
Use `/namecheap/health` endpoint to verify API connectivity and account balance.

## Domain Check API - Privacy Protection Information

### Updated Response Structure

The domain check API now includes comprehensive privacy protection information for each domain and suggestion.

#### New Privacy Protection Section

```json
{
  "status": "1",
  "message": "Success",
  "data": {
    "domain": "example.com",
    "available": true,
    "isPremium": false,
    
    // NEW: Privacy Protection Information
    "privacyProtection": {
      "supported": true,
      "available": true,
      "pricing": {
        "cost": 0,
        "currency": "USD",
        "period": "yearly",
        "note": "Free with domain registration"
      },
      "features": [
        "Hides personal contact information",
        "Protects against spam and identity theft", 
        "Maintains domain ownership rights",
        "Easy to enable/disable",
        "Included free with registration"
      ],
      "restrictions": [],
      "recommendation": "Recommended for privacy and security"
    },
    
    // Updated suggestions now include privacy info
    "suggestions": {
      "tldVariations": [
        {
          "domain": "example.net",
          "available": true,
          "pricing": { /* pricing info */ },
          "privacyProtection": {
            "supported": true,
            "cost": 0,
            "note": "Free with domain registration"
          }
        }
      ]
    },
    
    // Updated next steps include privacy information
    "nextSteps": {
      "action": "register",
      "endpoint": "/namecheap/domain/register",
      "requiredFields": ["userId", "contactInfo", "years", "nameservers"],
      "optionalFields": ["enablePrivacy"],
      "privacyNote": "Privacy protection can be enabled during registration (free)"
    }
  }
}
```

#### Privacy Protection Support by TLD

**Supported TLDs (Free Privacy Protection):**
- .com, .net, .org, .info, .biz
- .io, .co, .me, .tv, .cc
- .name, .mobi, .pro, .travel
- Most new gTLDs (.app, .dev, .tech, etc.)

**Unsupported TLDs:**
- .uk and UK variants (.co.uk, .org.uk, etc.)
- .ca (Canada)
- .au and AU variants (.com.au, .net.au, etc.)
- European ccTLDs (.fr, .de, .it, .es, etc.)
- .in and IN variants
- .br and BR variants
- .mx and MX variants

#### Usage Examples

**Check domain with privacy protection info:**
```bash
GET /namecheap/domain/check/example.com
```

**Response includes privacy protection details:**
```json
{
  "data": {
    "domain": "example.com",
    "available": true,
    "privacyProtection": {
      "supported": true,
      "available": true,
      "pricing": {
        "cost": 0,
        "note": "Free with domain registration"
      },
      "recommendation": "Recommended for privacy and security"
    }
  }
}
```

**Register domain with privacy protection:**
```bash
POST /namecheap/domain/register
{
  "userId": "user123",
  "domain": "example.com",
  "enablePrivacy": true,
  // ... other required fields
}
```

#### Benefits of Privacy Protection

1. **Personal Information Protection**: Hides your personal contact details from public WHOIS databases
2. **Spam Prevention**: Reduces spam emails and unwanted solicitations
3. **Identity Theft Protection**: Prevents misuse of personal information
4. **Professional Appearance**: Shows generic registrar information instead of personal details
5. **Easy Management**: Can be enabled/disabled at any time through the API

#### Important Notes

- Privacy protection is **FREE** with Namecheap for supported TLDs
- Not all TLDs support privacy protection due to registry policies
- Some TLDs require contact information to be publicly visible by law
- Privacy protection can be enabled during registration or added later
- Domain ownership rights are always maintained regardless of privacy settings 