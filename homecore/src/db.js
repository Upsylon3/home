const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

// Make sure the directories we need actually exist before anything touches them.
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "homecloud.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    mimetype TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);

  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);
  CREATE INDEX IF NOT EXISTS idx_shares_created_by ON shares(created_by);

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    target_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_activity_user_id ON activity_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity_log(created_at);
`);

// --- Lightweight migrations -------------------------------------------------
// SQLite's ALTER TABLE ADD COLUMN has no "IF NOT EXISTS" guard, so we just try
// each one and ignore the error if the column is already there. This lets the
// same code safely run against either a brand-new database or one created by
// an earlier version of this app.
function ensureColumn(table, columnDef) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (err) {
    if (!/duplicate column name/i.test(err.message)) throw err;
  }
}

ensureColumn("users", "role TEXT NOT NULL DEFAULT 'user'");
ensureColumn("users", "token_version INTEGER NOT NULL DEFAULT 0");
ensureColumn("users", "disabled INTEGER NOT NULL DEFAULT 0");
ensureColumn("users", "quota_override INTEGER");
ensureColumn("files", "deleted_at TEXT");
ensureColumn("files", "folder_id INTEGER");
ensureColumn("files", "thumbnail_name TEXT");
ensureColumn("users", "totp_secret TEXT");
ensureColumn("users", "totp_enabled INTEGER NOT NULL DEFAULT 0");

db.exec(`
  CREATE TABLE IF NOT EXISTS recovery_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_recovery_codes_user_id ON recovery_codes(user_id);
`);

// If this is an existing database from before roles existed, make sure at
// least one admin exists (promotes the earliest-created account).
const adminCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get();
if (adminCount.n === 0) {
  const oldest = db.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1").get();
  if (oldest) {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(oldest.id);
  }
}

// Records one line in the activity feed. Used throughout auth.js, files.js,
// and admin.js so there's a single, consistent trail of "who did what" —
// handy for a family server when someone asks "wait, where did my file go?"
//
// activityListeners lets other modules (namely homecore/db.js) observe every
// call to logActivity() without this file needing to know HomeCore exists.
// This is the seam HomeCore's event system hooks into: HomeCloud keeps
// calling logActivity() exactly as before, and HomeCore translates each call
// into a namespaced activity_events row (see HOME_MASTER_SPECIFICATION.md
// §7.6, §11) via onActivity() below. A listener throwing never breaks the
// original write.
const activityListeners = [];
function onActivity(listener) {
  activityListeners.push(listener);
}

function logActivity(userId, action, targetName = null) {
  db.prepare("INSERT INTO activity_log (user_id, action, target_name) VALUES (?, ?, ?)").run(
    userId,
    action,
    targetName
  );
  for (const listener of activityListeners) {
    try {
      listener(userId, action, targetName);
    } catch (err) {
      console.error("[homecloud] activity listener failed (activity_log write itself still succeeded):", err);
    }
  }
}

module.exports = { db, DATA_DIR, UPLOADS_DIR, logActivity, onActivity, ensureColumn };
