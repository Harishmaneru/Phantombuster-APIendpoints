# Email API with Automatic Webhook Triggers

Simple email API with automatic webhook notifications when recipients open, click, or reply to emails.

## Features

- ✅ **SMTP Email Sending** - Send emails with professional templates
- ✅ **IMAP Inbox Retrieval** - Fetch and read emails from inbox
- ✅ **Email Tracking** - Track opens, clicks, and replies
- ✅ **Automatic Webhooks** - Real-time notifications to your webhook URL
- ✅ **Professional Templates** - Pre-built email templates
- ✅ **Secure Authentication** - Encrypted password storage

## Quick Setup

1. **Install dependencies:**
```bash
npm install
```

2. **Configure environment variables:**
```env
ONEPGR_MONGO_URI=your_mongodb_connection_string
ENCRYPTION_SECRET=your_encryption_secret_key
BASE_URL=https://your-api-domain.com
EMAIL_WEBHOOK_URL=https://your-app.com/webhooks/email
EMAIL_WEBHOOK_SECRET=your-webhook-secret-key
```

## API Endpoints

### 1. Setup SMTP Authentication
**POST** `/api/senderemail/smtpauth`

```json
{
  "email": "your@email.com",
  "pass": "your_password"
}
```

### 2. Send Email (with Automatic Tracking)
**POST** `/api/emailsend`

```json
{
  "token": "your_token",
  "from": "your@email.com",
  "to": "recipient@email.com",
  "subject": "Test Email",
  "template": "welcome",
  "templateData": {
    "name": "John",
    "message": "Welcome aboard!"
  },
  "trackLinks": true
}
```

**Response:**
```json
{
  "success": true,
  "messageId": "message_id_from_smtp",
  "trackingId": "550e8400-e29b-41d4-a716-446655440000",
  "smtpHost": "smtp.gmail.com",
  "smtpPort": 587,
  "recipients": {
    "to": "recipient@email.com",
    "cc": null,
    "bcc": null
  }
}
```

### 3. Check Tracking Status
**GET** `/api/track/:trackingId`

```json
{
  "success": true,
  "tracking": {
    "sentAt": "2024-01-XX...",
    "opened": true,
    "openedCount": 2,
    "lastOpenedAt": "2024-01-XX...",
    "replied": false,
    "repliedAt": null,
    "clicks": [
      {
        "url": "https://example.com",
        "clickedAt": "2024-01-XX...",
        "ip": "192.168.1.1",
        "userAgent": "Mozilla/5.0..."
      }
    ]
  }
}
```

### 4. Get Email Notifications (Frontend Webhook)
**GET** `/api/webhook?trackingId=YOUR_TRACKING_ID&lastCheck=2024-01-01T00:00:00.000Z`

Get real-time notifications for email opens, clicks, and replies.

**Parameters:**
- `trackingId` (required) - The tracking ID from email send response
- `lastCheck` (optional) - ISO timestamp of last check to get only new events

**Response:**
```json
{
  "success": true,
  "trackingId": "f76c2211-5def-439b-8141-745fb9d1748b",
  "newEvents": [
    {
      "event": "opened",
      "timestamp": "2024-01-XX...",
      "data": {
        "trackingId": "f76c2211-5def-439b-8141-745fb9d1748b",
        "email": "harish@onepgr.us",
        "from": "admin@engagegptapp.com",
        "subject": "Test Email",
        "openedCount": 1,
        "ip": "192.168.1.1"
      }
    },
    {
      "event": "replied",
      "timestamp": "2024-01-XX...",
      "data": {
        "trackingId": "f76c2211-5def-439b-8141-745fb9d1748b",
        "email": "harish@onepgr.us",
        "from": "admin@engagegptapp.com",
        "subject": "Test Email"
      }
    }
  ],
  "currentStatus": {
    "opened": true,
    "openedCount": 1,
    "lastOpenedAt": "2024-01-XX...",
    "replied": true,
    "repliedAt": "2024-01-XX...",
    "totalClicks": 0
  }
}
```

## Automatic Webhook Notifications

When you configure `EMAIL_WEBHOOK_URL` in your environment, the system automatically sends POST requests to your webhook endpoint when email events occur.

### Webhook Payloads

**Email Opened:**
```json
{
  "event": "opened",
  "data": {
    "trackingId": "550e8400-e29b-41d4-a716-446655440000",
    "email": "recipient@email.com",
    "from": "sender@email.com",
    "subject": "Test Email",
    "ip": "192.168.1.1",
    "userAgent": "Mozilla/5.0...",
    "timestamp": "2024-01-XX..."
  },
  "timestamp": "2024-01-XX..."
}
```

**Link Clicked:**
```json
{
  "event": "clicked",
  "data": {
    "trackingId": "550e8400-e29b-41d4-a716-446655440000",
    "email": "recipient@email.com",
    "from": "sender@email.com",
    "subject": "Test Email",
    "url": "https://example.com",
    "ip": "192.168.1.1",
    "userAgent": "Mozilla/5.0...",
    "timestamp": "2024-01-XX..."
  },
  "timestamp": "2024-01-XX..."
}
```

**Email Replied:**
```json
{
  "event": "replied",
  "data": {
    "trackingId": "550e8400-e29b-41d4-a716-446655440000",
    "email": "recipient@email.com",
    "from": "sender@email.com",
    "subject": "Test Email",
    "timestamp": "2024-01-XX..."
  },
  "timestamp": "2024-01-XX..."
}
```

### Webhook Security

Each webhook request includes an HMAC signature in the `X-Email-Event-Signature` header:

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

## Usage Examples

### Send Tracked Email
```bash
curl --location 'http://localhost:3001/api/emailsend' \
--header 'Content-Type: application/json' \
--data-raw '{
    "token": "your_token",
    "from": "your@email.com",
    "to": "recipient@email.com",
    "subject": "Welcome!",
    "template": "welcome",
    "templateData": {
        "name": "John",
        "message": "Welcome aboard!"
    },
    "trackLinks": true
}'
```

### Check Tracking Status
```bash
curl --location 'http://localhost:3001/api/track/550e8400-e29b-41d4-a716-446655440000'
```

### Check Email Notifications
```bash
curl --location 'http://localhost:3001/api/webhook?trackingId=f76c2211-5def-439b-8141-745fb9d1748b'
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ONEPGR_MONGO_URI` | MongoDB connection string | Yes |
| `ENCRYPTION_SECRET` | Secret key for password encryption | Yes |
| `BASE_URL` | Your API base URL for tracking links | Yes |
| `EMAIL_WEBHOOK_URL` | Your webhook endpoint URL | No |
| `EMAIL_WEBHOOK_SECRET` | Secret for webhook signature verification | No |

## Frontend Implementation

### 1. Polling for Notifications (Recommended)
```javascript
// Poll every 10 seconds for new email events
const pollEmailNotifications = (trackingId) => {
  let lastCheck = new Date(0);
  
  setInterval(async () => {
    try {
      const response = await fetch(
        `/api/webhook?trackingId=${trackingId}&lastCheck=${lastCheck.toISOString()}`
      );
      const data = await response.json();
      
      if (data.success && data.newEvents.length > 0) {
        // Update last check time
        lastCheck = new Date();
        
        // Handle new events
        data.newEvents.forEach(event => {
          switch (event.event) {
            case 'opened':
              showNotification(`📧 ${event.data.email} opened your email`, 'success');
              break;
            case 'replied':
              showNotification(`💬 ${event.data.email} replied to your email`, 'info');
              break;
            case 'clicked':
              showNotification(`🔗 ${event.data.email} clicked a link`, 'warning');
              break;
          }
        });
      }
    } catch (error) {
      console.error('Error polling notifications:', error);
    }
  }, 10000); // 10 seconds
};

// Start polling when email is sent
const trackingId = 'f76c2211-5def-439b-8141-745fb9d1748b';
pollEmailNotifications(trackingId);
```

### 2. React Hook Example
```javascript
import { useState, useEffect } from 'react';

const useEmailNotifications = (trackingId) => {
  const [notifications, setNotifications] = useState([]);
  const [status, setStatus] = useState(null);
  const [lastCheck, setLastCheck] = useState(new Date(0));

  useEffect(() => {
    if (!trackingId) return;

    const pollNotifications = async () => {
      try {
        const response = await fetch(
          `/api/webhook?trackingId=${trackingId}&lastCheck=${lastCheck.toISOString()}`
        );
        const data = await response.json();

        if (data.success) {
          // Add new events to notifications
          if (data.newEvents.length > 0) {
            setNotifications(prev => [...prev, ...data.newEvents]);
            setLastCheck(new Date());
          }
          
          // Update current status
          setStatus(data.currentStatus);
        }
      } catch (error) {
        console.error('Error fetching notifications:', error);
      }
    };

    // Poll immediately, then every 10 seconds
    pollNotifications();
    const interval = setInterval(pollNotifications, 10000);

    return () => clearInterval(interval);
  }, [trackingId, lastCheck]);

  return { notifications, status };
};

// Usage in component
const EmailDashboard = ({ trackingId }) => {
  const { notifications, status } = useEmailNotifications(trackingId);

  return (
    <div>
      <h3>Email Status</h3>
      <p>Opened: {status?.opened ? 'Yes' : 'No'}</p>
      <p>Replied: {status?.replied ? 'Yes' : 'No'}</p>
      <p>Clicks: {status?.totalClicks || 0}</p>
      
      <h3>Recent Notifications</h3>
      {notifications.map((notification, index) => (
        <div key={index}>
          <strong>{notification.event}</strong> - {notification.data.email}
        </div>
      ))}
    </div>
  );
};
```

## How It Works

1. **Send Email** → System generates tracking ID and adds tracking pixel
2. **Recipient Opens Email** → Tracking pixel loads → Database updated
3. **Recipient Clicks Link** → Link goes through tracking → Database updated
4. **Recipient Replies** → Reply detection runs every 5 minutes → Database updated
5. **Frontend Polls** → `/api/webhook` endpoint → Gets new events since last check

## Benefits

- 🚀 **Zero Configuration** - Just set your webhook URL once
- 🔄 **Automatic** - No manual webhook management needed
- 🔒 **Secure** - HMAC signatures for verification
- 📊 **Real-time** - Instant notifications for all email events
- 🎯 **Simple** - No complex webhook registration or management

That's it! Your webhook endpoint will automatically receive notifications whenever email events occur. 