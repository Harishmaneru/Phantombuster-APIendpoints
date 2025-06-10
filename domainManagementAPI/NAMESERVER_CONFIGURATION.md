# Nameserver Configuration Guide

## Overview

The Domain Management API now supports flexible nameserver configuration, allowing users to choose between Namecheap DNS servers, custom nameservers, or fallback to environment-configured servers.

## Configuration Options

### 1. Automatic (Recommended Default)
When no nameserver configuration is specified, Namecheap automatically assigns their default nameservers:
```json
{
  // No nameserver configuration needed
  // Namecheap will automatically assign dns1.registrar-servers.com, dns2.registrar-servers.com
}
```

### 2. Namecheap DNS (Explicit)
Use Namecheap's built-in DNS servers for easy management:
```json
{
  "useNamecheapDNS": true
}
```

### 3. Custom Nameservers
Specify your own nameservers (minimum 2, maximum 4):
```json
{
  "customNameservers": [
    "ns1.yourhostingprovider.com",
    "ns2.yourhostingprovider.com"
  ]
}
```

### 4. Backward Compatibility Note
If no configuration is provided, the system uses:
- **Namecheap's automatically assigned nameservers** (typically `dns1.registrar-servers.com`, `dns2.registrar-servers.com`)
- This is the recommended approach for most users as it provides the best compatibility and ease of use

## API Endpoints

### Domain Registration with Custom Nameservers

#### POST `/namecheap/domain/register`

**Request Body:**
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
  
  // Nameserver Options (all optional):
  
  // Option 1: Let Namecheap assign defaults (recommended)
  // No nameserver fields needed
  
  // Option 2: Explicitly use Namecheap DNS
  "useNamecheapDNS": true,
  
  // Option 3: Use custom nameservers
  "customNameservers": ["ns1.hosting.com", "ns2.hosting.com"]
}
```

**Response:**
```json
{
  "success": true,
  "userId": "user123",
  "domain": "example.com",
  "data": {
    "registration": {
      "chargedAmount": 12.98,
      "domainId": "123456",
      "orderId": "789012",
      "transactionId": "345678",
      "expirationDate": "2025-01-15T00:00:00.000Z"
    },
    "dns": {
      "nameservers": ["ns1.hosting.com", "ns2.hosting.com"],
      "nameserverType": "custom",
      "customNameservers": true,
      "isUsingNamecheapDNS": false,
      "emailConfigured": false
    }
  }
}
```

### Update Nameservers for Existing Domain

#### PUT `/namecheap/domain/{domain}/nameservers`

**Request Body:**
```json
{
  "userId": "user123",
  // Choose one option:
  "useNamecheapDNS": true,
  // OR
  "customNameservers": ["ns3.newhost.com", "ns4.newhost.com"]
}
```

**Response:**
```json
{
  "success": true,
  "userId": "user123",
  "domain": "example.com",
  "data": {
    "nameservers": ["ns3.newhost.com", "ns4.newhost.com"],
    "nameserverType": "custom",
    "customNameservers": true,
    "isUsingNamecheapDNS": false,
    "lastUpdate": "2024-01-15T10:30:00.000Z"
  },
  "message": "Nameservers updated successfully",
  "propagationNote": "DNS changes may take up to 48 hours to propagate globally"
}
```

### Get Nameserver Information

#### GET `/namecheap/domain/{domain}/nameservers?userId={userId}`

**Response:**
```json
{
  "success": true,
  "userId": "user123",
  "domain": "example.com",
  "data": {
    "current": {
      "nameservers": ["ns3.newhost.com", "ns4.newhost.com"],
      "isUsingNamecheapDNS": false
    },
    "configured": {
      "nameservers": ["ns3.newhost.com", "ns4.newhost.com"],
      "customNameservers": true,
      "isUsingNamecheapDNS": false,
      "lastUpdate": "2024-01-15T10:30:00.000Z"
    },
    "sync": {
      "inSync": true,
      "lastChecked": "2024-01-15T12:00:00.000Z"
    }
  }
}
```

## Email Configuration

Email setup now works with different nameserver configurations:

- **Namecheap DNS**: Full email DNS configuration support
- **Custom Nameservers**: Limited to servers that support email configuration
- **Environment Servers**: Works if cPanel environment variables are configured

### Email Creation with Custom Nameservers

The email creation endpoint now validates nameserver compatibility:

```json
{
  "success": false,
  "error": "Domain DNS configuration does not support email setup",
  "details": {
    "message": "Domain must be configured with compatible nameservers for email setup",
    "currentNameservers": ["ns1.unsupported.com", "ns2.unsupported.com"],
    "domainConfiguration": {
      "isUsingNamecheapDNS": false,
      "customNameservers": true,
      "configuredNameservers": ["ns1.unsupported.com", "ns2.unsupported.com"]
    }
  }
}
```

## Validation Rules

### Custom Nameservers
- Minimum 2 nameservers required
- Maximum 4 nameservers allowed
- Must be valid domain format (contain dots)
- Must contain only alphanumeric characters, dots, and hyphens

### Use Cases

1. **Shared Hosting Provider**: Use their nameservers for full hosting integration
2. **CDN Integration**: Use CloudFlare, AWS Route 53, etc.
3. **Enterprise Setup**: Use company's internal DNS infrastructure
4. **Multi-Provider**: Different domains on different hosting providers

## Migration from Hardcoded Nameservers

Existing domains registered with hardcoded nameservers will continue to work. To update them:

1. Use the `PUT /namecheap/domain/{domain}/nameservers` endpoint
2. Choose your preferred nameserver configuration
3. Wait for DNS propagation (up to 48 hours)

## Error Handling

Common errors and solutions:

- **Invalid nameserver format**: Ensure nameservers are valid domain names
- **Insufficient nameservers**: Provide at least 2 nameservers
- **Email setup failure**: Verify nameservers support email configuration
- **DNS propagation delay**: Allow up to 48 hours for changes

## Best Practices

1. **Choose appropriate nameservers** for your hosting setup
2. **Test email functionality** after nameserver changes
3. **Monitor DNS propagation** using tools like `dig` or online checkers
4. **Keep nameserver configuration consistent** across related domains
5. **Document your nameserver choices** for team members

## Backward Compatibility

- Existing domains continue to use their configured nameservers
- Environment variables (CPANEL_NS1, CPANEL_NS2) still work as fallback
- No breaking changes to existing API endpoints
- Database automatically migrates to new schema 