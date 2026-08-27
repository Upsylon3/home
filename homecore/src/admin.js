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

// TEMPORARY, see MIGRATION_PLAN.md's Phase 4 → Phase 5 gap: usage now
// genuinely lives on apps/homecloud-backend, fetched via its
// GET /internal/users/usage — but that service isn't wired into
// docker-compose.yml/the gateway yet (that's Phase 5), so in every real
// deployment today it simply isn't running. Falling back to the local
// `files` table (still present — Phase 2 explicitly didn't delete it,
// "don't delete until the commit that flips the switch") keeps this
// route's live behavior completely unchanged until that switch actually
// flips, while the new path is already fully built and tested
// (apps/homecloud-backend/test/internalUsage.test.js) ahead of when it's
// needed. Phase 5 or 6 removes this fallback once homecore/src/db.js's
// own `files` table is actually dropped — at that point this function
// should throw on failure instead of quietly falling back to a table
// that no longer exists.
const USAGE_FETCH_TIMEOUT_MS = 2000;

async function fetchUsageFromHomecloudBackend() {
  const url = `${(process.env.HOMECLOUD_BACKEND_INTERNAL_URL || "http://homecloud-backend:4500").replace(/\/$/, "")}/internal/users/usage`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), USAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "X-Internal-Secret": process.env.HOMECORE_INTERNAL_SECRET || "" },
      signal: controller.signal
    });
    if (!res.ok) return null;
    const body = await res.json();
    const byUserId = new Map();
    for (const row of body.usage) byUserId.set(row.userId, row.usedBytes);
    return byUserId;
  } catch {
    return null; // unreachable, timed out, or malformed — caller falls back
  } finally {
    clearTimeout(timeout);
  }
}

function usageFromLocalFilesTable() {
  const rows = db.prepare("SELECT user_id AS userId, SUM(size) AS usedBytes FROM files GROUP BY user_id").all();
  return new Map(rows.map((r) => [r.userId, r.usedBytes]));
}

// List every account, with how much storage each is using and their
// effective quota (their personal override, or the server default).
router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const users = db
      .prepare(
        `SELECT id, username, role, disabled, quota_override AS quotaOverride,
                created_at AS createdAt, totp_enabled AS totpEnabled
         FROM users ORDER BY created_at ASC`
      )
      .all();

    const usageByUserId = (await fetchUsageFromHomecloudBackend()) || usageFromLocalFilesTable();

    const result = users.map((u) => ({
      ...u,
      disabled: Boolean(u.disabled),
      totpEnabled: Boolean(u.totpEnabled),
      quotaBytes: u.quotaOverride ?? defaultQuota(),
      usedBytes: usageByUserId.get(u.id) ?? 0
    }));

    res.json({ users: result, defaultQuotaBytes: defaultQuota() });
  })
);

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
