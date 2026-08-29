#!/usr/bin/env node
//
// One-time migration: copies real file/folder/share data from HomeCore's
// old, pre-Phase-5 storage into apps/homecloud-backend's own database and
// uploads directory.
//
// WHY THIS EXISTS — read before running it
// -----------------------------------------
// Phase 2 of MIGRATION_PLAN.md moved the files/folders/shares CODE and
// TABLE SCHEMA into a new, separate service. It deliberately did NOT
// touch any existing deployment's actual DATA — the old homecore/ code
// kept serving real traffic, unchanged, right up through Phase 4, exactly
// per the plan's own "don't delete until the commit that flips the
// switch" rule.
//
// Phase 5 flips that switch: the gateway and every frontend now point at
// apps/homecloud-backend instead of homecore for file operations. For a
// FRESH install with no existing files, that's the whole story. For any
// deployment that already has real uploaded files sitting in HomeCore's
// old `homecloud_data` volume, flipping the switch without this script
// would make every one of those files silently vanish from view — not
// deleted, just orphaned: the bytes and the database rows describing them
// would still sit right there on disk, simply no longer read by anything.
// That is exactly the kind of quiet, hard-to-notice data loss this
// project's whole `VERSIONING.md`/`CHANGELOG.md` discipline exists to
// prevent, so it gets a real, tested script instead of a one-line warning
// in a doc nobody reads before upgrading.
//
// WHAT IT DOES
// -----------------------------------------
// 1. Copies every row from the old `files`, `folders`, and `shares`
//    tables into the new database — same schema (Phase 2 copied it
//    verbatim), same row ids preserved exactly, so every foreign key
//    (folders.parent_id, shares.file_id) and every reference a client
//    might have cached (a bookmarked file id, an already-sent share link)
//    keeps working identically.
// 2. Copies (never moves or deletes) the old `uploads/` directory tree
//    into the new data directory. COPY, not move: the old volume is left
//    completely untouched, so it works as its own rollback path if
//    anything looks wrong afterward, at the cost of temporarily using
//    roughly double the disk space until you're confident enough to
//    reclaim the old volume yourself (a separate, manual, deliberate step
//    — this script never deletes anything from the source).
//
// SAFETY
// -----------------------------------------
// - Idempotent by refusal: if the destination database already has ANY
//   rows in files/folders/shares, this script does nothing and exits
//   with an error, rather than risk duplicating data. Safe to run twice
//   by accident; not designed to be run twice on purpose.
// - Must be run with both the old and new services stopped. SQLite files
//   being written to by a live server while this reads them is not a
//   supported case — same rule SETUP.md's own restore instructions
//   already follow ("docker compose down" first).
//
// USAGE
// -----------------------------------------
//   LEGACY_DATA_DIR=/path/to/old/homecore/data \
//   DATA_DIR=/path/to/new/homecloud-backend/data \
//   node scripts/migrate-legacy-homecloud-data.js
//
// In Docker Compose terms, both these paths are volume mounts — see
// docs/SETUP.md's "Upgrading an existing install past v0.9.0" section for
// the exact `docker compose run` invocation using the real named volumes.

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function fail(message) {
  console.error(`[migrate] ERROR: ${message}`);
  process.exit(1);
}

const legacyDataDir = process.env.LEGACY_DATA_DIR;
const newDataDir = process.env.DATA_DIR;

if (!legacyDataDir || !newDataDir) {
  fail("Both LEGACY_DATA_DIR and DATA_DIR must be set. See this file's header comment for usage.");
}

const legacyDbPath = path.join(legacyDataDir, "homecloud.db");
const newDbPath = path.join(newDataDir, "homecloud.db");
const legacyUploadsDir = path.join(legacyDataDir, "uploads");
const newUploadsDir = path.join(newDataDir, "uploads");

if (!fs.existsSync(legacyDbPath)) {
  fail(`No database found at ${legacyDbPath} — is LEGACY_DATA_DIR pointing at the right volume?`);
}
if (!fs.existsSync(newDbPath)) {
  fail(
    `No database found at ${newDbPath} — start apps/homecloud-backend at least once first ` +
      `(it creates its own empty database and tables on first boot), then stop it and run this again.`
  );
}

const legacyDb = new Database(legacyDbPath, { readonly: true });
const newDb = new Database(newDbPath);

function countRows(db, table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

// Refuse to run against a destination that already has data — see this
// file's header comment on idempotency-by-refusal.
for (const table of ["files", "folders", "shares"]) {
  const existing = countRows(newDb, table);
  if (existing > 0) {
    fail(
      `Destination database already has ${existing} row(s) in '${table}'. ` +
        `This looks like it's already been migrated (or was never empty). ` +
        `Refusing to run — see this file's header comment.`
    );
  }
}

const legacyCounts = {
  files: countRows(legacyDb, "files"),
  folders: countRows(legacyDb, "folders"),
  shares: countRows(legacyDb, "shares")
};

console.log(
  `[migrate] Found ${legacyCounts.folders} folder(s), ${legacyCounts.files} file row(s), ` +
    `${legacyCounts.shares} share(s) in the legacy database.`
);

if (legacyCounts.files === 0 && legacyCounts.folders === 0 && legacyCounts.shares === 0) {
  console.log("[migrate] Nothing to migrate — legacy database is empty. Exiting without changes.");
  process.exit(0);
}

// Copy table rows. Order matters: folders before files (files.folder_id
// references folders.id) and files before shares (shares.file_id
// references files.id) — even though the foreign keys themselves can't be
// enforced across two separate database files (see apps/homecloud-backend/
// src/db.js's comment on the same point from Phase 2), inserting in
// dependency order keeps every reference meaningful from the moment
// each row lands, rather than briefly pointing at nothing.
const migration = newDb.transaction(() => {
  const folderRows = legacyDb.prepare("SELECT * FROM folders").all();
  const insertFolder = newDb.prepare(
    "INSERT INTO folders (id, user_id, parent_id, name, created_at) VALUES (@id, @user_id, @parent_id, @name, @created_at)"
  );
  for (const row of folderRows) insertFolder.run(row);

  const fileRows = legacyDb.prepare("SELECT * FROM files").all();
  const insertFile = newDb.prepare(
    `INSERT INTO files (id, user_id, original_name, stored_name, size, mimetype, folder_id, thumbnail_name, deleted_at, created_at)
     VALUES (@id, @user_id, @original_name, @stored_name, @size, @mimetype, @folder_id, @thumbnail_name, @deleted_at, @created_at)`
  );
  for (const row of fileRows) insertFile.run(row);

  const shareRows = legacyDb.prepare("SELECT * FROM shares").all();
  const insertShare = newDb.prepare(
    `INSERT INTO shares (id, file_id, token, created_by, expires_at, revoked_at, created_at)
     VALUES (@id, @file_id, @token, @created_by, @expires_at, @revoked_at, @created_at)`
  );
  for (const row of shareRows) insertShare.run(row);

  return { folders: folderRows.length, files: fileRows.length, shares: shareRows.length };
});

const migrated = migration();
console.log(
  `[migrate] Copied ${migrated.folders} folder(s), ${migrated.files} file row(s), ${migrated.shares} share(s) into the new database.`
);

legacyDb.close();
newDb.close();

// Copy the actual file bytes. Recursive, preserves the exact
// uploads/<user_id>/<stored_name> layout Phase 2 kept identical to the
// original on purpose (see this file's header comment) — nothing here
// needs to know or care about individual filenames.
if (fs.existsSync(legacyUploadsDir)) {
  console.log(`[migrate] Copying uploaded file bytes from ${legacyUploadsDir} to ${newUploadsDir}...`);
  fs.cpSync(legacyUploadsDir, newUploadsDir, { recursive: true });
  console.log("[migrate] File copy complete.");
} else {
  console.log("[migrate] No legacy uploads/ directory found — nothing to copy (database rows migrated regardless).");
}

console.log(
  "\n[migrate] Done. The OLD data at LEGACY_DATA_DIR was left completely untouched — verify the new " +
    "setup works before reclaiming that volume's disk space yourself, as a separate, manual step."
);
