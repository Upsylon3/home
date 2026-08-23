// HomeMedia's own database. Deliberately small: HomeCloud already owns the
// actual files (HOME_MASTER_SPECIFICATION.md §12 — "HomeMedia should not
// create a second copy of every photo merely to display it"), so nothing
// here stores file bytes or duplicates HomeCloud's file metadata. This is
// purely what HomeMedia adds on top: which HomeCloud files are photos or
// videos (media_index — a cache, rebuildable at any time by re-calling
// HomeCloud), cached EXIF, favorites, and albums.
//
// file_id values throughout refer to HomeCloud's `files.id` — there's no
// real foreign key (they live in a different database entirely, on a
// different service), so referential integrity here is "best effort":
// if someone deletes a file in HomeCloud, its rows here become orphaned
// until the next time the library is fetched, at which point they're
// silently dropped from the response (see library.js) rather than erroring.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const THUMBNAILS_DIR = path.join(DATA_DIR, "thumbnails");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "homemedia.db"));
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS media_index (
    file_id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
    exif_json TEXT,
    indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, file_id)
  );

  CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    cover_file_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS album_items (
    album_id INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (album_id, file_id)
  );

  CREATE INDEX IF NOT EXISTS idx_media_index_user ON media_index(user_id);
  CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
  CREATE INDEX IF NOT EXISTS idx_albums_user ON albums(user_id);
  CREATE INDEX IF NOT EXISTS idx_album_items_album ON album_items(album_id);
`);

function thumbnailPath(userId, fileId) {
  const dir = path.join(THUMBNAILS_DIR, String(userId));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${fileId}.jpg`);
}

module.exports = { db, DATA_DIR, THUMBNAILS_DIR, thumbnailPath };
