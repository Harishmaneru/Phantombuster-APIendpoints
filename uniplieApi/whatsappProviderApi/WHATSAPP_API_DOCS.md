# WhatsApp Provider API Documentation (Client-Side Team)

This documentation details the WhatsApp Provider REST API endpoints implemented in `whatsappProviderApi/index.js`. Client-side developers (React / Next.js / Vue / Mobile) can use these APIs to manage WhatsApp conversations, fetch messages, view profiles, start new chats, and proxy attendee avatar images.

---

## 1. Overview & Core Concepts

### Base URL & Dual Route Aliases
All WhatsApp endpoints support **two path prefixes** interchangeably:
- `/api/whatsapp/...` (Short form)
- `/api/unipile/whatsapp/...` (Unipile-scoped alias)

### Account Resolution (`accountId` vs `user_id`)
Most endpoints require identifying which connected WhatsApp account to query. You can pass either:
1. `accountId` (string): The explicit Unipile WhatsApp Account ID.
2. `user_id` (string): The local system User ID. The backend will automatically look up the associated `account_id` from the database.

> **Rule:** At least one of `accountId` or `user_id` MUST be provided for account-scoped endpoints.

### Standard Response Envelope
All API endpoints return JSON responses with a top-level `success` boolean indicator:

```typescript
// Success Response Envelope
{
  "success": true,
  "fetched_at": "2026-08-10T14:00:35.123Z",
  // ... endpoint specific payloads ...
}

// Error Response Envelope
{
  "success": false,
  "error": "Error description or provider error object",
  "message": "Human readable error message"
}
```

---

## 2. API Endpoints Reference

### 1. Fetch Contact Profile (`POST /api/whatsapp/fetch-profile`)

Retrieves detailed profile information for a WhatsApp contact using their provider phone number or provider ID. Profile lookups are cached on the server for **30 minutes**.

- **Endpoints:**
  - `POST /api/whatsapp/fetch-profile`
  - `POST /api/unipile/whatsapp/fetch-profile`

#### Request Body
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `providerID` | `string` | **Yes** | WhatsApp provider ID or phone number (e.g. `15551234567` or `15551234567@s.whatsapp.net`). |
| `accountId` | `string` | Optional* | Unipile account ID. |
| `user_id` | `string` | Optional* | Local user ID (used if `accountId` is omitted). |

#### Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "provider_id": "15551234567@s.whatsapp.net",
    "name": "Jane Doe",
    "public_identifier": "+1 555 123 4567",
    "picture_url": "https://...",
    "status": "Available"
  },
  "account_id": "acc_wa_987654321",
  "providerID": "15551234567@s.whatsapp.net",
  "cached": false,
  "fetched_at": "2026-08-10T14:00:35.000Z"
}
```

---

### 2. Fetch Conversations (`POST /api/whatsapp/fetch-conversations`)

Retrieves the list of WhatsApp chats for the account. Supports server-side pagination, contact filtering, and optional message/attendee profile hydration. Unhydrated requests are cached for **10 minutes**.

- **Endpoints:**
  - `POST /api/whatsapp/fetch-conversations`
  - `POST /api/unipile/whatsapp/fetch-conversations`

#### Request Body
| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `accountId` | `string` | `undefined` | Optional if `user_id` is supplied. |
| `user_id` | `string` | `undefined` | Optional if `accountId` is supplied. |
| `providerID` | `string` | `undefined` | Optional contact provider ID to filter chats exclusively for this contact. |
| `limit` | `number` | `50` | Maximum number of chats to return in the list. |
| `include_messages` | `boolean` | `false` | If `true`, populates `messages` and `attendees_profiles` for each chat. |
| `message_limit` | `number` | `50` | Number of recent messages to fetch per chat when `include_messages: true`. |

#### Response (`200 OK`) - Lightweight (`include_messages: false`)
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "chat_wa_12345",
        "account_id": "acc_wa_987654321",
        "name": "Alex Smith",
        "unread_count": 0,
        "timestamp": 1754832000000,
        "attendee_provider_id": "15559998888@s.whatsapp.net"
      }
    ],
    "total": 12,
    "returned": 1,
    "cursor": null,
    "cached": false
  },
  "account_id": "acc_wa_987654321",
  "include_messages": false,
  "scanned": 12,
  "pages": 1,
  "exhausted": true,
  "fetched_at": "2026-08-10T14:00:35.000Z"
}
```

#### Response (`200 OK`) - Hydrated (`include_messages: true`)
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "chat_wa_12345",
        "account_id": "acc_wa_987654321",
        "name": "Alex Smith",
        "attendees_profiles": [
          {
            "id": "att_12345",
            "name": "Alex Smith",
            "provider_id": "15559998888@s.whatsapp.net",
            "public_identifier": "+15559998888",
            "profile_picture_url": "http://localhost:3000/api/whatsapp/attendees/att_12345/picture?account_id=acc_wa_987654321"
          }
        ],
        "messages": [
          {
            "id": "msg_001",
            "chat_id": "chat_wa_12345",
            "text": "Hello there!",
            "timestamp": "2026-08-10T13:45:00.000Z",
            "is_sender": false,
            "sender_id": "att_12345",
            "delivered": true,
            "seen": true,
            "seen_by": { "15559998888@s.whatsapp.net": true },
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
  "account_id": "acc_wa_987654321",
  "include_messages": true,
  "scanned": 1,
  "pages": 1,
  "exhausted": true,
  "fetched_at": "2026-08-10T14:00:35.000Z"
}
```

---

### 3. Fetch Messages for a Specific Chat (`POST /api/whatsapp/fetch-messages`)

Fetches recent message history for an active WhatsApp chat window.

- **Endpoints:**
  - `POST /api/whatsapp/fetch-messages`
  - `POST /api/unipile/whatsapp/fetch-messages`

#### Request Body
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `chatId` | `string` | **Yes** | WhatsApp Chat ID. |
| `accountId` | `string` | Optional* | Unipile account ID. |
| `user_id` | `string` | Optional* | Local user ID. |
| `limit` | `number` | Optional | Max messages to fetch (default `100`, max capped at `100`). |

#### Response (`200 OK`)
```json
{
  "success": true,
  "chat_id": "chat_wa_12345",
  "account_id": "acc_wa_987654321",
  "messages": [
    {
      "id": "msg_001",
      "chat_id": "chat_wa_12345",
      "text": "Hey, let's schedule a call.",
      "timestamp": "2026-08-10T13:50:00.000Z",
      "is_sender": true,
      "sender_id": "my_account_id",
      "delivered": true,
      "seen": true,
      "seen_by": { "15559998888@s.whatsapp.net": true },
      "attachments": []
    }
  ],
  "total": 1,
  "cursor": null,
  "fetched_at": "2026-08-10T14:00:35.000Z"
}
```

---

### 4. Send Message (`POST /api/whatsapp/send-message`)

Sends a text message to an existing WhatsApp chat.

- **Endpoints:**
  - `POST /api/whatsapp/send-message`
  - `POST /api/unipile/whatsapp/send-message`

#### Request Body
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `chatId` / `chat_id` | `string` | **Yes** | Target WhatsApp Chat ID. |
| `text` | `string` | **Yes** | Message body (must be a non-empty string). |

#### Response (`200 OK`)
```json
{
  "success": true,
  "chat_id": "chat_wa_12345",
  "data": {
    "id": "msg_002",
    "chat_id": "chat_wa_12345",
    "text": "Sure, 3 PM works for me!",
    "timestamp": "2026-08-10T14:00:00.000Z"
  }
}
```

---

### 5. Start New Chat (`POST /api/whatsapp/start-chat`)

Initiates a new WhatsApp chat with a target phone number and sends an initial message. Non-digit characters in the phone number are stripped automatically (e.g. `+1 (555) 000-1234` becomes `15550001234`).

- **Endpoints:**
  - `POST /api/whatsapp/start-chat`
  - `POST /api/unipile/whatsapp/start-chat`

#### Request Body
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `whatsapp_number` / `number` / `phone_number` | `string` | **Yes** | Contact phone number with country code. |
| `text` | `string` | **Yes** | Initial message text to send. |
| `user_id` | `string` | Optional* | Local user ID. |
| `accountId` | `string` | Optional* | Unipile account ID. |

#### Response (`200 OK`)
```json
{
  "success": true,
  "chat_id": "chat_wa_998877",
  "data": {
    "id": "chat_wa_998877",
    "account_id": "acc_wa_987654321",
    "attendees": [
      { "id": "15550001234@s.whatsapp.net" }
    ]
  }
}
```

---

### 6. Proxy Profile Picture (`GET /api/whatsapp/attendees/:id/picture`)

Streams an attendee's profile picture directly from the backend. **Use this URL directly in HTML `<img>` tags on the frontend.** This avoids exposing API keys in client requests and provides 24-hour browser caching (`Cache-Control: public, max-age=86400`).

- **Endpoints:**
  - `GET /api/whatsapp/attendees/:id/picture?account_id=...`
  - `GET /api/unipile/whatsapp/attendees/:id/picture?account_id=...`

#### Query Parameters
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `account_id` | `string` | **Yes** | Unipile account ID associated with the attendee. |

#### Response (`200 OK`)
- **Headers:** `Content-Type: image/jpeg` (or original image format), `Cache-Control: public, max-age=86400`
- **Body:** Binary image file stream.

---

## 3. Client-Side TypeScript Interfaces

Copy and paste these interfaces into your frontend project (e.g. `types/whatsapp.ts`):

```typescript
export interface WhatsAppProfile {
  provider_id: string;
  name?: string;
  public_identifier?: string;
  picture_url?: string;
  status?: string;
  [key: string]: any;
}

export interface WhatsAppAttendeeProfile {
  id: string;
  name: string;
  provider_id?: string;
  public_identifier?: string;
  profile_picture_url: string;
}

export interface WhatsAppMessage {
  id: string;
  chat_id: string;
  text: string | null;
  timestamp: string | number;
  is_sender: boolean;
  sender_id?: string;
  delivered: boolean;
  seen: boolean;
  seen_by: Record<string, boolean | string | number>;
  attachments: any[];
  [key: string]: any;
}

export interface WhatsAppChat {
  id: string;
  account_id: string;
  name?: string;
  unread_count?: number;
  timestamp?: string | number;
  attendee_provider_id?: string;
  attendees_profiles?: WhatsAppAttendeeProfile[];
  messages?: WhatsAppMessage[];
  message_count?: number;
  [key: string]: any;
}

// Request Types
export interface FetchProfilePayload {
  providerID: string;
  accountId?: string;
  user_id?: string;
}

export interface FetchConversationsPayload {
  accountId?: string;
  user_id?: string;
  providerID?: string;
  limit?: number;
  include_messages?: boolean;
  message_limit?: number;
}

export interface FetchMessagesPayload {
  chatId: string;
  accountId?: string;
  user_id?: string;
  limit?: number;
}

export interface SendMessagePayload {
  chatId: string;
  text: string;
}

export interface StartChatPayload {
  whatsapp_number: string;
  text: string;
  user_id?: string;
  accountId?: string;
}
```

---

## 4. Frontend Integration Examples

### Example: Fetching & Displaying WhatsApp Conversations in React
```typescript
import React, { useEffect, useState } from "react";
import { WhatsAppChat, FetchConversationsPayload } from "../types/whatsapp";

export const WhatsAppChatList: React.FC<{ userId: string }> = ({ userId }) => {
  const [chats, setChats] = useState<WhatsAppChat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadChats() {
      try {
        const payload: FetchConversationsPayload = {
          user_id: userId,
          include_messages: true,
          limit: 20,
          message_limit: 10,
        };

        const res = await fetch("/api/whatsapp/fetch-conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const json = await res.json();
        if (json.success) {
          setChats(json.data.items);
        }
      } catch (err) {
        console.error("Failed to load chats:", err);
      } finally {
        setLoading(false);
      }
    }

    loadChats();
  }, [userId]);

  if (loading) return <div>Loading WhatsApp chats...</div>;

  return (
    <div className="chat-list">
      {chats.map((chat) => {
        const attendee = chat.attendees_profiles?.[0];
        const lastMessage = chat.messages?.[chat.messages.length - 1];

        return (
          <div key={chat.id} className="chat-item">
            {attendee && (
              <img
                src={attendee.profile_picture_url}
                alt={attendee.name}
                width={40}
                height={40}
                style={{ borderRadius: "50%" }}
              />
            )}
            <div className="chat-details">
              <h4>{chat.name || attendee?.name || "WhatsApp Contact"}</h4>
              <p>{lastMessage?.text || "No messages yet"}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
};
```

---

## 5. Summary Matrix

| Operation | Method | Route | Key Input | Key Output |
| :--- | :--- | :--- | :--- | :--- |
| **Fetch Profile** | `POST` | `/api/whatsapp/fetch-profile` | `providerID`, `user_id` | Profile Object, status, avatar |
| **List Chats** | `POST` | `/api/whatsapp/fetch-conversations` | `user_id`, `include_messages` | List of chats (+ hydrated messages) |
| **Fetch Messages**| `POST` | `/api/whatsapp/fetch-messages` | `chatId`, `limit` | Array of normalized messages |
| **Send Message** | `POST` | `/api/whatsapp/send-message` | `chatId`, `text` | Created message confirmation |
| **Start Chat** | `POST` | `/api/whatsapp/start-chat` | `whatsapp_number`, `text` | New chat object & `chat_id` |
| **Avatar Proxy** | `GET` | `/api/whatsapp/attendees/:id/picture` | `account_id` (Query) | Binary image stream |
