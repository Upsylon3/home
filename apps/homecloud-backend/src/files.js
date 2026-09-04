// File upload/list/download/trash/share/move routes. This service has no
// identity of its own, so requireAuth (from @home/homecore-client,
// delegating to HomeCore) is applied once, at mount time, in app.js —
// the same pattern HomeMedia/HomeSync/HomeNotes use.
//
// The per-user quota limit comes off `req.user.quotaOverride`, which
// requireAuth already populated from HomeCore's /api/auth/me response
// (there's no local `users` table here to query it from). Usage
// (`usedBytes`) is a local query against this service's own `files`
// table.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const yazl = require("yazl");
const sharp = require("sharp");
const { db, UPLOADS_DIR, logActivity } = require("./db");
const { buildBreadcrumb } = require("./folders");

const router = express.Router();

const TRASH_RETENTION_DAYS = Number(process.env.TRASH_RETENTION_DAYS || 30);
const THUMBNAIL_MIME_RE = /^image\/(jpeg|png|webp|gif|avif|bmp|tiff)$/i;
const THUMBNAIL_SIZE = 320;

function userDir(userId) {
  const dir = path.join(UPLOADS_DIR, String(userId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function usedBytes(userId) {
  // Trashed files still count against quota until they're purged or
  // permanently deleted — same behavior as most consumer cloud storage.
  const row = db
    .prepare("SELECT COALESCE(SUM(size), 0) AS used FROM files WHERE user_id = ?")
    .get(userId);
  return row.used;
}

// Was quotaBytes(userId), querying `users` directly — see this file's
// header comment. `user` here is req.user, the identity object
// requireAuth already fetched from HomeCore.
function quotaBytesFor(user) {
  return user.quotaOverride ?? Number(process.env.QUOTA_BYTES || 5 * 1024 ** 3);
}

function removeFromDisk(userId, storedName, thumbnailName) {
  fs.unlink(path.join(userDir(userId), storedName), () => {});
  if (thumbnailName) {
    fs.unlink(path.join(userDir(userId), thumbnailName), () => {});
  }
}

// Generates a small JPEG thumbnail for image uploads. Returns the
// thumbnail's filename on success, or null if this isn't an image type we
// thumbnail, or generation fails for any reason (corrupt file, unusual
// subformat, etc) — a missing thumbnail just means the frontend falls back
// to a generic file icon, never a failed upload.
async function generateThumbnail(userId, storedFilename, mimetype) {
  if (!THUMBNAIL_MIME_RE.test(mimetype)) return null;

  const base = path.basename(storedFilename, path.extname(storedFilename));
  const thumbnailName = `${base}_thumb.jpg`;
  const srcPath = path.join(userDir(userId), storedFilename);
  const destPath = path.join(userDir(userId), thumbnailName);

  try {
    await sharp(srcPath)
      .rotate() // respect EXIF orientation instead of thumbnailing sideways photos
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toFile(destPath);
    return thumbnailName;
  } catch (err) {
    console.error(`[homecloud-backend] thumbnail generation failed for ${storedFilename}:`, err.message);
    return null;
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, userDir(req.user.id)),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 } // hard ceiling of 1 GB per file
});

// New in this service — didn't exist in the original homecore/src/files.js
// HomeCore's own /api/auth/me has no way to compute usedBytes — the
// files table it would need lives entirely in this separate service and
// database. This route is the real source of truth for it;
// apps/homecloud's StorageGauge.jsx calls this, not /api/auth/me.
router.get("/quota", (req, res) => {
  res.json({ usedBytes: usedBytes(req.user.id), quotaBytes: quotaBytesFor(req.user) });
});

// List active (non-trashed) files inside a given folder (or the root,
// if folderId is omitted).
router.get("/", (req, res) => {
  const folderId = req.query.folderId ? Number(req.query.folderId) : null;

  if (folderId !== null) {
    const folder = db.prepare("SELECT id FROM folders WHERE id = ? AND user_id = ?").get(folderId, req.user.id);
    if (!folder) return res.status(404).json({ error: "Folder not found." });
  }

  const rows = db
    .prepare(
      `SELECT id, original_name AS name, size, mimetype, created_at AS createdAt,
              (thumbnail_name IS NOT NULL) AS hasThumbnail
       FROM files WHERE user_id = ? AND deleted_at IS NULL AND folder_id IS ?
       ORDER BY created_at DESC`
    )
    .all(req.user.id, folderId);

  const breadcrumb = folderId !== null ? buildBreadcrumb(folderId, req.user.id) : [];
  res.json({ files: rows.map((r) => ({ ...r, hasThumbnail: Boolean(r.hasThumbnail) })), breadcrumb });
});

// Flat, cross-folder listing of the user's own non-trashed files,
// optionally filtered by top-level mime type (e.g. "image", "video") —
// for other Home applications to discover what's here without walking
// the folder tree themselves (HOME_MASTER_SPECIFICATION.md §12/§14:
// "HomeMedia should reference HomeCloud-managed files"). This is still
// just "list my files" from HomeCloud's point of view, gated by the exact
// same requireAuth as every other route mounted alongside this one — no
// special-casing for which application happens to be calling it.
const ALL_FILES_TYPE_FILTERS = ["image", "video", "audio", "text", "application"];
const ALL_FILES_LIMIT = 5000; // a personal/family library sanity cap, not real pagination — see README

router.get("/all", (req, res) => {
  const type = req.query.type;
  if (type !== undefined && !ALL_FILES_TYPE_FILTERS.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${ALL_FILES_TYPE_FILTERS.join(", ")}` });
  }

  const rows = db
    .prepare(
      `SELECT id, original_name AS name, size, mimetype, folder_id AS folderId, created_at AS createdAt,
              (thumbnail_name IS NOT NULL) AS hasThumbnail
       FROM files
       WHERE user_id = ? AND deleted_at IS NULL
         AND (? IS NULL OR mimetype LIKE ? || '/%')
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(req.user.id, type ?? null, type ?? null, ALL_FILES_LIMIT + 1);

  const truncated = rows.length > ALL_FILES_LIMIT;
  if (truncated) rows.length = ALL_FILES_LIMIT;

  res.json({ files: rows.map((r) => ({ ...r, hasThumbnail: Boolean(r.hasThumbnail) })), truncated });
});

// List trashed files, most recently deleted first.
router.get("/trash", (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, original_name AS name, size, mimetype, created_at AS createdAt, deleted_at AS deletedAt,
              (thumbnail_name IS NOT NULL) AS hasThumbnail
       FROM files WHERE user_id = ? AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC`
    )
    .all(req.user.id);
  res.json({
    files: rows.map((r) => ({ ...r, hasThumbnail: Boolean(r.hasThumbnail) })),
    retentionDays: TRASH_RETENTION_DAYS
  });
});

// List every share link the current user has created (across all their
// files) that hasn't been revoked or expired, so they can find and manage
// them in one place instead of hunting file-by-file.
router.get("/shares", (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.id, s.token, s.expires_at AS expiresAt, s.created_at AS createdAt,
              f.id AS fileId, f.original_name AS fileName
       FROM shares s
       JOIN files f ON f.id = s.file_id
       WHERE s.created_by = ?
         AND s.revoked_at IS NULL
         AND f.deleted_at IS NULL
         AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))
       ORDER BY s.created_at DESC`
    )
    .all(req.user.id);
  res.json({ shares: rows });
});

router.post("/upload", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "File exceeds the 1 GB per-file limit." });
      }
      return res.status(400).json({ error: err.message || "Upload failed." });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file was attached to the request." });
    }

    try {
      let folderId = req.body?.folderId ? Number(req.body.folderId) : null;
      if (folderId !== null) {
        const folder = db.prepare("SELECT id FROM folders WHERE id = ? AND user_id = ?").get(folderId, req.user.id);
        if (!folder) {
          fs.unlink(req.file.path, () => {});
          return res.status(404).json({ error: "Destination folder not found." });
        }
      }

      // Thumbnail generation is the only `await` in this handler. Doing it
      // here, *before* the quota check, means the check-then-insert below
      // runs as one uninterrupted synchronous block (better-sqlite3 calls
      // never yield to the event loop) — so two uploads racing each other
      // can no longer both read "under quota" before either one's insert
      // actually lands. With the await positioned between the check and
      // the insert (as it originally was), that race was real.
      const thumbnailName = await generateThumbnail(req.user.id, req.file.filename, req.file.mimetype);

      const projectedUsage = usedBytes(req.user.id) + req.file.size;
      if (projectedUsage > quotaBytesFor(req.user)) {
        fs.unlink(req.file.path, () => {});
        if (thumbnailName) fs.unlink(path.join(userDir(req.user.id), thumbnailName), () => {});
        return res.status(413).json({ error: "This upload would exceed your storage quota." });
      }

      const info = db
        .prepare(
          `INSERT INTO files (user_id, original_name, stored_name, size, mimetype, folder_id, thumbnail_name)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          req.user.id,
          req.file.originalname,
          req.file.filename,
          req.file.size,
          req.file.mimetype,
          folderId,
          thumbnailName
        );

      logActivity(req.user.id, "upload", req.file.originalname);

      res.status(201).json({
        file: {
          id: info.lastInsertRowid,
          name: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
          createdAt: new Date().toISOString(),
          hasThumbnail: Boolean(thumbnailName)
        }
      });
    } catch (uploadErr) {
      console.error(uploadErr);
      fs.unlink(req.file.path, () => {});
      res.status(500).json({ error: "Upload failed." });
    }
  });
});

// Move a file into a different folder (or back to the root, if folderId
// is omitted/null).
router.post("/:id/move", (req, res) => {
  const row = db
    .prepare("SELECT id, original_name FROM files WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: "File not found." });

  let folderId = req.body?.folderId ? Number(req.body.folderId) : null;
  if (folderId !== null) {
    const folder = db.prepare("SELECT id FROM folders WHERE id = ? AND user_id = ?").get(folderId, req.user.id);
    if (!folder) return res.status(404).json({ error: "Destination folder not found." });
  }

  db.prepare("UPDATE files SET folder_id = ? WHERE id = ?").run(folderId, row.id);
  logActivity(req.user.id, "move", row.original_name);
  res.json({ ok: true });
});

// Download several files at once as a single zip archive. Files that don't
// belong to the requester (or don't exist) are silently skipped rather than
// failing the whole batch.
router.post("/download-batch", (req, res) => {
  const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (rawIds.length === 0) {
    return res.status(400).json({ error: "No file ids provided." });
  }
  if (rawIds.length > 500) {
    return res.status(400).json({ error: "Please select 500 files or fewer at a time." });
  }
  if (!rawIds.every((id) => Number.isInteger(id) && id > 0)) {
    return res.status(400).json({ error: "File ids must be positive whole numbers." });
  }
  const ids = rawIds;

  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT * FROM files WHERE id IN (${placeholders}) AND user_id = ? AND deleted_at IS NULL`
    )
    .all(...ids, req.user.id);

  if (rows.length === 0) {
    return res.status(404).json({ error: "None of the requested files were found." });
  }

  res.attachment("homecloud-files.zip");
  const zipfile = new yazl.ZipFile();
  zipfile.outputStream.on("error", (err) => {
    console.error(err);
    if (!res.headersSent) res.status(500);
    res.end();
  });
  zipfile.outputStream.pipe(res);

  // Guard against duplicate filenames landing in the same zip (e.g. two
  // files both named "photo.jpg") by disambiguating with a counter suffix.
  const seenNames = new Map();
  for (const row of rows) {
    let name = row.original_name;
    if (seenNames.has(name)) {
      const count = seenNames.get(name) + 1;
      seenNames.set(name, count);
      const ext = path.extname(name);
      const base = path.basename(name, ext);
      name = `${base} (${count})${ext}`;
    } else {
      seenNames.set(name, 0);
    }

    const filePath = path.join(userDir(req.user.id), row.stored_name);
    if (fs.existsSync(filePath)) {
      zipfile.addFile(filePath, name);
    }
  }

  logActivity(req.user.id, "download_batch", `${rows.length} file(s)`);
  zipfile.end();
});

router.get("/:id/download", (req, res) => {
  const row = db
    .prepare("SELECT * FROM files WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);

  if (!row) {
    return res.status(404).json({ error: "File not found." });
  }

  const filePath = path.join(userDir(req.user.id), row.stored_name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File is missing from storage." });
  }

  res.download(filePath, row.original_name);
});

// Serves the small generated preview image for a file, if it has one.
// Unlike /download, this has no Content-Disposition: attachment — it's
// meant to be displayed inline (e.g. in an <img> tag) rather than saved.
router.get("/:id/thumbnail", (req, res) => {
  const row = db
    .prepare("SELECT thumbnail_name FROM files WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.id);

  if (!row || !row.thumbnail_name) {
    return res.status(404).json({ error: "No thumbnail available." });
  }

  const thumbPath = path.join(userDir(req.user.id), row.thumbnail_name);
  if (!fs.existsSync(thumbPath)) {
    return res.status(404).json({ error: "Thumbnail is missing from storage." });
  }

  res.set("Cache-Control", "private, max-age=86400");
  res.type("jpeg").sendFile(thumbPath);
});

// Create a shareable link for a file. expiresInDays: a whole number of
// days (1-365), or 0/omitted for a link that never expires.
router.post("/:id/share", (req, res) => {
  const row = db
    .prepare("SELECT * FROM files WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
    .get(req.params.id, req.user.id);

  if (!row) {
    return res.status(404).json({ error: "File not found." });
  }

  const rawExpires = req.body?.expiresInDays;
  let expiresInDays = 0;
  if (rawExpires !== undefined && rawExpires !== null && rawExpires !== 0) {
    expiresInDays = Number(rawExpires);
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365) {
      return res.status(400).json({ error: "expiresInDays must be a whole number between 1 and 365, or 0 for no expiration." });
    }
  }

  const token = crypto.randomBytes(24).toString("base64url");

  const info = db
    .prepare(
      `INSERT INTO shares (file_id, token, created_by, expires_at)
       VALUES (?, ?, ?, ${expiresInDays > 0 ? "datetime('now', ?)" : "NULL"})`
    )
    .run(...(expiresInDays > 0 ? [row.id, token, req.user.id, `+${expiresInDays} days`] : [row.id, token, req.user.id]));

  logActivity(req.user.id, "share_create", row.original_name);

  const share = db.prepare("SELECT * FROM shares WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json({
    share: {
      id: share.id,
      token: share.token,
      fileName: row.original_name,
      expiresAt: share.expires_at,
      createdAt: share.created_at
    }
  });
});

// Revoke a share link. Note: this route is registered before the generic
// "/:id" routes further down would ever conflict, since "/shares/:shareId"
// is a distinct two-segment path.
router.delete("/shares/:shareId", (req, res) => {
  const row = db
    .prepare(
      `SELECT s.id, f.original_name FROM shares s
       JOIN files f ON f.id = s.file_id
       WHERE s.id = ? AND s.created_by = ?`
    )
    .get(req.params.shareId, req.user.id);

  if (!row) {
    return res.status(404).json({ error: "Share link not found." });
  }

  db.prepare("UPDATE shares SET revoked_at = datetime('now') WHERE id = ?").run(row.id);
  logActivity(req.user.id, "share_revoke", row.original_name);
  res.json({ ok: true });
});

// Move a file to trash (soft delete). It stays on disk and counts against
// quota, but disappears from the main file list, until it's restored,
// permanently deleted, or auto-purged after the retention window.
router.delete("/:id", (req, res) => {
  const row = db
    .prepare("SELECT id, original_name FROM files WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
    .get(req.params.id, req.user.id);

  if (!row) {
    return res.status(404).json({ error: "File not found." });
  }

  db.prepare("UPDATE files SET deleted_at = datetime('now') WHERE id = ?").run(row.id);
  logActivity(req.user.id, "delete", row.original_name);
  res.json({ ok: true });
});

// Bring a trashed file back to the main file list.
router.post("/:id/restore", (req, res) => {
  const row = db
    .prepare("SELECT id, original_name FROM files WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL")
    .get(req.params.id, req.user.id);

  if (!row) {
    return res.status(404).json({ error: "File not found in trash." });
  }

  db.prepare("UPDATE files SET deleted_at = NULL WHERE id = ?").run(row.id);
  logActivity(req.user.id, "restore", row.original_name);
  res.json({ ok: true });
});

// Permanently delete a trashed file right now, instead of waiting for it to
// auto-purge. This is the only route that actually removes bytes from disk
// and frees up quota.
router.delete("/:id/permanent", (req, res) => {
  const row = db
    .prepare("SELECT * FROM files WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL")
    .get(req.params.id, req.user.id);

  if (!row) {
    return res.status(404).json({ error: "File not found in trash." });
  }

  removeFromDisk(req.user.id, row.stored_name, row.thumbnail_name);
  db.prepare("DELETE FROM files WHERE id = ?").run(row.id);
  logActivity(req.user.id, "permanent_delete", row.original_name);
  res.json({ ok: true });
});

// Called on a timer from server.js. Anything sitting in trash longer than
// TRASH_RETENTION_DAYS gets permanently removed, so trash doesn't silently
// hold onto quota (or disk space) forever.
function purgeExpiredTrash() {
  const expired = db
    .prepare(
      `SELECT id, user_id, stored_name, thumbnail_name FROM files
       WHERE deleted_at IS NOT NULL
       AND deleted_at < datetime('now', ?)`
    )
    .all(`-${TRASH_RETENTION_DAYS} days`);

  for (const row of expired) {
    removeFromDisk(row.user_id, row.stored_name, row.thumbnail_name);
    db.prepare("DELETE FROM files WHERE id = ?").run(row.id);
  }

  if (expired.length > 0) {
    console.log(`[homecloud-backend] purged ${expired.length} expired trash item(s)`);
  }
  return expired.length;
}

module.exports = router;
module.exports.purgeExpiredTrash = purgeExpiredTrash;
