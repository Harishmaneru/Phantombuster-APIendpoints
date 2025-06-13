# Privacy Protection API Response Examples

## Example 1: .com Domain (Privacy Protection Supported)

**Request:**
```bash
GET /namecheap/domain/check/myawesomesite.com
```

**Response:**
```json
{
  "status": "1",
  "message": "Success",
  "data": {
    "domain": "myawesomesite.com",
    "keyword": "myawesomesite",
    "tld": "com",
    "available": true,
    "availabilityStatus": "AVAILABLE",
    "isPremium": false,
    
    "pricing": {
      "register": 13.98,
      "renew": 15.98,
      "transfer": 13.98,
      "icannFee": 0.18,
      "currency": "USD",
      "totalFirstYear": 14.16
    },
    
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
    
    "suggestions": {
      "tldVariations": [
        {
          "domain": "myawesomesite.net",
          "available": true,
          "tld": "net",
          "pricing": {
            "register": 15.98,
            "currency": "USD"
          },
          "privacyProtection": {
            "supported": true,
            "cost": 0,
            "note": "Free with domain registration"
          }
        },
        {
          "domain": "myawesomesite.org",
          "available": true,
          "tld": "org",
          "pricing": {
            "register": 14.98,
            "currency": "USD"
          },
          "privacyProtection": {
            "supported": true,
            "cost": 0,
            "note": "Free with domain registration"
          }
        }
      ]
    },
    
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

## Example 2: .uk Domain (Privacy Protection NOT Supported)

**Request:**
```bash
GET /namecheap/domain/check/myawesomesite.co.uk
```

**Response:**
```json
{
  "status": "1",
  "message": "Success",
  "data": {
    "domain": "myawesomesite.co.uk",
    "keyword": "myawesomesite",
    "tld": "co.uk",
    "available": true,
    "availabilityStatus": "AVAILABLE",
    "isPremium": false,
    
    "pricing": {
      "register": 9.98,
      "renew": 11.98,
      "transfer": 9.98,
      "icannFee": 0.00,
      "currency": "USD",
      "totalFirstYear": 9.98
    },
    
    "privacyProtection": {
      "supported": false,
      "available": false,
      "pricing": {
        "cost": null,
        "currency": "USD",
        "period": "yearly",
        "note": "Not supported for this TLD"
      },
      "features": [],
      "restrictions": [
        "Privacy protection not available for this TLD",
        "Registry policy restrictions",
        "Contact information will be publicly visible"
      ],
      "recommendation": "Consider alternative TLD if privacy is important"
    },
    
    "suggestions": {
      "tldVariations": [
        {
          "domain": "myawesomesite.com",
          "available": true,
          "tld": "com",
          "pricing": {
            "register": 13.98,
            "currency": "USD"
          },
          "privacyProtection": {
            "supported": true,
            "cost": 0,
            "note": "Free with domain registration"
          }
        }
      ]
    },
    
    "nextSteps": {
      "action": "register",
      "endpoint": "/namecheap/domain/register",
      "requiredFields": ["userId", "contactInfo", "years", "nameservers"],
      "optionalFields": ["enablePrivacy"],
      "privacyNote": "Privacy protection not available for this TLD"
    }
  }
}
```

## Key Benefits of the Privacy Protection Information

### ✅ For Supported TLDs (.com, .net, .org, .io, etc.)
- **FREE** privacy protection included
- Complete personal information hiding
- Spam and identity theft protection
- Professional appearance in WHOIS
- Easy to enable during registration

### ❌ For Unsupported TLDs (.uk, .ca, .au, etc.)
- Clear indication that privacy is not available
- Explanation of registry restrictions
- Alternative TLD suggestions with privacy support
- Transparent about public visibility requirements

### 🔍 Enhanced Decision Making
- Users can make informed choices about TLD selection
- Privacy-conscious users can avoid TLDs without protection
- Clear cost information (free vs. paid)
- Feature comparison between different TLDs

### 🚀 Improved User Experience
- No surprises during registration
- Clear expectations about privacy options
- Helpful recommendations and alternatives
- Complete transparency about limitations 