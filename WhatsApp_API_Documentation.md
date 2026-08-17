# WhatsApp API Documentation

**Base URL:** `https://videoresponse.onepgr.com:3001`

---

## Authentication

### 1. Connect (QR Code Flow)
Start WhatsApp authentication via QR code scan.

```bash
curl --location --request GET 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/connect-qr' \
--header 'Content-Type: application/json' \
--data '{
  "user_id": "4991",
  "whatsapp_number": "919391783193"
}'
```

**Sample Response:**
```json
{
  "success": true,
  "account_id": "wa_acc_abc123def456",
  "provider": "WHATSAPP",
  "status": "PENDING_QR",
  "qrCodeString": "2@4FgH7KjL9MnQpRsTuVwXyZ0aBcDeFgHiJkLmNoPqRsTuVwXyZ0aBcD==",
  "qr_code_image_instructions": "Render qrCodeString using standard QR code library on frontend",
  "unipile_response": {
    "id": "wa_acc_abc123def456",
    "status": "PENDING_QR",
    "qrCodeString": "2@4FgH7KjL9MnQpRsTuVwXyZ0aBcDeFgHiJkLmNoPqRsTuVwXyZ0aBcD=="
  }
}
```

---

### 2. Connect (Pairing Code Flow)
Link device using a numeric pairing code.

```bash
curl --location --request POST 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/connect-pairing' \
--header 'Content-Type: application/json' \
--data '{
  "user_id": "4991",
  "whatsapp_number": "919391783193"
}'
```

**Sample Response:**
```json
{
  "success": true,
  "account_id": "wa_acc_abc123def456",
  "provider": "WHATSAPP",
  "whatsapp_number": "919391783193",
  "pairing_phone_number": "919391783193",
  "pairing_code": "A1B2-C3D4",
  "status": "PENDING_PAIRING",
  "unipile_response": {
    "id": "wa_acc_abc123def456",
    "pairing_code": "A1B2-C3D4",
    "status": "PENDING_PAIRING"
  }
}
```

---

### 3. Connect (Unified - Auto-detect)
Auto-detects QR vs pairing code flow based on whether `whatsapp_number` is provided.

```bash
curl --location 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/connect' \
--header 'Content-Type: application/json' \
--data '{
  "user_id": "4991",
  "whatsapp_number": "919391783193",
  "name": "My WhatsApp"
}'
```

**Sample Response (with phone → Pairing Code):**
```json
{
  "success": true,
  "flow": "PAIRING_CODE",
  "account_id": "wa_acc_abc123def456",
  "provider": "WHATSAPP",
  "whatsapp_number": "919391783193",
  "pairing_code": "X9Y8-Z7W6",
  "status": "PENDING_PAIRING",
  "unipile_response": {
    "id": "wa_acc_abc123def456",
    "pairing_code": "X9Y8-Z7W6",
    "status": "PENDING_PAIRING"
  }
}
```

**Sample Response (no phone → QR):**
```json
{
  "success": true,
  "flow": "QR_CODE",
  "account_id": "wa_acc_abc123def456",
  "provider": "WHATSAPP",
  "status": "PENDING_QR",
  "qrCodeString": "2@7KjL9MnQpRsTuVwXyZ0aBcDeFgHiJkLmNoPqRsTuVwXy==",
  "qr_code_image_instructions": "Render qrCodeString using standard QR code library on frontend",
  "unipile_response": {
    "id": "wa_acc_abc123def456",
    "status": "PENDING_QR",
    "qrCodeString": "2@7KjL9MnQpRsTuVwXyZ0aBcDeFgHiJkLmNoPqRsTuVwXy=="
  }
}
```

---

### 4. Disconnect WhatsApp Account

```bash
curl --location --request POST 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/disconnect' \
--header 'Content-Type: application/json' \
--data '{
  "user_id": "4991",
  "reason": "No longer needed"
}'
```

**Sample Response:**
```json
{
  "success": true,
  "message": "WhatsApp account disconnected successfully",
  "account_id": "wa_acc_abc123def456"
}
```

---

## Account Management

### 5. Check Account Status
Returns live connection status, warmup info, and daily usage counts.

```bash
curl --location 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/account-status?user_id=4991'
```

**Sample Response:**
```json
{
  "success": true,
  "account_id": "wa_acc_abc123def456",
  "provider": "WHATSAPP",
  "status": "OK",
  "connected": true,
  "warmup_active": true,
  "warmup_ends_at": "2026-08-12T14:30:00.000Z",
  "hours_until_warmup_complete": 18.5,
  "daily_chats_count": 3,
  "daily_messages_count": 12,
  "unipile_account_details": {
    "id": "wa_acc_abc123def456",
    "name": "My WhatsApp",
    "connected": true,
    "status": "OK"
  }
}
```

---

### 6. List All WhatsApp Accounts

```bash
curl --location 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/accounts?user_id=4991'
```

**Sample Response:**
```json
{
  "success": true,
  "accounts": [
    {
      "user_id": "4991",
      "account_id": "wa_acc_abc123def456",
      "provider": "WHATSAPP",
      "name": "My WhatsApp",
      "whatsapp_number": "919391783193",
      "status": "OK",
      "warmup_ends_at": "2026-08-12T14:30:00.000Z",
      "daily_chats_count": 3,
      "daily_messages_count": 12,
      "created_at": "2026-08-11T10:00:00.000Z"
    }
  ],
  "count": 1
}
```

---

### 7. Get Sending Limits & Warmup Status
Daily limits, warmup countdown, and best-practice recommendations.

```bash
curl --location 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/limits-status?user_id=4991'
```

**Sample Response:**
```json
{
  "success": true,
  "account_id": "wa_acc_abc123def456",
  "warmup_active": true,
  "warmup_ends_at": "2026-08-12T14:30:00.000Z",
  "hours_remaining": 18.5,
  "daily_chats_count": 3,
  "daily_messages_count": 12,
  "limits": {
    "daily_new_chat_limit": 20,
    "daily_total_message_limit": 50,
    "min_delay_seconds": 10,
    "max_delay_seconds": 20
  },
  "recommendations": [
    "Warm up new WhatsApp numbers for 24 hours after connection before outreach.",
    "Keep new-chat volume low (max 10-20/day during initial period).",
    "Enforce randomized 10-20 seconds minimum delay between messages.",
    "Optimize initial messages for replies to maintain high deliverability score."
  ]
}
```

---

## Messaging

### 8. Send First Message (Create Chat + Send)
Creates a new chat and sends the initial message in one call.

**Payload fields:**
| Field | Required | Description |
|-------|----------|-------------|
| `user_id` or `account_id` | Yes | User or account identifier |
| `attendees_ids` | Yes | Recipient phone number (e.g. `"919391783193"`) |
| `text` | Yes | Message text content |
| `attachments` | No | File uploads (multipart, max 15MB each) |
| `bypass_warmup_check` | No | Admin override for warmup restrictions |

```bash
curl --location 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/chats' \
--header 'Content-Type: application/json' \
--data '{
  "user_id": "4991",
  "attendees_ids": "919391783193",
  "text": "Hello, this is a test message from our platform!"
}'
```

**Sample Response:**
```json
{
  "success": true,
  "message": "Chat created and initial message sent successfully",
  "chat_id": "chat_xyz789",
  "recipient": "919391783193",
  "delayed_seconds": "14.2",
  "data": {
    "id": "chat_xyz789",
    "text": "Hello, this is a test message from our platform!",
    "timestamp": "2026-08-11T12:34:56.000Z",
    "is_sender": true
  }
}
```

---

### 9. Send Message to Existing Chat

```bash
curl --location 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/chats/chat_xyz789/messages' \
--header 'Content-Type: application/json' \
--data '{
  "user_id": "4991",
  "text": "Follow-up message here"
}'
```

**Sample Response:**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "chat_id": "chat_xyz789",
  "delayed_seconds": "12.8",
  "data": {
    "id": "msg_456abc",
    "text": "Follow-up message here",
    "timestamp": "2026-08-11T12:35:10.000Z",
    "is_sender": true,
    "delivered": true,
    "seen": false
  }
}
```

---

### 10. Start Chat (Alternate endpoint - from Provider API)

```bash
curl --location 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/start-chat' \
--header 'Content-Type: application/json' \
--data '{
  "whatsapp_number": "919391783193",
  "user_id": "4991",
  "text": "Starting a new conversation"
}'
```

**Sample Response:**
```json
{
  "success": true,
  "chat_id": "chat_new123",
  "data": {
    "id": "chat_new123",
    "text": "Starting a new conversation",
    "timestamp": "2026-08-11T12:40:00.000Z",
    "is_sender": true
  }
}
```

---

### 11. Send Message (Alternate endpoint - from Provider API)

```bash
curl --location 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/send-message' \
--header 'Content-Type: application/json' \
--data '{
  "chatId": "chat_xyz789",
  "text": "Another message via send-message endpoint"
}'
```

**Sample Response:**
```json
{
  "success": true,
  "chat_id": "chat_xyz789",
  "data": {
    "id": "msg_789def",
    "text": "Another message via send-message endpoint",
    "timestamp": "2026-08-11T12:41:00.000Z"
  }
}
```

---

## Conversations & Profiles

### 12. Fetch Chats List

```bash
curl --location 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/chats?user_id=4991&limit=50'
```

**Sample Response:**
```json
{
  "success": true,
  "account_id": "wa_acc_abc123def456",
  "chats": [
    {
      "id": "chat_xyz789",
      "name": "John Doe",
      "attendee_provider_id": "919391783193",
      "last_message": {
        "text": "Hello!",
        "timestamp": "2026-08-11T12:34:56.000Z"
      },
      "unread_count": 0
    },
    {
      "id": "chat_abc456",
      "name": "Jane Smith",
      "attendee_provider_id": "919876543210",
      "last_message": {
        "text": "Thanks for reaching out!",
        "timestamp": "2026-08-11T11:20:00.000Z"
      },
      "unread_count": 2
    }
  ],
  "cursor": null
}
```

---

### 13. Fetch Messages for a Chat

```bash
curl --location 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/chats/chat_xyz789/messages?user_id=4991&limit=100'
```

**Sample Response:**
```json
{
  "success": true,
  "chat_id": "chat_xyz789",
  "account_id": "wa_acc_abc123def456",
  "messages": [
    {
      "id": "msg_456abc",
      "chat_id": "chat_xyz789",
      "text": "Hello, this is a test message from our platform!",
      "timestamp": "2026-08-11T12:34:56.000Z",
      "is_sender": true,
      "sender_id": "919391783193@c.us",
      "delivered": true,
      "seen": false,
      "seen_by": [],
      "attachments": [],
      "raw": {}
    },
    {
      "id": "msg_457def",
      "chat_id": "chat_xyz789",
      "text": "Hi, thanks for the message!",
      "timestamp": "2026-08-11T12:36:30.000Z",
      "is_sender": false,
      "sender_id": "919391783193@c.us",
      "delivered": true,
      "seen": true,
      "seen_by": ["919391783193"],
      "attachments": [],
      "raw": {}
    }
  ],
  "limit": 100,
  "cursor": null
}
```

---

### 14. Fetch Conversations (Filtered by Contact)
Supports optional `include_messages` to hydrate each chat with messages and attendee profiles.

```bash
curl --location 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/fetch-conversations' \
--header 'Content-Type: application/json' \
--data '{
  "providerID": "919391783193",
  "user_id": "4991",
  "limit": 50,
  "include_messages": true,
  "message_limit": 50
}'
```

**Sample Response (with include_messages):**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "chat_xyz789",
        "name": "John Doe",
        "attendee_provider_id": "919391783193",
        "attendees_profiles": [
          {
            "id": "919391783193",
            "name": "John Doe",
            "provider_id": "919391783193",
            "public_identifier": "919391783193@c.us",
            "profile_picture_url": "https://videoresponse.onepgr.com:3001/api/whatsapp/attendees/919391783193/picture?account_id=wa_acc_abc123def456"
          }
        ],
        "messages": [
          {
            "id": "msg_456abc",
            "chat_id": "chat_xyz789",
            "text": "Hello from our platform!",
            "timestamp": "2026-08-11T12:34:56.000Z",
            "is_sender": true,
            "sender_id": "919391783193@c.us",
            "delivered": true,
            "seen": false,
            "seen_by": {},
            "attachments": []
          }
        ],
        "message_count": 1
      }
    ],
    "total": 1,
    "returned": 1,
    "cursor": null,
    "cached": false
  },
  "account_id": "wa_acc_abc123def456",
  "include_messages": true,
  "scanned": 1,
  "pages": 1,
  "exhausted": true,
  "fetched_at": "2026-08-11T12:50:00.000Z"
}
```

---

### 15. Fetch Messages (Alternate - POST body)

```bash
curl --location 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/fetch-messages' \
--header 'Content-Type: application/json' \
--data '{
  "chatId": "chat_xyz789",
  "user_id": "4991",
  "limit": 100
}'
```

**Sample Response:**
```json
{
  "success": true,
  "chat_id": "chat_xyz789",
  "account_id": "wa_acc_abc123def456",
  "messages": [
    {
      "id": "msg_456abc",
      "chat_id": "chat_xyz789",
      "text": "Hello from our platform!",
      "timestamp": "2026-08-11T12:34:56.000Z",
      "is_sender": true,
      "sender_id": "919391783193@c.us",
      "delivered": true,
      "seen": false,
      "seen_by": {},
      "attachments": []
    }
  ],
  "total": 1,
  "cursor": null,
  "fetched_at": "2026-08-11T12:51:00.000Z"
}
```

---

### 16. Fetch Profile (By Provider ID)

```bash
curl --location 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/fetch-profile' \
--header 'Content-Type: application/json' \
--data '{
  "providerID": "919391783193",
  "user_id": "4991"
}'
```

**Sample Response:**
```json
{
  "success": true,
  "data": {
    "id": "919391783193",
    "name": "John Doe",
    "provider": "WHATSAPP",
    "public_identifier": "919391783193@c.us",
    "profile_picture_url": "https://example.com/profile.jpg"
  },
  "account_id": "wa_acc_abc123def456",
  "providerID": "919391783193",
  "cached": false,
  "fetched_at": "2026-08-11T12:52:00.000Z"
}
```

---

### 17. Profile Picture Proxy
Streams attendee profile picture without exposing API keys.

```bash
curl --location 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/attendees/919391783193/picture?account_id=wa_acc_abc123def456' \
--output profile.jpg
```

**Sample Response:** Binary image stream.
```
Content-Type: image/jpeg
Cache-Control: public, max-age=86400
```

---

## Attachments

### 18. Download Attachment

```bash
curl --location 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/messages/msg_456abc/attachments/att_001?user_id=4991' \
--output attachment.pdf
```

**Sample Response:** Binary file stream with forwarded `Content-Type`, `Content-Disposition`, and `Content-Length` headers.

---

## Webhooks

### 19. Webhook (Inbound Events)
Receives events from Unipile for delivery status, read receipts, incoming messages, reactions, and account state changes.

```bash
curl --location 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/webhook' \
--header 'Content-Type: application/json' \
--data '{
  "event": "message_received",
  "account_id": "wa_acc_abc123def456",
  "id": "msg_incoming_001",
  "text": "Reply from contact",
  "timestamp": "2026-08-11T12:40:00.000Z",
  "is_sender": false
}'
```

**Sample Response:**
```json
{
  "success": true,
  "processed_event": "message_received"
}
```

**Supported events:**
| Event | Description |
|-------|-------------|
| `message_delivered` | Outbound message delivered to recipient |
| `message_read` | Outbound message seen by recipient |
| `message_received` | Inbound message from contact |
| `message_reaction` | Reaction added to a message |
| `message_edited` | Message was edited |
| `message_deleted` | Message was deleted |
| `account_status` | Account status changed |
| `account_connected` | Account successfully connected |
| `account_disconnected` | Account disconnected |

---

## Message Reactions

### 20. Add / Send Reaction to a Message
Sends an emoji or reaction to a WhatsApp message.

```bash
curl --location 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/messages/x1a6LELAXhSRsLqMNbwoIQ/reaction' \
--header 'Content-Type: application/json' \
--data '{
  "reaction": "❤️"
}'
```

**Sample Response:**
```json
{
  "success": true,
  "message": "Reaction added successfully",
  "message_id": "x1a6LELAXhSRsLqMNbwoIQ",
  "reaction": "❤️",
  "data": {
    "status": "ok"
  }
}
```

### 21. Remove Reaction from a Message
```bash
curl --location --request DELETE 'https://videoresponse.onepgr.com:3001/api/unipile/whatsapp/messages/x1a6LELAXhSRsLqMNbwoIQ/reaction'
```

**Sample Response:**
```json
{
  "success": true,
  "message": "Reaction removed successfully",
  "message_id": "x1a6LELAXhSRsLqMNbwoIQ"
}
```

---

## Endpoint Quick Reference

| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 1 | POST/GET | `/api/unipile/whatsapp/connect-qr` | Start QR code auth flow |
| 2 | POST | `/api/unipile/whatsapp/connect-pairing` | Start pairing code auth |
| 3 | POST | `/api/unipile/whatsapp/connect` | Auto-detect QR vs pairing |
| 4 | POST/DELETE | `/api/unipile/whatsapp/disconnect` | Disconnect / delete account |
| 5 | GET | `/api/unipile/whatsapp/account-status` | Check connection status |
| 6 | GET | `/api/unipile/whatsapp/accounts` | List all WA accounts |
| 7 | GET | `/api/unipile/whatsapp/limits-status` | Warmup & sending limits |
| 8 | POST | `/api/unipile/whatsapp/chats` | Send first message (new chat) |
| 9 | POST | `/api/unipile/whatsapp/chats/:chatId/messages` | Send msg to existing chat |
| 10 | POST | `/api/unipile/whatsapp/start-chat` | Start chat + send (alt) |
| 11 | POST | `/api/unipile/whatsapp/send-message` | Send message (alt) |
| 12 | GET | `/api/unipile/whatsapp/chats` | List chats |
| 13 | GET | `/api/unipile/whatsapp/chats/:chatId/messages` | Fetch chat messages |
| 14 | POST | `/api/unipile/whatsapp/fetch-conversations` | Fetch conversations |
| 15 | POST | `/api/unipile/whatsapp/fetch-messages` | Fetch messages (alt) |
| 16 | POST | `/api/unipile/whatsapp/fetch-profile` | Get contact profile |
| 17 | GET | `/api/unipile/whatsapp/attendees/:id/picture` | Profile picture proxy |
| 18 | GET | `/api/unipile/whatsapp/messages/:msgId/attachments/:attId` | Download attachment |
| 19 | POST | `/api/unipile/whatsapp/webhook` | Webhook event receiver |
| 20 | POST | `/api/unipile/whatsapp/messages/:msgId/reaction` | Add reaction to message |
| 21 | DELETE | `/api/unipile/whatsapp/messages/:msgId/reaction` | Remove reaction from message |

> **Note:** All endpoints support both `/api/whatsapp/...` and `/api/unipile/whatsapp/...` prefixes. Use `user_id` in place of `account_id` where supported — the server resolves it automatically.
