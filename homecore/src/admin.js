const express = require("express");
const bcrypt = require("bcryptjs");
const { db, logActivity } = require("./db");
const { requireAuth, requireAdmin } = require("./middleware/authMiddleware");
const { asyncHandler } = require("./asyncHandler");
const { revokeAllSessions } = require("./homecore/sessions");
// Phase 3 of MIGRATION_PLAN.md: the activity feed below now reads
// hc_activity_events instead of the now-dropped activity_log — see the
// route's own comment.
const { getApplicationIdBySlug } = require("./homecore/db");
const { listEvents, toAction } = require("./homecore/events");

const router = express.Router();
router.use(requireAuth, requireAdmin);

const defaultQuota = () => Number(process.env.QUOTA_BYTES || 5 * 1024 ** 3);

// List every account, with how much storage each is using and their
// effective quota (their personal override, or the server default).
router.get("/users", (req, res) => {
  const rows = db
    .prepare(
      `SELECT
         u.id,
         u.username,
         u.role,
         u.disabled,
         u.quota_override AS quotaOverride,
         u.created_at AS createdAt,
         u.totp_enabled AS totpEnabled,
         COALESCE((SELECT SUM(size) FROM files WHERE user_id = u.id), 0) AS usedBytes
       FROM users u
       ORDER BY u.created_at ASC`
    )
    .all();

  const result = rows.map((r) => ({
    ...r,
    disabled: Boolean(r.disabled),
    totpEnabled: Boolean(r.totpEnabled),
    quotaBytes: r.quotaOverride ?? defaultQuota()
  }));

  res.json({ users: result, defaultQuotaBytes: defaultQuota() });
});

// Set a new password for a family member who forgot theirs. This is the
// practical stand-in for an email-based "forgot password" flow, since that
// would require setting up an outgoing mail server.
router.post(
  "/users/:id/reset-password",
  asyncHandler(async (req, res) => {
    const { newPassword } = req.body || {};
    if (typeof newPassword !== "string" || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters." });
    }

    const target = db.prepare("SELECT id, username FROM users WHERE id = ?").get(req.params.id);
    if (!target) return res.status(404).json({ error: "User not found." });

    const hash = await bcrypt.hash(newPassword, 12);
    db.prepare("UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?").run(
      hash,
      req.params.id
    );
    revokeAllSessions(req.params.id);
    logActivity(req.user.id, "admin_reset_password", target.username);
    res.json({ ok: true });
  })
);

// Disable / re-enable an account (e.g. a kid who needs a time-out from
// uploading, or a device that was lost).
router.post("/users/:id/disabled", (req, res) => {
  const { disabled } = req.body || {};
  const target = db.prepare("SELECT id, username FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found." });

  if (Number(req.params.id) === req.user.id && disabled) {
    return res.status(400).json({ error: "You can't disable your own account." });
  }

  db.prepare("UPDATE users SET disabled = ?, token_version = token_version + 1 WHERE id = ?").run(
    disabled ? 1 : 0,
    req.params.id
  );
  revokeAllSessions(req.params.id);
  logActivity(req.user.id, disabled ? "admin_disable" : "admin_enable", target.username);
  res.json({ ok: true });
});

// Give a family member more or less storage than the server default.
// Pass quotaBytes: null to clear the override and fall back to the default.
router.post("/users/:id/quota", (req, res) => {
  const { quotaBytes } = req.body || {};
  const target = db.prepare("SELECT id, username FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found." });

  if (quotaBytes !== null && (!Number.isFinite(quotaBytes) || quotaBytes <= 0)) {
    return res.status(400).json({ error: "quotaBytes must be a positive number, or null to reset to default." });
  }

  db.prepare("UPDATE users SET quota_override = ? WHERE id = ?").run(quotaBytes, req.params.id);
  logActivity(req.user.id, "admin_set_quota", target.username);
  res.json({ ok: true });
});

// Promote/demote admin status. Guarded so the last remaining admin can't
// accidentally demote themselves and lock the whole family out of admin
// controls.
router.post("/users/:id/role", (req, res) => {
  const { role } = req.body || {};
  if (!["admin", "user"].includes(role)) {
    return res.status(400).json({ error: "role must be 'admin' or 'user'." });
  }

  const target = db.prepare("SELECT id, role FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found." });

  if (target.role === "admin" && role === "user") {
    const adminCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
    if (adminCount <= 1) {
      return res.status(400).json({ error: "Can't remove the last remaining admin." });
    }
  }

  db.prepare("UPDATE users SET role = ?, token_version = token_version + 1 WHERE id = ?").run(
    role,
    req.params.id
  );
  revokeAllSessions(req.params.id);
  logActivity(req.user.id, role === "admin" ? "admin_promote" : "admin_demote", target.username);
  res.json({ ok: true });
});

// Force-disable 2FA for someone who's locked themselves out (lost their
// phone/authenticator and used up their recovery codes). No password
// check needed here since this is exactly the "I can't prove who I am
// through the normal channel" scenario — it relies on the admin verifying
// the person's identity some other way (in person, a phone call, etc.)
// before doing this.
router.post("/users/:id/2fa/disable", (req, res) => {
  const target = db.prepare("SELECT id, username FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found." });

  db.prepare("UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?").run(req.params.id);
  db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(req.params.id);
  logActivity(req.user.id, "admin_disable_2fa", target.username);
  res.json({ ok: true });
});

// Cross-family activity feed — every logged action, from every account, so
// an admin can answer "who deleted this?" without guessing. Moved off
// activity_log (dropped in Phase 3 of MIGRATION_PLAN.md) onto the shared
// hc_activity_events table, scoped to just HomeCloud's own events —
// exactly what activity_log always held anyway — and translated back into
// the {action, targetName, createdAt, username} shape apps/homecloud's
// Admin.jsx (via describeActivity()/ACTION_LABELS) has always expected, so
// that frontend needed no changes here.
router.get("/activity", (req, res) => {
  const events = listEvents({
    limit: 200,
    applicationId: getApplicationIdBySlug("homecloud")
  });
  const rows = events.map((e) => ({
    action: toAction(e.eventType),
    targetName: e.targetId,
    createdAt: e.createdAt,
    username: e.actorUsername
  }));
  res.json({ activity: rows });
});

module.exports = router;
