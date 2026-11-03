// /api/core/notifications/* — HOME_MASTER_SPECIFICATION.md §7.7 / §31.
//
// HomeMonitor's admin alerts and opt-in HomeTasks reminders use Core's
// producer endpoints. Reading and marking notices always remain user-scoped.
const express = require("express");
const { db } = require("../db");
const { errorBody } = require("./errors");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = db
    .prepare(
      `SELECT n.id, n.type, n.title, n.body, n.data_json AS dataJson,
              n.read_at AS readAt, n.created_at AS createdAt, a.slug AS applicationSlug
       FROM hc_notifications n
       LEFT JOIN hc_applications a ON a.id = n.application_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT 100`
    )
    .all(req.user.id)
    .map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      data: row.dataJson ? JSON.parse(row.dataJson) : null,
      readAt: row.readAt,
      createdAt: row.createdAt,
      applicationSlug: row.applicationSlug
    }));

  res.json({ notifications: rows });
});

router.patch("/:id/read", (req, res) => {
  const row = db.prepare("SELECT id FROM hc_notifications WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!row) {
    return res.status(404).json(errorBody(req, "NOTIFICATION_NOT_FOUND", "No notification with that id."));
  }
  db.prepare("UPDATE hc_notifications SET read_at = datetime('now') WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

module.exports = router;
