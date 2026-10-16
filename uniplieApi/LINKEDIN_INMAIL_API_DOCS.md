# LinkedIn InMail API Documentation (Client-Side Guide)

**EC2 API Base URL:** `https://videoresponse.onepgr.com:3001`  
**Integration:** Unipile LinkedIn Integration  
**Target Audience:** Frontend & Client-Side Engineers (React / Vue / Mobile / Full-Stack)

---

## 1. Overview & Core Concept

This API allows your client-side application to check a user's LinkedIn InMail credit balance and send InMails to 2nd-degree and 3rd-degree LinkedIn members.

### 🔑 User-Centric Design (`userId` Only)
* **Client-side applications only ever need to pass `userId`.**
* You **do not** need to know, fetch, or store Unipile `account_id` on the client.
* The backend server automatically looks up the user's connected LinkedIn account from the database using their `userId`.

### Key Terms
1. **InMail Credits**: Required to message members who are not 1st-degree connections. Sourced from the user's connected LinkedIn subscription (Sales Navigator, Recruiter, or Premium).
2. **Open Profile (Free InMail)**: If the recipient has an **Open Profile** (`is_open_profile: true`), LinkedIn delivers the InMail **for free without deducting any InMail credits**.
3. **Subject Line**: Unlike standard messages, **InMails require a Subject line**.

---

## 2. InMail Flow Architecture

```mermaid
flowchart TD
    A["User initiates message to LinkedIn profile"] --> B["Step 1: Check InMail Credits<br/>GET /api/unipile/user/:userId/inmail/credits"]
    B --> C{"Has InMail Credits?<br/>(Total Credits > 0)"}
    
    C -->|Yes| D["Step 2: Send InMail<br/>POST /api/unipile/user/:userId/linkedin/message"]
    C -->|No / 0 Credits| E["Check if Recipient is Open Profile<br/>POST /api/linkedin/fetch-profile"]
    
    E --> F{"is_open_profile == true?"}
    F -->|Yes (Free InMail)| D
    F -->|No| G["Show Alert to User:<br/>'No InMail credits remaining'"]
    
    D --> H{"Response"}
    H -->|200 OK| I["Success: InMail Sent"]
    H -->|422 / 400| J["Show Error Message"]
```

---

## 3. Client-Side API Endpoints

### Step 1: Check If User Has InMail Credits

Call this endpoint before displaying the InMail compose modal or before triggering the send action to verify the user has credits.

```http
GET https://videoresponse.onepgr.com:3001/api/unipile/user/:userId/inmail/credits
```

#### Request Headers
```http
Accept: application/json
```

#### Path Parameters
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `userId` | `string` | **Yes** | The local application User ID (e.g. `user_12345`). |

#### Response (`200 OK`)
```json
{
  "success": true,
  "credits": {
    "object": "LinkedinInmailBalance",
    "premium": 5,
    "recruiter": 0,
    "sales_navigator": 20
  },
  "user_id": "user_12345",
  "account_id": "acc_67ab12cd89ef"
}
```

#### How to Check in Client Code:
```javascript
const { premium = 0, recruiter = 0, sales_navigator = 0 } = response.credits;
const totalCredits = premium + recruiter + sales_navigator;
const hasCredits = totalCredits > 0;

console.log(`User has ${totalCredits} InMail credits available.`);
```

---

### Step 2 (Optional): Check If Recipient Is an Open Profile

If a user has **0 paid credits**, check if the recipient has an **Open Profile**. If `is_open_profile: true`, the user can send the InMail for free!

```http
POST https://videoresponse.onepgr.com:3001/api/linkedin/fetch-profile
Content-Type: application/json
```

#### Request Body
```json
{
  "user_id": "user_12345",
  "providerID": "https://www.linkedin.com/in/target-username"
}
```

#### Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "provider_id": "ACoAABcDeFg...",
    "public_identifier": "target-username",
    "name": "Jane Doe",
    "is_open_profile": true,
    "headline": "VP of Engineering at TechCorp"
  }
}
```

> **Client Rule:** If `data.is_open_profile === true`, allow sending the InMail even if paid credits are 0.

---

### Step 3: Send InMail Message

Sends the message as an InMail using the user's connected LinkedIn account.

```http
POST https://videoresponse.onepgr.com:3001/api/unipile/user/:userId/linkedin/message
Content-Type: application/json
```

#### Path Parameters
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `userId` | `string` | **Yes** | The local application User ID. |

#### Request Body (JSON)
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `use_inmail` | `boolean` | **Yes** | **Must be `true`** to send as InMail. |
| `subject` | `string` | **Yes** | **Subject line** (mandatory for InMails, e.g. `"Partnership Discussion"`). |
| `message` | `string` | **Yes** | Body text of the InMail. |
| `profile_url` | `string` | Optional* | Full LinkedIn profile URL (e.g. `https://linkedin.com/in/username`). |
| `profile_identifier`| `string` | Optional* | LinkedIn public username (e.g. `username`) or provider ID (`ACw...`). |

*\* At least one of `profile_url` or `profile_identifier` must be provided.*

#### Example Request Payload
```json
{
  "profile_url": "https://www.linkedin.com/in/target-username",
  "subject": "Quick Question on Platform Architecture",
  "message": "Hi Jane,\n\nI saw your work on scalable distributed systems and wanted to reach out regarding our new developer platform.\n\nBest,\nAlex",
  "use_inmail": true
}
```

#### Response (`200 OK`)
```json
{
  "success": true,
  "is_inmail": true,
  "message": "InMail sent successfully",
  "chat_id": "ch_78bc34de56fa",
  "message_id": "msg_90ef12ab34cd",
  "recipient_id": "ACoAABcDeFg...",
  "user_id": "user_12345"
}
```

---

## 4. Frontend Implementation Example (TypeScript / JavaScript)

Here is a clean, client-side utility you can directly drop into your application:

```typescript
const BASE_URL = "https://videoresponse.onepgr.com:3001";

interface InmailCredits {
  premium: number;
  recruiter: number;
  sales_navigator: number;
}

/**
 * 1. Check if user has InMail credits
 */
export async function getUserInmailCredits(userId: string): Promise<{
  hasCredits: boolean;
  totalCredits: number;
  credits: InmailCredits;
}> {
  const res = await fetch(`${BASE_URL}/api/unipile/user/${userId}/inmail/credits`);
  const data = await res.json();

  if (!res.ok || !data.success) {
    throw new Error(data.error || "Failed to fetch InMail credits. Please ensure your LinkedIn account is connected.");
  }

  const { premium = 0, recruiter = 0, sales_navigator = 0 } = data.credits;
  const totalCredits = premium + recruiter + sales_navigator;

  return {
    hasCredits: totalCredits > 0,
    totalCredits,
    credits: { premium, recruiter, sales_navigator },
  };
}

/**
 * 2. Send LinkedIn InMail
 */
export async function sendLinkedInInMail({
  userId,
  profileUrl,
  subject,
  message,
}: {
  userId: string;
  profileUrl: string;
  subject: string;
  message: string;
}) {
  if (!subject?.trim()) {
    throw new Error("Subject line is required for InMail messages.");
  }
  if (!message?.trim()) {
    throw new Error("Message body cannot be empty.");
  }

  const res = await fetch(`${BASE_URL}/api/unipile/user/${userId}/linkedin/message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      profile_url: profileUrl,
      subject: subject.trim(),
      message: message.trim(),
      use_inmail: true,
    }),
  });

  const result = await res.json();

  if (!res.ok || !result.success) {
    throw new Error(result.error || result.details || "Failed to send InMail.");
  }

  return result;
}

/**
 * 3. Complete Recommended Flow Orchestrator
 * Checks credits first -> Sends InMail only if allowed
 */
export async function handleSendInmailFlow(
  userId: string,
  recipientProfileUrl: string,
  subject: string,
  message: string
) {
  // Step 1: Check credits
  const { hasCredits, totalCredits } = await getUserInmailCredits(userId);

  if (!hasCredits) {
    // Optional fallback: Check if recipient profile is an Open Profile
    const profileRes = await fetch(`${BASE_URL}/api/linkedin/fetch-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, providerID: recipientProfileUrl }),
    });
    const profileData = await profileRes.json();

    const isOpenProfile = profileData?.data?.is_open_profile === true;
    if (!isOpenProfile) {
      throw new Error(
        "You have 0 InMail credits remaining, and this recipient does not accept free Open Profile InMails."
      );
    }
  }

  // Step 2: Send InMail
  return await sendLinkedInInMail({
    userId,
    profileUrl: recipientProfileUrl,
    subject,
    message,
  });
}
```

---

## 5. cURL Testing Commands

### 1. Check Credits
```bash
curl -X GET \
  https://videoresponse.onepgr.com:3001/api/unipile/user/YOUR_USER_ID/inmail/credits
```

### 2. Send InMail
```bash
curl -X POST \
  https://videoresponse.onepgr.com:3001/api/unipile/user/YOUR_USER_ID/linkedin/message \
  -H "Content-Type: application/json" \
  -d '{
    "profile_url": "https://www.linkedin.com/in/target-username",
    "subject": "Partnership Inquiry",
    "message": "Hi, I would love to connect and explore synergies.",
    "use_inmail": true
  }'
```

---

## 6. Error Responses & Handling

| Status Code | Error Message | Solution / User Feedback |
| :--- | :--- | :--- |
| **`404 Not Found`** | `"No LinkedIn account found"` | The `userId` has not connected a LinkedIn account yet. Prompt the user to connect their LinkedIn account. |
| **`400 Bad Request`** | `"message is required"` | The user left the message text blank. |
| **`400 Bad Request`** | `"Either profile_url or profile_identifier is required"` | Profile URL is invalid or missing. |
| **`422 Unprocessable Entity`** | `"Unprocessable Entity - Unable to send message"` | Typically indicates **no InMail credits remaining** on the LinkedIn account, or the recipient has restricted incoming messages. |
