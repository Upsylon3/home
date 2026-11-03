// A dedicated producer credential; never accepts the general internal secret.
const express = require("express");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { db } = require("./db");

function readKey() {
  const file = process.env.HOMETASKS_REMINDER_KEY_FILE;
  if (!file) return null;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size !== 32) return null;
    const key = fs.readFileSync(file);
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

db.exec(`CREATE TABLE IF NOT EXISTS hc_task_reminder_deliveries (
  delivery_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, task_id INTEGER NOT NULL,
  notification_id INTEGER NOT NULL, created_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_reminder_deliveries_time ON hc_task_reminder_deliveries(created_ms);`);

const router = express.Router();
router.post("/", (req, res) => {
  const key = readKey();
  if (!key) return res.status(503).json({ error: "Task reminders are not configured." });
  const provided = req.get("X-Task-Reminder-Key") || "";
  if (!/^[a-f0-9]{64}$/.test(provided) || !crypto.timingSafeEqual(Buffer.from(provided, "hex"), key)) {
    return res.status(401).json({ error: "Invalid reminder service credentials." });
  }
  const { deliveryId, userId, taskId, taskTitle } = req.body || {};
  if (Object.keys(req.body || {}).some(k => !["deliveryId", "userId", "taskId", "taskTitle"].includes(k)) ||
      typeof deliveryId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(deliveryId) ||
      !Number.isSafeInteger(userId) || userId < 1 || !Number.isSafeInteger(taskId) || taskId < 1 ||
      typeof taskTitle !== "string" || !taskTitle.trim() || taskTitle.length > 200) {
    return res.status(400).json({ error: "Invalid task reminder." });
  }
  const result = db.transaction(() => {
    const old = db.prepare("SELECT * FROM hc_task_reminder_deliveries WHERE delivery_id = ?").get(deliveryId);
    if (old) return { status: old.user_id === userId && old.task_id === taskId ? 200 : 409, replayed: true };
    const user = db.prepare("SELECT id FROM users WHERE id = ? AND disabled = 0").get(userId);
    const app = db.prepare("SELECT id FROM hc_applications WHERE slug = 'hometasks' AND enabled = 1").get();
    if (!user || !app) return { status: 410 };
    const now = Date.now();
    const day = Math.floor(now / 86400000) * 86400000;
    const counts = db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(user_id = ?), 0) AS own FROM hc_task_reminder_deliveries WHERE created_ms >= ?").get(userId, day);
    if (counts.own >= 100 || counts.total >= 1000) return { status: 429 };
    const row = db.prepare("INSERT INTO hc_notifications (user_id, application_id, type, title, body, data_json) VALUES (?, ?, 'info', 'Task reminder', ?, ?)")
      .run(userId, app.id, taskTitle.trim(), JSON.stringify({ taskId }));
    db.prepare("INSERT INTO hc_task_reminder_deliveries VALUES (?, ?, ?, ?, ?)").run(deliveryId, userId, taskId, row.lastInsertRowid, now);
    return { status: 201, replayed: false };
  })();
  if (result.status === 200 || result.status === 201) return res.status(result.status).json({ delivered: true, replayed: result.replayed });
  res.status(result.status).json({ error: result.status === 410 ? "Reminder recipient or application unavailable." : result.status === 429 ? "Reminder delivery limit reached." : "Delivery key belongs to another reminder." });
});
module.exports = router;
