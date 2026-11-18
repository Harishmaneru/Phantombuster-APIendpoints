#!/usr/bin/env node
/**
 * Link our MongoDB account records to their Unipile v2 accounts.
 *
 * Unipile's v1 → v2 transfer gives every account a new id ("acc_...") and keeps
 * the old one in metadata.v1_account_id. This script pages through
 * GET /v2/accounts/ and sets `v2_account_id` on every record in
 * unipile-LinkedIn-data / unipile-whatsapp-data whose `account_id` matches.
 *
 * Usage (from the repo root):
 *   node scripts/unipileV2/backfillV2AccountIds.js --dry-run
 *   node scripts/unipileV2/backfillV2AccountIds.js
 *
 * Needs UNIPILE_V2_API_KEY and ONEPGR_MONGO_URI in .env.
 * Safe to re-run: it only sets v2_account_id / v2_linked_at / v2_updated_at.
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const client = require("../../unipileV2/core/client");
const { storeForProvider } = require("../../unipileV2/services/accountStore");
const { getCollection, COLLECTIONS, closeMongo } = require("../../unipileV2/services/mongo");

const PAGE_SIZE = 100;
const dryRun = process.argv.includes("--dry-run");

async function listAllV2Accounts() {
  const accounts = [];
  let offset = 0;
  // GET /v2/accounts/ — offset/limit pagination with has_more
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await client.get("/accounts/", {
      params: { offset: String(offset), limit: String(PAGE_SIZE) },
    });
    const page = res.data?.data || [];
    accounts.push(...page);
    if (!res.data?.has_more || page.length === 0) break;
    offset += page.length;
  }
  return accounts;
}

async function main() {
  console.log(`Unipile v2 backfill ${dryRun ? "(DRY RUN — nothing is written)" : ""}`);
  const accounts = await listAllV2Accounts();
  console.log(`Found ${accounts.length} account(s) in Unipile v2.\n`);

  const rows = [];
  for (const acc of accounts) {
    const v1Id = acc.metadata?.v1_account_id || null;
    const store = storeForProvider(acc.provider);
    let result;
    if (!store) result = "skipped (provider not used by our app)";
    else if (!v1Id) result = "no v1_account_id (linked directly in v2)";
    else {
      const { matched, users, tempCount } = await store.linkV2AccountByV1Id(v1Id, acc.id, { dryRun });
      const tempNote = tempCount ? ` (+${tempCount} temp_ record(s) skipped)` : "";
      result =
        matched === 0
          ? `NOT LINKED: no user record uses this v1 account${tempNote}`
          : `${dryRun ? "would link" : "linked"} user ${users.join(", ")}${tempNote}`;
    }
    rows.push({
      provider: acc.provider,
      name: acc.name || "",
      status: acc.status,
      v2_account_id: acc.id,
      v1_account_id: v1Id || "",
      result,
    });
  }
  console.table(rows);

  // Real user records that still have no v2 account (these users must reconnect).
  for (const [provider, name] of Object.entries(COLLECTIONS)) {
    const col = await getCollection(name);
    const noV2 = { $or: [{ v2_account_id: { $exists: false } }, { v2_account_id: null }] };
    const missing = await col
      .find({ provider, user_id: { $not: /^temp_/ }, ...noV2 })
      .project({ user_id: 1, account_id: 1, name: 1, connected: 1, _id: 0 })
      .toArray();
    const tempCount = await col.countDocuments({ provider, user_id: /^temp_/ });
    const otherProvider = await col.countDocuments({ provider: { $ne: provider } });
    console.log(
      `\n${provider}: ${missing.length} user record(s) without v2_account_id` +
        (dryRun ? " (before this run)" : ""),
    );
    if (missing.length) console.table(missing);
    console.log(
      `   ignored: ${tempCount} temp_ placeholder record(s), ${otherProvider} record(s) with a different provider in this collection`,
    );
  }
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err.response?.status || "", err.response?.data || err.message);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
