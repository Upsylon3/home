// HomeSync's own database: which devices a user has backing up, and which
// content hashes have already been synced (for dedup + backup history).
// Never the file bytes themselves — those go straight to HomeCloud, same
// principle as HomeMedia's db.js.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "homesync.db"));
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    platform TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT
  );

  -- Deduplication is scoped per-user, not per-device: if one phone already
  -- backed up a photo, a second device with the same photo (a restored
  -- backup, a shared album saved to both) shouldn't upload a second copy.
  CREATE TABLE IF NOT EXISTS synced_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_id INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    homecloud_file_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    size INTEGER NOT NULL,
    synced_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_synced_files_user_hash ON synced_files(user_id, content_hash);
  CREATE INDEX IF NOT EXISTS idx_synced_files_user_synced_at ON synced_files(user_id, synced_at);
  CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
`);

module.exports = { db, DATA_DIR };
