// POST /internal/notifications — lets a trusted service raise a notification.
//
// HOME_MASTER_SPECIFICATION.md §31: "Applications create notifications; Home
// decides how to display/deliver them." Until now HomeCore could list and
// mark-read notifications but nothing could CREATE one. HomeMonitor is the
// first producer ("Disk usage exceeded 80%").
//
// v0 supports exactly one audience: "admins" (every enabled admin account gets
// their own copy). Notifications are per person, so each admin can read or
// dismiss theirs without affecting anyone else's. A future audience such as a
// single user would be one more branch below, not a redesign.
const express = require("express");
const { db } = require("./db");
const { getApplicationIdBySlug } = require("./homecore/db");
const { requireInternalSecret } = require("./internalAuth");

const router = express.Router();

router.post("/", requireInternalSecret, (req, res) => {
  const { applicationSlug, type, title, body = null, data = null, audience } = req.body || {};

  const applicationId = typeof applicationSlug === "string" ? getApplicationIdBySlug(applicationSlug) : null;
  if (!applicationId) {
    return res.status(400).json({ error: `Unknown application "${applicationSlug}".` });
  }
  if (typeof type !== "string" || !type.trim() || type.length > 40) {
    return res.status(400).json({ error: "type is required (up to 40 characters)." });
  }
  if (typeof title !== "string" || !title.trim() || title.length > 120) {
    return res.status(400).json({ error: "title is required (up to 120 characters)." });
  }
  if (body !== null && (typeof body !== "string" || body.length > 1000)) {
    return res.status(400).json({ error: "body must be text of up to 1000 characters." });
  }
  let dataJson = null;
  if (data !== null) {
    if (typeof data !== "object" || Array.isArray(data)) {
      return res.status(400).json({ error: "data must be an object." });
    }
    dataJson = JSON.stringify(data);
    if (dataJson.length > 2000) return res.status(400).json({ error: "data is too large." });
  }
  if (audience !== "admins") {
    return res.status(400).json({ error: 'audience must be "admins".' });
  }

  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin' AND disabled = 0").all();

  // One row per admin, all or nothing.
  const insert = db.prepare(
    "INSERT INTO hc_notifications (user_id, application_id, type, title, body, data_json) VALUES (?, ?, ?, ?, ?, ?)"
  );
  db.transaction(() => {
    for (const admin of admins) insert.run(admin.id, applicationId, type.trim(), title.trim(), body, dataJson);
  })();

  res.status(201).json({ delivered: admins.length });
});

module.exports = router;
