const express = require("express");
const { db } = require("./db");
const { asyncHandler } = require("./asyncHandler");
const { fileExists } = require("./homecloudClient");

const router = express.Router();

function albumSummary(album) {
  const itemCount = db.prepare("SELECT COUNT(*) AS n FROM album_items WHERE album_id = ?").get(album.id).n;
  return {
    id: album.id,
    name: album.name,
    coverFileId: album.cover_file_id,
    itemCount,
    createdAt: album.created_at,
    updatedAt: album.updated_at
  };
}

router.get(
  "/albums",
  asyncHandler(async (req, res) => {
    const albums = db.prepare("SELECT * FROM albums WHERE user_id = ? ORDER BY updated_at DESC").all(req.user.id);
    res.json({ albums: albums.map(albumSummary) });
  })
);

router.post(
  "/albums",
  asyncHandler(async (req, res) => {
    const name = (req.body?.name || "").trim();
    if (!name || name.length > 100) {
      return res.status(400).json({ error: "Album name must be 1-100 characters." });
    }
    const info = db
      .prepare("INSERT INTO albums (user_id, name) VALUES (?, ?)")
      .run(req.user.id, name);
    const album = db.prepare("SELECT * FROM albums WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json({ album: albumSummary(album) });
  })
);

router.get(
  "/albums/:id",
  asyncHandler(async (req, res) => {
    const album = db.prepare("SELECT * FROM albums WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!album) return res.status(404).json({ error: "Album not found." });
    res.json({ album: albumSummary(album) });
  })
);

router.patch(
  "/albums/:id",
  asyncHandler(async (req, res) => {
    const album = db.prepare("SELECT * FROM albums WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!album) return res.status(404).json({ error: "Album not found." });

    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name || name.length > 100) return res.status(400).json({ error: "Album name must be 1-100 characters." });
      db.prepare("UPDATE albums SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, album.id);
    }
    if (req.body?.coverFileId !== undefined) {
      if (req.body.coverFileId !== null) {
        const inAlbum = db
          .prepare("SELECT 1 FROM album_items WHERE album_id = ? AND file_id = ?")
          .get(album.id, req.body.coverFileId);
        if (!inAlbum) return res.status(400).json({ error: "Cover photo must already be in this album." });
      }
      db.prepare("UPDATE albums SET cover_file_id = ?, updated_at = datetime('now') WHERE id = ?").run(
        req.body.coverFileId,
        album.id
      );
    }

    const updated = db.prepare("SELECT * FROM albums WHERE id = ?").get(album.id);
    res.json({ album: albumSummary(updated) });
  })
);

router.delete(
  "/albums/:id",
  asyncHandler(async (req, res) => {
    const album = db.prepare("SELECT id FROM albums WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!album) return res.status(404).json({ error: "Album not found." });
    // Only the album (an organizational grouping) is removed — the
    // underlying HomeCloud files it referenced are completely untouched.
    db.prepare("DELETE FROM album_items WHERE album_id = ?").run(album.id);
    db.prepare("DELETE FROM albums WHERE id = ?").run(album.id);
    res.json({ ok: true });
  })
);

router.post(
  "/albums/:id/items",
  asyncHandler(async (req, res) => {
    const album = db.prepare("SELECT id FROM albums WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!album) return res.status(404).json({ error: "Album not found." });

    const fileIds = req.body?.fileIds;
    if (!Array.isArray(fileIds) || fileIds.length === 0 || !fileIds.every(Number.isInteger)) {
      return res.status(400).json({ error: "fileIds must be a non-empty array of integers." });
    }
    if (fileIds.length > 200) {
      return res.status(400).json({ error: "Add at most 200 photos at a time." });
    }

    const insert = db.prepare("INSERT OR IGNORE INTO album_items (album_id, file_id) VALUES (?, ?)");
    let added = 0;
    for (const fileId of fileIds) {
      // eslint-disable-next-line no-await-in-loop -- each check is a cheap, independent HTTP call; sequential keeps error handling simple for what's normally a handful of ids
      if (await fileExists(req.token, fileId)) {
        added += insert.run(album.id, fileId).changes;
      }
    }
    db.prepare("UPDATE albums SET updated_at = datetime('now') WHERE id = ?").run(album.id);
    res.json({ added });
  })
);

router.delete(
  "/albums/:id/items/:fileId",
  asyncHandler(async (req, res) => {
    const album = db.prepare("SELECT id FROM albums WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!album) return res.status(404).json({ error: "Album not found." });
    db.prepare("DELETE FROM album_items WHERE album_id = ? AND file_id = ?").run(album.id, req.params.fileId);
    // A removed cover photo can't keep being the cover of an album it's no longer in.
    db.prepare(
      "UPDATE albums SET cover_file_id = NULL, updated_at = datetime('now') WHERE id = ? AND cover_file_id = ?"
    ).run(album.id, req.params.fileId);
    res.json({ ok: true });
  })
);

router.post(
  "/favorites/:fileId",
  asyncHandler(async (req, res) => {
    const fileId = Number(req.params.fileId);
    if (!Number.isInteger(fileId)) return res.status(400).json({ error: "Invalid file id." });
    if (!(await fileExists(req.token, fileId))) return res.status(404).json({ error: "File not found." });

    db.prepare("INSERT OR IGNORE INTO favorites (user_id, file_id) VALUES (?, ?)").run(req.user.id, fileId);
    res.json({ favorited: true });
  })
);

router.delete(
  "/favorites/:fileId",
  asyncHandler(async (req, res) => {
    db.prepare("DELETE FROM favorites WHERE user_id = ? AND file_id = ?").run(req.user.id, req.params.fileId);
    res.json({ favorited: false });
  })
);

module.exports = router;
