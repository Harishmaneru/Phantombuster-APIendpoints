/**
 * One-off seed: register Chandra's externally-bought domains in the
 * `connected_domains` collection for userId 9071.
 *
 * These domains are already added in cPanel manually, so we skip the
 * cPanel API entirely and just create DB records.
 *
 * Run:
 *   node scripts/seedChandraConnectedDomains.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const ConnectedDomain = require("../domainManagementAPI/connectedDomains.model.js");

const USER_ID = "9071";

const chandraDomains = [
  "hamiltonmarketing.online",
  "hamiltonmsolutions.space",
  "hamiltonmsolutions.site",
  "hamiltonmsolutions.online",
  "hamiltonmktg.info",
  "hamiltonmarketingsolutions.online",
  "hamiltonmarketingsolutions.pro",
];

async function run() {
  const mongoURI = process.env.ONEPGR_MONGO_URI;
  if (!mongoURI) {
    console.error("ONEPGR_MONGO_URI not set in environment");
    process.exit(1);
  }

  await mongoose.connect(mongoURI, {
    dbName: "onepgr_apps",
    serverSelectionTimeoutMS: 15000,
  });
  console.log("Connected to MongoDB (onepgr_apps)");

  const summary = { inserted: [], skipped: [], failed: [] };

  for (const raw of chandraDomains) {
    const domain = raw.toLowerCase().trim();

    try {
      const existing = await ConnectedDomain.findOne({
        userId: USER_ID,
        domain,
      });

      if (existing) {
        summary.skipped.push({ domain, reason: "already exists" });
        console.log(`SKIP  ${domain}  (already in DB)`);
        continue;
      }

      const created = await ConnectedDomain.create({
        userId: USER_ID,
        domain,
        source: "external",
        registrar: "godaddy",
        hostingProvider: "namecheap_vps",
        cpanel: {
          added: true,
          addedAt: new Date(),
          documentRoot: `/home/${process.env.CPANEL_MASTER_USER || "cpaneluser"}/public_html/${domain}`,
          method: "manual",
        },
        status: "pending",
        notes: "Manually added in cPanel UI; DB-only seed for client-side flow",
      });

      summary.inserted.push({ domain, _id: created._id.toString() });
      console.log(`OK    ${domain}  →  ${created._id}`);
    } catch (err) {
      summary.failed.push({ domain, error: err.message });
      console.error(`FAIL  ${domain}  →  ${err.message}`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Inserted: ${summary.inserted.length}`);
  console.log(`Skipped:  ${summary.skipped.length}`);
  console.log(`Failed:   ${summary.failed.length}`);
  console.log(JSON.stringify(summary, null, 2));

  await mongoose.disconnect();
  console.log("Disconnected.");
}

run().catch((err) => {
  console.error("Fatal error:", err);
  mongoose.disconnect().finally(() => process.exit(1));
});
