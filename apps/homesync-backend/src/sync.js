const express = require("express");
const multer = require("multer");
const { db } = require("./db");
const { asyncHandler } = require("./asyncHandler");
const { resolveFolderPath, uploadFile } = require("./homecloudClient");
const { buildPathSegments } = require("./pathPlanner");

const router = express.Router();

// Buffered in memory, then forwarded straight to HomeCloud's own upload
// endpoint (see homecloudClient.js) — HomeSync never writes a file to its
// own disk. The generous limit exists for 4K video; HomeCloud's own quota
// check is the real backstop against someone actually filling the disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

const VALID_CATEGORIES = ["Photos", "Videos", "Screenshots", "Downloads"];

// POST /check — { files: [{ hash, size }] } → which of these the app can
// skip uploading because HomeSync already has them (from this device or
// any other belonging to the same person). Meant to run before a backup
// pass starts, over Wi-Fi, on a whole batch at once — not so the app has
// to make a round trip per photo just to ask "do you have this one?".
router.post(
  "/check",
  asyncHandler(async (req, res) => {
    const files = req.body?.files;
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "files must be a non-empty array." });
    }
    if (files.length > 500) {
      return res.status(400).json({ error: "Check at most 500 files at a time." });
    }
    if (!files.every((f) => f && typeof f.hash === "string" && f.hash.length > 0)) {
      return res.status(400).json({ error: "Each entry needs a non-empty hash." });
    }

    const stmt = db.prepare("SELECT 1 FROM synced_files WHERE user_id = ? AND content_hash = ?");
    const results = files.map((f) => ({ hash: f.hash, alreadySynced: Boolean(stmt.get(req.user.id, f.hash)) }));
    res.json({ results });
  })
);

// POST /upload — multipart: file + { deviceId, category, contentHash, capturedAt? }
router.post(
  "/upload",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file was attached." });

    const { deviceId, category, contentHash, capturedAt } = req.body;

    const device = deviceId && db.prepare("SELECT id FROM devices WHERE id = ? AND user_id = ?").get(deviceId, req.user.id);
    if (!device) return res.status(400).json({ error: "Unknown device — register it first with POST /devices." });

    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(", ")}` });
    }
    if (!contentHash) return res.status(400).json({ error: "contentHash is required." });

    db.prepare("UPDATE devices SET last_seen_at = datetime('now') WHERE id = ?").run(device.id);

    // Idempotent: checked here too, not just via /check, in case the
    // client skipped that step or two uploads of the same photo raced —
    // either way, never store a second copy of something already synced.
    const existing = db
      .prepare("SELECT * FROM synced_files WHERE user_id = ? AND content_hash = ?")
      .get(req.user.id, contentHash);
    if (existing) {
      return res.json({ deduped: true, homecloudFileId: existing.homecloud_file_id });
    }

    const segments = buildPathSegments(category, capturedAt);
    const folderId = await resolveFolderPath(req.token, req.user.id, segments);

    const file = await uploadFile(req.token, {
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      folderId
    });

    db.prepare(
      `INSERT INTO synced_files (user_id, device_id, content_hash, homecloud_file_id, category, size)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(req.user.id, device.id, contentHash, file.id, category, file.size);

    res.status(201).json({ deduped: false, homecloudFileId: file.id, folderId });
  })
);

// GET /history — recent backed-up files across all of this person's
// devices, plus the summary totals the app's "Last backup" card needs.
router.get(
  "/history",
  asyncHandler(async (req, res) => {
    const recent = db
      .prepare(
        `SELECT sf.*, d.name AS device_name FROM synced_files sf
         JOIN devices d ON d.id = sf.device_id
         WHERE sf.user_id = ? ORDER BY sf.synced_at DESC LIMIT 100`
      )
      .all(req.user.id);

    const totals = db
      .prepare(
        `SELECT COUNT(*) AS fileCount, COALESCE(SUM(size), 0) AS totalBytes, MAX(synced_at) AS lastSyncedAt
         FROM synced_files WHERE user_id = ?`
      )
      .get(req.user.id);

    res.json({
      files: recent.map((r) => ({
        id: r.id,
        deviceName: r.device_name,
        category: r.category,
        size: r.size,
        homecloudFileId: r.homecloud_file_id,
        syncedAt: r.synced_at
      })),
      summary: { fileCount: totals.fileCount, totalBytes: totals.totalBytes, lastSyncedAt: totals.lastSyncedAt }
    });
  })
);

module.exports = router;
