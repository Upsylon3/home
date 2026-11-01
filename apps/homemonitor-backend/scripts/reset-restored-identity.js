// Offline restore maintenance only; never loads .env or starts the monitor.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const Database = require("better-sqlite3");
const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== "--database" || !path.isAbsolute(args[1]) || args[2] !== "--confirm-offline-restore") {
  console.error("Usage: node reset-restored-identity.js --database <absolute existing Monitor database> --confirm-offline-restore");
  process.exitCode = 1;
} else {
  let db;
  try {
    if (!fs.lstatSync(args[1]).isFile()) throw new Error("Invalid database.");
    db = new Database(args[1], { fileMustExist: true });
    db.transaction(() => {
      // Pre-feature snapshots have no pinned instance; startup creates one.
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'monitor_identity'").get();
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'alert_state'").get()) throw new Error("Not a Monitor database.");
      if (exists && db.prepare("UPDATE monitor_identity SET instance_id = ?, evaluated_at = NULL WHERE id = 1").run(randomUUID()).changes !== 1) {
        throw new Error("Missing Monitor identity.");
      }
    }).immediate();
    console.log(JSON.stringify({ reset: true }));
  } catch {
    console.error("Could not reset restored Monitor identity. Keep services offline and check the database.");
    process.exitCode = 1;
  } finally { db?.close(); }
}
