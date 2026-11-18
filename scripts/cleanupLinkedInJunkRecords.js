#!/usr/bin/env node
/**
 * Delete junk records from onepgr_apps.unipile-LinkedIn-data.
 *
 * The v1 Unipile account webhook used to accept WhatsApp account events and
 * write them into the LinkedIn collection with provider "WHATSAPP" and the
 * phone number as user_id — a new document on every event. This script
 * removes every record whose provider is set to something other than
 * "LINKEDIN" (any case). Records with no provider field are left alone and
 * only counted.
 *
 * WhatsApp accounts live in unipile-whatsapp-data, which this script does
 * not touch.
 *
 * Usage (from the repo root):
 *   node scripts/cleanupLinkedInJunkRecords.js --dry-run   # count + sample, deletes nothing
 *   node scripts/cleanupLinkedInJunkRecords.js             # deletes
 *
 * Needs ONEPGR_MONGO_URI in .env.
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { MongoClient } = require("mongodb");

const DB_NAME = "onepgr_apps";
const COLLECTION = "unipile-LinkedIn-data";
const SAMPLE_SIZE = 10;

// provider is a string and is not "linkedin" in any case. Missing/null provider is excluded.
const JUNK_FILTER = { provider: { $type: "string", $not: /^linkedin$/i } };

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const uri = process.env.ONEPGR_MONGO_URI;
  if (!uri) {
    console.error("ONEPGR_MONGO_URI is not set in .env");
    process.exit(1);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  try {
    const col = client.db(DB_NAME).collection(COLLECTION);
    console.log(
      `Cleaning ${DB_NAME}.${COLLECTION} ${dryRun ? "(DRY RUN — nothing is deleted)" : ""}\n`,
    );

    const [total, junkCount, noProvider] = await Promise.all([
      col.countDocuments({}),
      col.countDocuments(JUNK_FILTER),
      col.countDocuments({ $or: [{ provider: { $exists: false } }, { provider: null }] }),
    ]);
    console.log(`Total records:                  ${total}`);
    console.log(`Records to delete (non-LinkedIn): ${junkCount}`);
    console.log(`Records with no provider (kept): ${noProvider}\n`);

    if (junkCount === 0) {
      console.log("Nothing to delete.");
      return;
    }

    const breakdown = await col
      .aggregate([
        { $match: JUNK_FILTER },
        {
          $group: {
            _id: { provider: "$provider", user_id: "$user_id", account_id: "$account_id" },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ])
      .toArray();
    console.log("Top groups (provider / user_id / account_id → count):");
    for (const g of breakdown) {
      console.log(`  ${g._id.provider} / ${g._id.user_id} / ${g._id.account_id} → ${g.count}`);
    }

    const sample = await col
      .find(JUNK_FILTER, {
        projection: { _id: 1, user_id: 1, account_id: 1, provider: 1, name: 1, updated_at: 1 },
      })
      .limit(SAMPLE_SIZE)
      .toArray();
    console.log(`\nSample of ${sample.length} record(s):`);
    for (const doc of sample) console.log("  " + JSON.stringify(doc));

    if (dryRun) {
      console.log(`\nDry run: would delete ${junkCount} record(s). Re-run without --dry-run to delete.`);
      return;
    }

    const result = await col.deleteMany(JUNK_FILTER);
    console.log(`\nDeleted ${result.deletedCount} record(s).`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
