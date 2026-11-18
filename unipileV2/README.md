# unipileV2: Unipile API v2

This folder replaces `uniplieApi/` (v1), which is left untouched as the rollback. It exposes the same endpoints, paths and response shapes, but calls `https://api.unipile.com/v2` underneath.

## Environment variables (`.env`)

| Variable | Purpose |
|---|---|
| `UNIPILE_API_VERSION` | `v1` (default) or `v2`. Chooses which module `app.js` mounts (planned, not wired yet). |
| `UNIPILE_V2_API_KEY` | A v2 **Global Account API Key** for the OnePgr Production app. It expires 2028-11-17; rotate it before then. |
| `UNIPILE_V2_BASE_URL` | Optional. Defaults to `https://api.unipile.com/v2`. |
| `UNIPILE_V2_WEBHOOK_SECRET` | The secret shown on the v2 dashboard's webhook endpoint. |

## Webhook

`POST /api/unipile/v2/webhook` is mounted in both v1 and v2 modes.
- `GET` on the same path reports whether the secret is configured.
- Every request is checked against the `unipile-signature` header (HMAC-SHA256 over `${t}.${rawBody}`, at most 300 s old).
- A missing secret returns `503`. A bad signature returns `401`.
- Valid events are acknowledged immediately and processed afterwards.

**Account events** update `unipile-LinkedIn-data` / `unipile-whatsapp-data`:
- The record is linked through `v2_account_id`. For migrated accounts it is found via `metadata.v1_account_id`.
- `v2_status`, `v2_last_event`, `v2_locked` and the other `v2_*` fields are written in both modes.
- `status` and `connected` (v1 vocabulary: `CREATION_SUCCESS`, `OK`, `CREDENTIALS`, `ERROR`, `DELETED`, …) are only written when `UNIPILE_API_VERSION=v2`. In v1 mode the v1 webhook still owns those fields.

**Message events** are cached in memory under `core/eventCache.js` (`msg_status:<id>`, `incoming_msg:<id>`, `msg_event:<id>`).

### Dashboard setup (v2 → Webhooks → Add endpoint)
1. **URL:** `https://videoresponse.onepgr.com:3001/api/unipile/v2/webhook`
2. **Accounts:** all.
3. **Events:**
   - all `account.*`
   - `message.new`, `message.update`, `message.delete`
   - `message.receipt.read`, `message.receipt.delivery`
   - `message.reaction.new`
4. Copy the endpoint secret into `UNIPILE_V2_WEBHOOK_SECRET` and restart the server.
5. Send a test event from **Test and Debug Webhooks**. The server log should show `[unipile-v2-webhook] …`.

## Backfill

Links each migrated account's Mongo record to its v2 ID:

```bash
node scripts/unipileV2/backfillV2AccountIds.js --dry-run
node scripts/unipileV2/backfillV2AccountIds.js
```

## Tests

```bash
node --test test/unipileV2/
```

`spec/openapi-core.json` is a saved copy of Unipile's v2 Core API spec (accounts, auth, webhooks), from `https://api.unipile.com/v2/docs/json`.
