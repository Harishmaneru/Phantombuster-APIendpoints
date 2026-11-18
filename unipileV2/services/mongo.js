/**
 * Shared, lazily-opened MongoDB connection for unipileV2.
 *
 * Uses the same database and collections as uniplieApi (onepgr_apps /
 * unipile-LinkedIn-data, unipile-whatsapp-data). Nothing connects at require
 * time; the first query opens one client that both collections share.
 */

const { MongoClient } = require("mongodb");

const DB_NAME = "onepgr_apps";
const COLLECTIONS = {
  LINKEDIN: "unipile-LinkedIn-data",
  WHATSAPP: "unipile-whatsapp-data",
};

let clientPromise = null;

async function getDb() {
  if (!process.env.ONEPGR_MONGO_URI) {
    throw new Error("ONEPGR_MONGO_URI is not set");
  }
  if (!clientPromise) {
    clientPromise = MongoClient.connect(process.env.ONEPGR_MONGO_URI)
      .then((client) => {
        console.log("------------------ unipileV2 MongoDB Connected ---------------");
        return client;
      })
      .catch((err) => {
        clientPromise = null; // allow retry on next call
        throw err;
      });
  }
  const client = await clientPromise;
  return client.db(DB_NAME);
}

async function getCollection(name) {
  const db = await getDb();
  return db.collection(name);
}

/** Close the shared client (scripts only). */
async function closeMongo() {
  if (!clientPromise) return;
  const client = await clientPromise.catch(() => null);
  clientPromise = null;
  if (client) await client.close();
}

module.exports = { DB_NAME, COLLECTIONS, getCollection, closeMongo };
