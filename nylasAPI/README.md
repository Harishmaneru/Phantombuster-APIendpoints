# Nylas v3 Email API - Inbox Fetch Endpoints

This API provides comprehensive inbox management functionality using Nylas v3 with API key authentication.

## Setup

### Environment Variables
Create a `.env` file with your Nylas API key:
```env
NYLAS_API_KEY=your_nylas_api_key_here
```

### Installation
The Nylas package is already installed in your project:
```bash
npm install nylas  # Already installed (v7.13.3)
```

## API Endpoints

All endpoints are prefixed with `/api/inbox`

### 1. Get Email Threads
**GET** `/api/inbox/threads`

Fetch email threads from inbox with various filters.

**Query Parameters:**
- `limit` (number, default: 20) - Number of threads to return
- `offset` (number, default: 0) - Pagination offset
- `expanded` (boolean, default: true) - Include expanded thread data
- `unread` (boolean, default: false) - Filter for unread threads only
- `starred` (boolean, default: false) - Filter for starred threads only
- `folder` (string, default: 'inbox') - Folder to search in

**Example:**
```bash
curl "http://localhost:3001/api/inbox/threads?limit=10&unread=true"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "threads": [
      {
        "id": "thread_123",
        "subject": "Meeting Tomorrow",
        "participants": [
          {
            "name": "John Doe",
            "email": "john@example.com"
          }
        ],
        "messageCount": 3,
        "lastMessageAt": "2024-01-15T10:30:00.000Z",
        "unread": true,
        "starred": false,
        "folders": ["INBOX"],
        "snippet": "Let's discuss the project..."
      }
    ],
    "count": 1,
    "pagination": {
      "limit": 10,
      "offset": 0
    }
  },
  "message": null,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### 2. Get Messages
**GET** `/api/inbox/messages`

Fetch messages from inbox with advanced filtering.

**Query Parameters:**
- `limit` (number, default: 50) - Number of messages to return
- `offset` (number, default: 0) - Pagination offset
- `folder` (string, default: 'inbox') - Folder to search in
- `unread` (boolean, default: false) - Filter for unread messages only
- `starred` (boolean, default: false) - Filter for starred messages only
- `search` (string) - Search query
- `from` (string) - Filter by sender email
- `to` (string) - Filter by recipient email
- `subject` (string) - Filter by subject

**Example:**
```bash
curl "http://localhost:3001/api/inbox/messages?limit=20&unread=true&search=urgent"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "msg_123",
        "subject": "Urgent: Project Update",
        "from": [
          {
            "name": "Jane Smith",
            "email": "jane@company.com"
          }
        ],
        "to": [
          {
            "name": "John Doe",
            "email": "john@example.com"
          }
        ],
        "date": "2024-01-15T09:15:00.000Z",
        "unread": true,
        "starred": false,
        "folders": ["INBOX"],
        "snippet": "We need to discuss the project timeline...",
        "threadId": "thread_123",
        "attachments": []
      }
    ],
    "count": 1,
    "pagination": {
      "limit": 20,
      "offset": 0
    }
  },
  "message": null,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### 3. Get Specific Message
**GET** `/api/inbox/messages/:messageId`

Get full message details including body content.

**Example:**
```bash
curl "http://localhost:3001/api/inbox/messages/msg_123"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "msg_123",
    "subject": "Project Update",
    "from": [
      {
        "name": "Jane Smith",
        "email": "jane@company.com"
      }
    ],
    "to": [
      {
        "name": "John Doe",
        "email": "john@example.com"
      }
    ],
    "date": "2024-01-15T09:15:00.000Z",
    "unread": true,
    "starred": false,
    "folders": ["INBOX"],
    "snippet": "We need to discuss...",
    "body": "Full email body content here...",
    "threadId": "thread_123",
    "attachments": [
      {
        "id": "att_123",
        "filename": "document.pdf",
        "size": 1024000,
        "contentType": "application/pdf",
        "isInline": false,
        "contentDisposition": "attachment"
      }
    ]
  },
  "message": null,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### 4. Get Inbox Statistics
**GET** `/api/inbox/stats`

Get comprehensive inbox statistics.

**Example:**
```bash
curl "http://localhost:3001/api/inbox/stats"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 150,
    "unread": 25,
    "starred": 10,
    "recent": 45,
    "lastUpdated": "2024-01-15T10:30:00.000Z"
  },
  "message": null,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### 5. Search Messages
**GET** `/api/inbox/search`

Advanced search functionality for messages.

**Query Parameters:**
- `query` (string, required) - Search query
- `limit` (number, default: 20) - Number of results to return
- `offset` (number, default: 0) - Pagination offset
- `folder` (string, default: 'inbox') - Folder to search in
- `unread` (boolean, default: false) - Filter for unread messages only
- `starred` (boolean, default: false) - Filter for starred messages only

**Example:**
```bash
curl "http://localhost:3001/api/inbox/search?query=project&limit=10"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "msg_123",
        "subject": "Project Update",
        "from": [
          {
            "name": "Jane Smith",
            "email": "jane@company.com"
          }
        ],
        "to": [
          {
            "name": "John Doe",
            "email": "john@example.com"
          }
        ],
        "date": "2024-01-15T09:15:00.000Z",
        "unread": true,
        "starred": false,
        "snippet": "We need to discuss the project...",
        "threadId": "thread_123"
      }
    ],
    "count": 1,
    "query": "project",
    "pagination": {
      "limit": 10,
      "offset": 0
    }
  },
  "message": null,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### 6. Get Folders
**GET** `/api/inbox/folders`

Get all available folders/labels.

**Example:**
```bash
curl "http://localhost:3001/api/inbox/folders"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "folders": [
      {
        "id": "folder_1",
        "name": "INBOX",
        "displayName": "Inbox",
        "type": "inbox"
      },
      {
        "id": "folder_2",
        "name": "SENT",
        "displayName": "Sent",
        "type": "sent"
      }
    ],
    "count": 2
  },
  "message": null,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### 7. Get Unread Messages
**GET** `/api/inbox/unread`

Get all unread messages.

**Query Parameters:**
- `limit` (number, default: 50) - Number of messages to return
- `offset` (number, default: 0) - Pagination offset

**Example:**
```bash
curl "http://localhost:3001/api/inbox/unread?limit=25"
```

### 8. Get Recent Messages
**GET** `/api/inbox/recent`

Get recent messages from the last 24 hours (configurable).

**Query Parameters:**
- `limit` (number, default: 20) - Number of messages to return
- `offset` (number, default: 0) - Pagination offset
- `hours` (number, default: 24) - Hours to look back

**Example:**
```bash
curl "http://localhost:3001/api/inbox/recent?hours=48&limit=30"
```

## Message Actions

### 9. Mark Message as Read/Unread
**PUT** `/api/inbox/messages/:messageId/read`

Mark a message as read or unread.

**Request Body:**
```json
{
  "read": true
}
```

**Example:**
```bash
curl -X PUT "http://localhost:3001/api/inbox/messages/msg_123/read" \
  -H "Content-Type: application/json" \
  -d '{"read": true}'
```

### 10. Star/Unstar Message
**PUT** `/api/inbox/messages/:messageId/star`

Star or unstar a message.

**Request Body:**
```json
{
  "starred": true
}
```

**Example:**
```bash
curl -X PUT "http://localhost:3001/api/inbox/messages/msg_123/star" \
  -H "Content-Type: application/json" \
  -d '{"starred": true}'
```

## Error Handling

All endpoints return consistent error responses:

```json
{
  "success": false,
  "data": null,
  "message": "Error description",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Usage Examples

### JavaScript/Node.js
```javascript
const axios = require('axios');

// Get unread messages
async function getUnreadMessages() {
  try {
    const response = await axios.get('http://localhost:3001/api/inbox/unread?limit=10');
    console.log('Unread messages:', response.data.data.messages);
  } catch (error) {
    console.error('Error:', error.response.data.message);
  }
}

// Search for messages
async function searchMessages(query) {
  try {
    const response = await axios.get(`http://localhost:3001/api/inbox/search?query=${query}`);
    return response.data.data.results;
  } catch (error) {
    console.error('Search error:', error.response.data.message);
  }
}

// Mark message as read
async function markAsRead(messageId) {
  try {
    await axios.put(`http://localhost:3001/api/inbox/messages/${messageId}/read`, {
      read: true
    });
    console.log('Message marked as read');
  } catch (error) {
    console.error('Error marking as read:', error.response.data.message);
  }
}
```

### Python
```python
import requests

# Get inbox stats
def get_inbox_stats():
    response = requests.get('http://localhost:3001/api/inbox/stats')
    if response.status_code == 200:
        return response.json()['data']
    else:
        print(f"Error: {response.json()['message']}")

# Get recent messages
def get_recent_messages(hours=24, limit=20):
    response = requests.get(f'http://localhost:3001/api/inbox/recent?hours={hours}&limit={limit}')
    if response.status_code == 200:
        return response.json()['data']['messages']
    else:
        print(f"Error: {response.json()['message']}")
```

## Testing the API

Start your server:
```bash
npm start
# or
npm run dev
```

Test the endpoints:
```bash
# Get inbox stats
curl "http://localhost:3001/api/inbox/stats"

# Get recent messages
curl "http://localhost:3001/api/inbox/recent?limit=5"

# Search for messages
curl "http://localhost:3001/api/inbox/search?query=meeting&limit=10"

# Get unread messages
curl "http://localhost:3001/api/inbox/unread?limit=20"
```

## Key Features

- ✅ **API Key Authentication** - No OAuth required
- ✅ **Comprehensive Filtering** - Search, unread, starred, folder filters
- ✅ **Pagination Support** - Limit and offset parameters
- ✅ **Message Actions** - Mark as read/unread, star/unstar
- ✅ **Error Handling** - Consistent error responses
- ✅ **Statistics** - Inbox stats and counts
- ✅ **Search Functionality** - Native search queries
- ✅ **Recent Messages** - Configurable time ranges
- ✅ **Folder Management** - List all available folders
- ✅ **Attachment Support** - Full attachment information

This API provides everything you need for comprehensive inbox management using Nylas v3!
