// HomeNotes' own database. Per HOME_MASTER_SPECIFICATION.md §2.2 ("do not
// build a second file storage system for HomeNotes"), note *content* is
// small structured text — genuinely appropriate for a database row, not
// "file storage" in the sense the spec is warning against — while actual
// attachments (images, PDFs embedded in or linked from a note) are real
// HomeCloud files, referenced by id in note_attachments below, same
// principle as HomeMedia's and HomeSync's own databases.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "homenotes.db"));
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS note_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES note_folders(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    folder_id INTEGER REFERENCES note_folders(id),
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    is_favorite INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  );

  -- Case-insensitive uniqueness so "Ideas" and "ideas" don't become two
  -- different tags by accident — same reasoning as HomeCloud's own
  -- case-insensitive folder-name collision check.
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    UNIQUE(user_id, name COLLATE NOCASE)
  );

  CREATE TABLE IF NOT EXISTS note_tags (
    note_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (note_id, tag_id)
  );

  -- A snapshot per meaningful save, not per keystroke — see notes.js's
  -- shouldSnapshotVersion() for the debounce logic that keeps this table
  -- from growing one row per autosave tick.
  CREATE TABLE IF NOT EXISTS note_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS note_attachments (
    note_id INTEGER NOT NULL,
    homecloud_file_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (note_id, homecloud_file_id)
  );

  CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, deleted_at);
  CREATE INDEX IF NOT EXISTS idx_note_folders_user ON note_folders(user_id);
  CREATE INDEX IF NOT EXISTS idx_note_versions_note ON note_versions(note_id);
  CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);
`);

module.exports = { db, DATA_DIR };
