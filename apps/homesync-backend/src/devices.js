const express = require("express");
const { db } = require("./db");
const { asyncHandler } = require("./asyncHandler");

const router = express.Router();

const VALID_PLATFORMS = ["android", "ios", "other"];

function serializeDevice(d) {
  return { id: d.id, name: d.name, platform: d.platform, createdAt: d.created_at, lastSeenAt: d.last_seen_at };
}

router.post(
  "/devices",
  asyncHandler(async (req, res) => {
    const name = (req.body?.name || "").trim();
    if (!name || name.length > 100) {
      return res.status(400).json({ error: "Device name must be 1-100 characters." });
    }
    const platform = VALID_PLATFORMS.includes(req.body?.platform) ? req.body.platform : "android";

    const info = db
      .prepare("INSERT INTO devices (user_id, name, platform, last_seen_at) VALUES (?, ?, ?, datetime('now'))")
      .run(req.user.id, name, platform);
    const device = db.prepare("SELECT * FROM devices WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json({ device: serializeDevice(device) });
  })
);

router.get(
  "/devices",
  asyncHandler(async (req, res) => {
    const devices = db.prepare("SELECT * FROM devices WHERE user_id = ? ORDER BY created_at DESC").all(req.user.id);
    res.json({ devices: devices.map(serializeDevice) });
  })
);

router.delete(
  "/devices/:id",
  asyncHandler(async (req, res) => {
    const device = db.prepare("SELECT id FROM devices WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!device) return res.status(404).json({ error: "Device not found." });
    // Only stops tracking backups *from* this device going forward — files
    // it already uploaded stay exactly where they are in HomeCloud, same
    // as deleting a HomeMedia album never touches the underlying files.
    db.prepare("DELETE FROM synced_files WHERE device_id = ?").run(device.id);
    db.prepare("DELETE FROM devices WHERE id = ?").run(device.id);
    res.json({ ok: true });
  })
);

module.exports = router;
