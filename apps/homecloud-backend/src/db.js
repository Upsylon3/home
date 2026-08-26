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
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "homecloud.db"));
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

// files/folders/shares, moved from homecore/src/db.js per MIGRATION_PLAN.md's
// Phase 2. One real, deliberate schema change from the original: none of
// these reference `users(id)` as a foreign key anymore. They used to
// (`user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`),
// which worked when files/folders/shares and users all lived in one
// SQLite file — a foreign key can't reach across two separate database
// files/processes, so that constraint literally cannot be expressed here
// anymore. `user_id`/`created_by` stay as plain INTEGER columns.
//
// Concretely, this means: if HomeCore ever deletes a user account outright
// (not just disables it — checked directly: no such route exists in
// homecore/src/admin.js today, only disable/quota/role/2FA-reset), that
// user's rows here would NOT be automatically cleaned up the way
// ON DELETE CASCADE used to guarantee. Not a live bug — there's nothing
// for it to break yet — but a real, named gap: whoever adds account
// deletion needs to also make HomeCore tell this service to clean up
// (an event, or a direct call), not assume the database will do it.
//
// folders.parent_id -> folders.id and shares.file_id -> files.id both stay
// as real foreign keys — both tables live in this same database, so
// those constraints work exactly as before.
db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    mimetype TEXT,
    folder_id INTEGER,
    thumbnail_name TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);

  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_folders_user_id ON folders(user_id);
  CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);

  CREATE TABLE IF NOT EXISTS shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    created_by INTEGER NOT NULL,
    expires_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);
  CREATE INDEX IF NOT EXISTS idx_shares_created_by ON shares(created_by);
`);

// TEMPORARY — see MIGRATION_PLAN.md's Phase 3. files.js/folders.js were
// moved here from homecore/ largely unchanged, including every
// logActivity() call site, so Phase 3 only has to change what this
// function DOES, not rewrite every caller a second time.
//
// Right now this is a genuine, honest no-op: file/folder actions
// performed through this service do NOT appear in anyone's activity feed
// until Phase 3 lands the real replacement (emitting into HomeCore's
// shared hc_activity_events over HTTP, fire-and-forget, per the Tier 1
// rule in ARCHITECTURE.md §4). This is a real, temporary, KNOWN gap — see
// CHANGELOG.md — not an oversight, and nothing here depends on
// logActivity doing anything beyond "don't crash."
function logActivity(userId, action, targetName = null) {
  // Intentionally empty — see comment above.
}

module.exports = { db, DATA_DIR, UPLOADS_DIR, logActivity };
