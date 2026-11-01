// Offline restore maintenance. No .env, key file or service is loaded.
const fs = require("node:fs"), path = require("node:path");
const Database = require("better-sqlite3");
const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== "--database" || !path.isAbsolute(args[1]) || args[2] !== "--confirm-offline-restore") {
  console.error("Usage: node pause-restored-automation.js --database <absolute existing Bridge database> --confirm-offline-restore");
  process.exitCode = 1;
} else {
  let db;
  try {
    if (!fs.lstatSync(args[1]).isFile()) throw new Error("Invalid file.");
    db = new Database(args[1], { fileMustExist: true });
    const paused = db.transaction(() => {
      const count = db.prepare(`UPDATE bridge_rules SET enabled = 0, revocation_pending = 1, status = 'stopping',
        reason = 'revocation-pending', revision = revision + 1, qualification = '{}', last_evaluation = NULL,
        lease_owner = NULL, lease_until = 0, control_until = 0 WHERE grant_id IS NOT NULL`).run().changes;
      db.prepare("UPDATE bridge_slots SET owner = NULL, lease_until = 0").run();
      return count;
    }).immediate();
    console.log(JSON.stringify({ paused }));
  } catch { console.error("Could not pause restored automation. Keep services offline."); process.exitCode = 1; }
  finally { db?.close(); }
}
