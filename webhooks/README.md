# RB2B Webhook Integration

This webhook allows integration with RB2B to capture and store lead data in MongoDB.

## Endpoints

### `POST /rb2b/webhook`

Receives RB2B event data and stores it in the `rb2b_ri_events` collection in the `onepgr_apps` database.

#### Required Fields
- `LinkedIn URL`
- `First Name`

#### Sample Payload
```json
{
  "LinkedIn URL": "https://www.linkedin.com/in/retentionadam/",
  "First Name": "Adam",
  "Last Name": "Robinson",
  "Title": "CEO @ Retention.com",
  "Company Name": "Retention.com",
  "Business Email": "adam@retention.com",
  "Website": "https://retention.com",
  "Industry": "Internet Technology & Services",
  "Employee Count": "1-10",
  "Estimate Revenue": "$22M rev",
  "City": "Austin",
  "State": "Texas",
  "Zipcode": "73301",
  "Seen At": "2024-01-01T12:34:56:00.00+00:00",
  "Referrer": "https://retention.com",
  "Captured URL": "https://rb2b.com/pricing",
  "Tags": "Hot Page, Hot Lead"
}
```

#### Response Example (Success)
```json
{
  "success": true,
  "message": "RB2B event data received and stored successfully",
  "eventId": "65f1e2d3a4b5c6d7e8f9a0b1"
}
```

### `GET /rb2b/health`

Health check endpoint to verify the webhook is operational.

#### Response Example
```json
{
  "status": "healthy",
  "message": "RB2B webhook is operational"
}
```

## Setup Instructions for RB2B

1. Navigate to Integrations from the RB2B sidebar menu
2. Select Webhook among the integration options or visit https://app.rb2b.com/integrations/webhook
3. Add your full Webhook URL: `https://your-domain.com/rb2b/webhook`
4. Click Save to publish your changes

## Requirements

- The webhook URL must be secure and include https://
- Required fields in the payload: LinkedIn URL and First Name 