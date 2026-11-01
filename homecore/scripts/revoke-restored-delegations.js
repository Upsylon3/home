// Offline restore maintenance only. Never loads .env, starts services,
// creates a database or accepts an implicit personal/production data path.
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { createDelegationStore } = require("../src/homecore/delegationStore");
const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== "--database" || !path.isAbsolute(args[1]) || args[2] !== "--confirm-offline-restore") {
  console.error("Usage: node revoke-restored-delegations.js --database <absolute existing Core database> --confirm-offline-restore");
  process.exitCode = 1;
} else {
  let db;
  try {
    if (!fs.lstatSync(args[1]).isFile()) throw new Error("Invalid database.");
    db = new Database(args[1], { fileMustExist: true });
    db.pragma("foreign_keys = ON");
    for (const table of ["users", "hc_applications", "hc_activity_events"]) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) throw new Error("Not a Core database.");
    }
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'hc_delegation_grants'").get();
    const revoked = exists ? createDelegationStore(db).revokeRestored() : 0;
    console.log(JSON.stringify({ revoked }));
  } catch {
    console.error("Could not invalidate restored delegations. Keep services offline and check the database.");
    process.exitCode = 1;
  } finally { db?.close(); }
}
