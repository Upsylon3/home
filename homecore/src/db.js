const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");

// Make sure the directory we need actually exists before anything touches it.
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "homecore.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// HomeCore only owns identity (the `users` table above) and its own
// sessions/permissions/registry/events (see ./homecore/db.js). File
// storage (files, folders, share links) lives entirely in
// apps/homecloud-backend's own separate database — if you're looking at
// a database created by an older version of this project, you may still
// see unused `files`/`folders`/`shares` tables here. They're inert (no
// code reads or writes them) and safe to leave alone or drop manually.

// The activity feed used to be its own local `activity_log` table here.
// It's now the shared, cross-app `hc_activity_events` table (see
// ./homecore/db.js) instead — one feed that every app writes into,
// rather than a HomeCore-only table nothing else could see. This DROP
// just clears out the old table if it's still present from an older
// install; it's a no-op on a fresh database.
db.exec("DROP TABLE IF EXISTS activity_log");

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

// Records one line in the activity feed. Called from auth.js and
// admin.js so there's a single, consistent trail of "who did what" —
// handy for a family server when someone asks "wait, where did my file
// go?" (File/folder actions log their own activity over in
// apps/homecloud-backend, which has its own copy of this same pattern.)
//
// activityListeners lets other modules (namely ./homecore/db.js) observe
// every call to logActivity() without this file needing to know HomeCore
// exists. HomeCore translates each call into a namespaced
// hc_activity_events row (see HOME_MASTER_SPECIFICATION.md §7.6, §11) via
// onActivity() below — the listener registered at startup is the only
// place these events actually get written down; there's no separate
// local table this also writes to.
const activityListeners = [];
function onActivity(listener) {
  activityListeners.push(listener);
}

function logActivity(userId, action, targetName = null) {
  for (const listener of activityListeners) {
    try {
      listener(userId, action, targetName);
    } catch (err) {
      console.error("[homecore] activity listener failed:", err);
    }
  }
}

module.exports = { db, DATA_DIR, logActivity, onActivity, ensureColumn };
