const express = require("express");
const multer = require("multer");
const { db } = require("./db");
const { asyncHandler } = require("./asyncHandler");
const { fileExists, uploadFile } = require("./homecloudClient");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

// A new snapshot is only taken if enough time has passed since the last
// one (or there isn't one yet) — otherwise autosave (which calls the same
// PATCH endpoint every few seconds while someone types) would create a
// version row per keystroke-pause instead of a handful of meaningful
// checkpoints per editing session.
const VERSION_SNAPSHOT_MIN_INTERVAL_MINUTES = 5;

function excerpt(content, length = 160) {
  const plain = content.replace(/[#*_`>[\]()~-]/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > length ? `${plain.slice(0, length)}…` : plain;
}

function serializeNoteSummary(row) {
  return {
    id: row.id,
    title: row.title,
    excerpt: excerpt(row.content),
    folderId: row.folder_id,
    isFavorite: Boolean(row.is_favorite),
    tags: row.tags ? row.tags.split(",") : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeNoteDetail(row) {
  const attachments = db
    .prepare("SELECT homecloud_file_id AS fileId, name, added_at AS addedAt FROM note_attachments WHERE note_id = ?")
    .all(row.id);
  const tags = db
    .prepare(`SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ? ORDER BY t.name COLLATE NOCASE`)
    .all(row.id)
    .map((t) => t.name);

  return {
    id: row.id,
    title: row.title,
    content: row.content,
    folderId: row.folder_id,
    isFavorite: Boolean(row.is_favorite),
    tags,
    attachments,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function setTags(noteId, userId, tagNames) {
  db.prepare("DELETE FROM note_tags WHERE note_id = ?").run(noteId);
  const findTag = db.prepare("SELECT id FROM tags WHERE user_id = ? AND name = ? COLLATE NOCASE");
  const insertTag = db.prepare("INSERT INTO tags (user_id, name) VALUES (?, ?)");
  const linkTag = db.prepare("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)");

  const seen = new Set();
  for (const raw of tagNames) {
    const name = String(raw).trim();
    if (!name || name.length > 40 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    let tag = findTag.get(userId, name);
    if (!tag) {
      const info = insertTag.run(userId, name);
      tag = { id: info.lastInsertRowid };
    }
    linkTag.run(noteId, tag.id);
  }
}

function maybeSnapshotVersion(note) {
  const latest = db
    .prepare("SELECT created_at FROM note_versions WHERE note_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(note.id);

  const shouldSnapshot =
    !latest ||
    Date.now() - new Date(`${latest.created_at}Z`).getTime() > VERSION_SNAPSHOT_MIN_INTERVAL_MINUTES * 60 * 1000;

  if (shouldSnapshot) {
    db.prepare("INSERT INTO note_versions (note_id, title, content) VALUES (?, ?, ?)").run(note.id, note.title, note.content);
  }
}

// GET /notes?folderId=&tag=&favorite=true&search=
router.get(
  "/notes",
  asyncHandler(async (req, res) => {
    let sql = `
      SELECT n.*, (SELECT GROUP_CONCAT(t.name) FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = n.id) AS tags
      FROM notes n
      WHERE n.user_id = ? AND n.deleted_at IS NULL
    `;
    const params = [req.user.id];

    if (req.query.folderId !== undefined) {
      const folderId = Number(req.query.folderId);
      const folder = db.prepare("SELECT id FROM note_folders WHERE id = ? AND user_id = ?").get(folderId, req.user.id);
      if (!folder) return res.status(404).json({ error: "Folder not found." });
      sql += " AND n.folder_id = ?";
      params.push(folderId);
    }
    if (req.query.favorite === "true") {
      sql += " AND n.is_favorite = 1";
    }
    if (req.query.tag) {
      sql += ` AND n.id IN (SELECT nt.note_id FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE t.user_id = ? AND t.name = ? COLLATE NOCASE)`;
      params.push(req.user.id, req.query.tag);
    }
    if (req.query.search) {
      sql += " AND (n.title LIKE ? OR n.content LIKE ?)";
      const like = `%${req.query.search}%`;
      params.push(like, like);
    }
    sql += " ORDER BY n.updated_at DESC LIMIT 200";

    const rows = db.prepare(sql).all(...params);
    res.json({ notes: rows.map(serializeNoteSummary) });
  })
);

router.get(
  "/notes/trash",
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT n.*, NULL AS tags FROM notes n WHERE n.user_id = ? AND n.deleted_at IS NOT NULL ORDER BY n.deleted_at DESC`
      )
      .all(req.user.id);
    res.json({ notes: rows.map(serializeNoteSummary) });
  })
);

router.get(
  "/notes/:id",
  asyncHandler(async (req, res) => {
    const note = db.prepare("SELECT * FROM notes WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!note) return res.status(404).json({ error: "Note not found." });
    res.json({ note: serializeNoteDetail(note) });
  })
);

router.post(
  "/notes",
  asyncHandler(async (req, res) => {
    const title = (req.body?.title || "Untitled").toString().trim().slice(0, 200) || "Untitled";
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    const folderId = req.body?.folderId ?? null;

    if (folderId !== null) {
      const folder = db.prepare("SELECT id FROM note_folders WHERE id = ? AND user_id = ?").get(folderId, req.user.id);
      if (!folder) return res.status(404).json({ error: "Folder not found." });
    }

    const info = db
      .prepare("INSERT INTO notes (user_id, folder_id, title, content) VALUES (?, ?, ?, ?)")
      .run(req.user.id, folderId, title, content);

    if (Array.isArray(req.body?.tags)) setTags(info.lastInsertRowid, req.user.id, req.body.tags);

    const note = db.prepare("SELECT * FROM notes WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json({ note: serializeNoteDetail(note) });
  })
);

// The autosave endpoint — the editor calls this on a debounce while
// someone types, so it accepts any subset of fields and only touches
// what's actually provided.
router.patch(
  "/notes/:id",
  asyncHandler(async (req, res) => {
    const note = db
      .prepare("SELECT * FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
      .get(req.params.id, req.user.id);
    if (!note) return res.status(404).json({ error: "Note not found." });

    if (req.body?.folderId !== undefined && req.body.folderId !== null) {
      const folder = db.prepare("SELECT id FROM note_folders WHERE id = ? AND user_id = ?").get(req.body.folderId, req.user.id);
      if (!folder) return res.status(404).json({ error: "Folder not found." });
    }

    const contentChanging = req.body?.content !== undefined && req.body.content !== note.content;
    const titleChanging = req.body?.title !== undefined && req.body.title !== note.title;
    if (contentChanging || titleChanging) {
      maybeSnapshotVersion(note);
    }

    const nextTitle = req.body?.title !== undefined ? String(req.body.title).trim().slice(0, 200) || "Untitled" : note.title;
    const nextContent = req.body?.content !== undefined ? String(req.body.content) : note.content;
    const nextFolderId = req.body?.folderId !== undefined ? req.body.folderId : note.folder_id;
    const nextFavorite = req.body?.isFavorite !== undefined ? (req.body.isFavorite ? 1 : 0) : note.is_favorite;

    db.prepare(
      "UPDATE notes SET title = ?, content = ?, folder_id = ?, is_favorite = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(nextTitle, nextContent, nextFolderId, nextFavorite, note.id);

    if (Array.isArray(req.body?.tags)) setTags(note.id, req.user.id, req.body.tags);

    const updated = db.prepare("SELECT * FROM notes WHERE id = ?").get(note.id);
    res.json({ note: serializeNoteDetail(updated) });
  })
);

router.delete(
  "/notes/:id",
  asyncHandler(async (req, res) => {
    const note = db
      .prepare("SELECT id FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
      .get(req.params.id, req.user.id);
    if (!note) return res.status(404).json({ error: "Note not found." });
    db.prepare("UPDATE notes SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(note.id);
    res.json({ ok: true });
  })
);

router.post(
  "/notes/:id/restore",
  asyncHandler(async (req, res) => {
    const note = db
      .prepare("SELECT id FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL")
      .get(req.params.id, req.user.id);
    if (!note) return res.status(404).json({ error: "Note not found in trash." });
    db.prepare("UPDATE notes SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?").run(note.id);
    res.json({ ok: true });
  })
);

router.delete(
  "/notes/:id/permanent",
  asyncHandler(async (req, res) => {
    const note = db.prepare("SELECT id FROM notes WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!note) return res.status(404).json({ error: "Note not found." });
    db.prepare("DELETE FROM note_versions WHERE note_id = ?").run(note.id);
    db.prepare("DELETE FROM note_tags WHERE note_id = ?").run(note.id);
    db.prepare("DELETE FROM note_attachments WHERE note_id = ?").run(note.id);
    db.prepare("DELETE FROM notes WHERE id = ?").run(note.id);
    res.json({ ok: true });
  })
);

router.get(
  "/notes/:id/versions",
  asyncHandler(async (req, res) => {
    const note = db.prepare("SELECT id FROM notes WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!note) return res.status(404).json({ error: "Note not found." });
    const versions = db
      .prepare("SELECT id, title, content, created_at AS createdAt FROM note_versions WHERE note_id = ? ORDER BY created_at DESC")
      .all(note.id);
    res.json({ versions });
  })
);

router.post(
  "/notes/:id/versions/:versionId/restore",
  asyncHandler(async (req, res) => {
    const note = db
      .prepare("SELECT * FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
      .get(req.params.id, req.user.id);
    if (!note) return res.status(404).json({ error: "Note not found." });
    const version = db.prepare("SELECT * FROM note_versions WHERE id = ? AND note_id = ?").get(req.params.versionId, note.id);
    if (!version) return res.status(404).json({ error: "Version not found." });

    // Snapshot the current (about-to-be-overwritten) state unconditionally
    // — restoring a version is exactly the moment you most don't want to
    // silently lose whatever was there before, regardless of the usual
    // debounce interval.
    db.prepare("INSERT INTO note_versions (note_id, title, content) VALUES (?, ?, ?)").run(note.id, note.title, note.content);
    db.prepare("UPDATE notes SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?").run(
      version.title,
      version.content,
      note.id
    );

    const updated = db.prepare("SELECT * FROM notes WHERE id = ?").get(note.id);
    res.json({ note: serializeNoteDetail(updated) });
  })
);

router.get(
  "/tags",
  asyncHandler(async (req, res) => {
    const tags = db
      .prepare(
        `SELECT t.id, t.name, COUNT(nt.note_id) AS noteCount
         FROM tags t
         LEFT JOIN note_tags nt ON nt.tag_id = t.id
         LEFT JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
         WHERE t.user_id = ?
         GROUP BY t.id
         ORDER BY t.name COLLATE NOCASE`
      )
      .all(req.user.id);
    res.json({ tags });
  })
);

// Uploads a brand-new attachment straight through to HomeCloud.
router.post(
  "/notes/:id/attachments",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const note = db.prepare("SELECT id FROM notes WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!note) return res.status(404).json({ error: "Note not found." });
    if (!req.file) return res.status(400).json({ error: "No file was attached." });

    const file = await uploadFile(req.token, {
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimetype: req.file.mimetype
    });

    db.prepare("INSERT OR IGNORE INTO note_attachments (note_id, homecloud_file_id, name) VALUES (?, ?, ?)").run(
      note.id,
      file.id,
      file.name
    );
    res.status(201).json({ fileId: file.id, name: file.name, size: file.size });
  })
);

// Links a file that already exists in HomeCloud (e.g. a photo already
// backed up by HomeSync) without re-uploading it — same idea as
// HomeMedia's "add existing photos to an album" picker.
router.post(
  "/notes/:id/attachments/link",
  asyncHandler(async (req, res) => {
    const note = db.prepare("SELECT id FROM notes WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!note) return res.status(404).json({ error: "Note not found." });

    const fileId = Number(req.body?.fileId);
    const name = req.body?.name;
    if (!Number.isInteger(fileId) || !name) return res.status(400).json({ error: "fileId and name are required." });
    if (!(await fileExists(req.token, fileId))) return res.status(404).json({ error: "That file doesn't exist in HomeCloud." });

    db.prepare("INSERT OR IGNORE INTO note_attachments (note_id, homecloud_file_id, name) VALUES (?, ?, ?)").run(
      note.id,
      fileId,
      name
    );
    res.status(201).json({ fileId, name });
  })
);

// Only removes the reference — the underlying HomeCloud file is
// untouched, same principle as removing a photo from a HomeMedia album.
router.delete(
  "/notes/:id/attachments/:fileId",
  asyncHandler(async (req, res) => {
    const note = db.prepare("SELECT id FROM notes WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!note) return res.status(404).json({ error: "Note not found." });
    db.prepare("DELETE FROM note_attachments WHERE note_id = ? AND homecloud_file_id = ?").run(note.id, req.params.fileId);
    res.json({ ok: true });
  })
);

module.exports = router;
