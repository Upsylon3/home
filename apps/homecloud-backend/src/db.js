// HomeCloud's own database — files, folders, and share links. HomeCloud
// has no identity of its own; every row here is tagged with a plain
// `user_id`/`created_by` integer that means "the HomeCore user with this
// id," verified on every request via @home/homecore-client, never stored
// or checked locally.
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

// `user_id`/`created_by` are plain INTEGER columns, not foreign keys into
// a `users` table — there is no `users` table in this database. Identity
// lives entirely in HomeCore, a separate process with its own separate
// database; a foreign key can't reach across two different SQLite files.
//
// One real consequence: if HomeCore ever deletes a user account outright
// (today it only disables accounts — see homecore/src/admin.js — so this
// doesn't happen yet), this service's rows for that user would NOT be
// automatically cleaned up the way a real foreign key's ON DELETE CASCADE
// would guarantee. Not a live bug — there's nothing for it to break yet —
// but a real, named gap: whoever adds account deletion needs to also make
// HomeCore tell this service to clean up (an event, or a direct call),
// not assume the database will handle it.
//
// folders.parent_id -> folders.id and shares.file_id -> files.id both stay
// as real foreign keys — both tables live in this same database, so those
// constraints work exactly as normal.
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

// Emits into HomeCore's shared hc_activity_events over HTTP, fire-and-
// forget, per the Tier 1 rule in ARCHITECTURE.md §4 ("may emit events to
// the shared bus... your app must work identically whether anything is
// listening or not").
//
// Every files.js/folders.js call site is a bare, un-awaited statement —
// a slow or unreachable HomeCore never blocks a file upload/move/delete
// from completing; the activity feed just silently misses that entry.
// That's deliberate: logActivity() never had a request's bearer token to
// forward (only ever a plain userId — check any call site), so this
// authenticates as HomeCloud's *backend itself* calling HomeCore, via a
// shared secret, rather than as the acting user. See
// homecore/src/internalEvents.js's header comment for the other half of
// this and why that's the right shape for this specific call, not a
// workaround.
//
// Reuses @home/homecore-client's HOMECORE_URL rather than re-deriving
// HOMECORE_INTERNAL_URL a second time — that package already points at
// HomeCore (the name predates the Tier 0/1 rename; see its own comment).
const { HOMECORE_URL } = require("@home/homecore-client");

const INTERNAL_EVENTS_URL = `${HOMECORE_URL}/internal/events`;

function logActivity(userId, action, targetName = null) {
  fetch(INTERNAL_EVENTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": process.env.HOMECORE_INTERNAL_SECRET || ""
    },
    body: JSON.stringify({ userId, applicationSlug: "homecloud", action, targetName })
  })
    .then((res) => {
      if (!res.ok) {
        console.warn(
          `[homecloud-backend] HomeCore rejected activity event (${res.status}) for action "${action}" — ` +
          "the action itself already succeeded; only its entry in the activity feed is missing."
        );
      }
    })
    .catch((err) => {
      console.warn(
        `[homecloud-backend] Couldn't reach HomeCore to emit activity event for action "${action}" ` +
        `(the action itself already succeeded): ${err.message}`
      );
    });
}

module.exports = { db, DATA_DIR, UPLOADS_DIR, logActivity };
