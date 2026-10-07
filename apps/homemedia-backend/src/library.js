const fs = require("fs");
const express = require("express");
const sharp = require("sharp");
const exifr = require("exifr");
const { db, thumbnailPath } = require("./db");
const { asyncHandler } = require("./asyncHandler");
const { listMediaFiles, downloadFile } = require("./homecloudClient");
const { KINDS, kindOfFile } = require("./mediaKinds");

const router = express.Router();

// Larger than HomeCloud's own 320px file-manager row icon — sized for a
// gallery grid tile or lightbox filmstrip, not a table row.
const THUMBNAIL_SIZE = 640;

// Keeps only the fields actually meaningful for "EXIF display" (camera,
// lens, exposure, capture date, dimensions, GPS if present) rather than
// forwarding exifr's full raw output, which can include an embedded
// preview thumbnail and maker-specific noise nobody asked to see.
function sanitizeExif(raw) {
  const KEYS = [
    "Make", "Model", "LensModel", "FNumber", "ExposureTime", "ISO",
    "FocalLength", "DateTimeOriginal", "ImageWidth", "ImageHeight", "Orientation"
  ];
  const out = {};
  for (const key of KEYS) {
    if (raw[key] !== undefined && raw[key] !== null) out[key] = raw[key];
  }
  if (typeof raw.latitude === "number" && typeof raw.longitude === "number") {
    out.gps = { latitude: raw.latitude, longitude: raw.longitude };
  }
  return Object.keys(out).length > 0 ? out : null;
}

// GET /library?type=image|video|audio&search=&favorite=true&albumId=N
// Flat, sorted (newest first) list — timeline grouping is a presentation
// concern the frontend handles, not something baked into this response.
router.get(
  "/library",
  asyncHandler(async (req, res) => {
    const wantType = req.query.type;
    if (wantType && !KINDS.includes(wantType)) {
      return res.status(400).json({ error: "type must be 'image', 'video' or 'audio'." });
    }

    // Always fetch everything and filter afterwards: a type filter has to
    // be applied to HomeMedia's own `kind` (which also understands files
    // HomeCloud labelled "application/octet-stream"), not to HomeCloud's
    // raw mimetype buckets.
    let files = await listMediaFiles(req.token);
    if (wantType) files = files.filter((f) => f.kind === wantType);

    const favoriteIds = new Set(
      db.prepare("SELECT file_id FROM favorites WHERE user_id = ?").all(req.user.id).map((r) => r.file_id)
    );

    if (req.query.albumId !== undefined) {
      const albumId = Number(req.query.albumId);
      const album = db.prepare("SELECT id FROM albums WHERE id = ? AND user_id = ?").get(albumId, req.user.id);
      if (!album) return res.status(404).json({ error: "Album not found." });
      const albumFileIds = new Set(
        db.prepare("SELECT file_id FROM album_items WHERE album_id = ?").all(albumId).map((r) => r.file_id)
      );
      files = files.filter((f) => albumFileIds.has(f.id));
    }

    if (req.query.favorite === "true") {
      files = files.filter((f) => favoriteIds.has(f.id));
    }

    if (req.query.search) {
      const q = String(req.query.search).toLowerCase();
      files = files.filter((f) => f.name.toLowerCase().includes(q));
    }

    files.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ files: files.map((f) => ({ ...f, favorited: favoriteIds.has(f.id) })) });
  })
);

// GET /:fileId/exif — cached after first request. A file with no EXIF
// data (a screenshot, a re-saved PNG, a video) isn't an error — it just
// comes back as { exif: null }.
router.get(
  "/:fileId/exif",
  asyncHandler(async (req, res) => {
    const fileId = Number(req.params.fileId);
    if (!Number.isInteger(fileId)) return res.status(400).json({ error: "Invalid file id." });

    const cached = db
      .prepare("SELECT exif_json FROM media_index WHERE file_id = ? AND user_id = ?")
      .get(fileId, req.user.id);
    if (cached) {
      return res.json({ exif: cached.exif_json ? JSON.parse(cached.exif_json) : null });
    }

    // Ownership is enforced transitively: HomeCloud's own download route
    // already scopes by user_id and 404s for anything not yours, so
    // there's nothing further to check here.
    const original = await downloadFile(req.token, fileId);
    if (!original) return res.status(404).json({ error: "File not found." });

    const kind = kindOfFile({ mimetype: original.contentType });
    // Only photos and videos are cached in media_index (its `kind` column
    // only allows those two). Music has no EXIF, so there is nothing worth
    // caching — answer straight away.
    if (kind === "audio") return res.json({ exif: null });
    let exif = null;
    if (kind === "image") {
      try {
        const raw = await exifr.parse(original.buffer, { gps: true, tiff: true, exif: true });
        exif = raw ? sanitizeExif(raw) : null;
      } catch {
        exif = null; // corrupt/unsupported EXIF block — nothing to show, not an error
      }
    }

    db.prepare(
      `INSERT INTO media_index (file_id, user_id, kind, exif_json) VALUES (?, ?, ?, ?)
       ON CONFLICT(file_id) DO UPDATE SET exif_json = excluded.exif_json, kind = excluded.kind`
    ).run(fileId, req.user.id, kind || "image", exif ? JSON.stringify(exif) : null);

    res.json({ exif });
  })
);

// GET /:fileId/thumbnail — HomeMedia's own, larger, gallery-quality
// thumbnail, generated once and cached on disk (§12: "generate
// application-specific indexes/thumbnails only when needed" — not on
// every upload, since not everything uploaded to HomeCloud ever gets
// looked at here).
router.get(
  "/:fileId/thumbnail",
  asyncHandler(async (req, res) => {
    const fileId = Number(req.params.fileId);
    if (!Number.isInteger(fileId)) return res.status(400).json({ error: "Invalid file id." });

    const cachePath = thumbnailPath(req.user.id, fileId);
    if (fs.existsSync(cachePath)) {
      return res.type("image/jpeg").sendFile(cachePath);
    }

    const original = await downloadFile(req.token, fileId);
    if (!original) return res.status(404).json({ error: "File not found." });

    if (kindOfFile({ mimetype: original.contentType }) !== "image") {
      // A real poster frame for video needs a decoder this service
      // deliberately doesn't carry (see README's HomeMedia section) — the
      // frontend shows a generic video/music tile instead of a real preview.
      return res.status(404).json({ error: "No thumbnail available for this file." });
    }

    try {
      const buffer = await sharp(original.buffer)
        .rotate() // respect EXIF orientation, same as HomeCloud's own thumbnailer
        .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      fs.writeFileSync(cachePath, buffer);
      res.type("image/jpeg").send(buffer);
    } catch {
      res.status(422).json({ error: "Couldn't generate a thumbnail for this file." });
    }
  })
);

module.exports = router;
