// Deliberately mounted WITHOUT requireAuth in app.js (see that file) — a
// share link has to work for someone with no account at all, that's the
// entire point of it.
const fs = require("fs");
const path = require("path");
const express = require("express");
const { db, UPLOADS_DIR } = require("./db");
const { createRateLimiter } = require("./rateLimiter");

const router = express.Router();

// Share tokens are 24 random bytes (192 bits) — not realistically guessable
// — but this still caps how fast someone could scan for valid tokens.
const shareLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a bit and try again." }
});

router.get("/:token", shareLimiter, (req, res) => {
  const row = db
    .prepare(
      `SELECT s.*, f.original_name, f.stored_name, f.user_id, f.deleted_at AS fileDeletedAt,
              (s.expires_at IS NOT NULL AND s.expires_at <= datetime('now')) AS isExpired
       FROM shares s
       JOIN files f ON f.id = s.file_id
       WHERE s.token = ?`
    )
    .get(req.params.token);

  if (!row || row.revoked_at) {
    return res.status(404).json({ error: "This link is invalid or has been revoked." });
  }
  if (row.isExpired) {
    return res.status(404).json({ error: "This link has expired." });
  }
  // If the owner has moved the file to Trash, a share link to it shouldn't
  // keep working — that would let anyone who has the link keep downloading
  // a file the owner believes they've deleted. It picks back up on its own
  // if the file is restored, since nothing about the share itself changed.
  if (row.fileDeletedAt) {
    return res.status(404).json({ error: "This file is no longer available." });
  }

  const filePath = path.join(UPLOADS_DIR, String(row.user_id), row.stored_name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File is missing from storage." });
  }

  res.download(filePath, row.original_name);
});

module.exports = router;
