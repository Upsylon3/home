// HomeCloud's own database, once this service actually owns any data.
//
// Deliberately empty of tables for now — this is Phase 1 of
// MIGRATION_PLAN.md: standing up the service shell (own process, own
// database file, own auth delegation) before Phase 2 moves the real
// files/folders/shares tables and logic here from homecore/src/db.js.
// Opening a real SQLite connection now, even with nothing in it yet, is
// what lets server.js's shutdown handler and the test harness treat this
// service exactly like its already-real siblings (homemedia-backend,
// homesync-backend, homenotes-backend) from day one, rather than needing
// a special case removed later.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "homecloud.db"));
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

// No CREATE TABLE statements yet — see MIGRATION_PLAN.md's Phase 2 for
// exactly which tables move here (files, folders, shares) and why
// activity_log doesn't move here unchanged but is retired in favor of
// emitting into HomeCore's existing hc_activity_events instead.

module.exports = { db, DATA_DIR };
