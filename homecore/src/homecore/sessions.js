// HomeCore v0 — sessions.
//
// HOME_MASTER_SPECIFICATION.md §7.2 asks for a server-managed session model
// "if the project eventually outgrows the current JWT-only model," and is
// explicit that "a migration from the existing JWT implementation should be
// gradual rather than forced immediately."
//
// So for v0, the JWT stays the actual credential — nothing here changes
// what makes a request authorized. This module only makes sessions visible
// and mass-revocable: every time auth.js issues a fresh JWT (register,
// login, 2FA verify), it calls recordSession() so there's a row to look at;
// every place that already invalidates all of a user's tokens by bumping
// token_version (password change, logout-everywhere, admin actions) also
// calls revokeAllSessions() so this table doesn't silently drift out of
// sync with reality. authMiddleware.js calls touchSession() on every
// successful request so last_seen_at means something.
//
// Every function here fails soft (catches and logs) — a problem recording
// session metadata must never block an actual login or authenticated
// request. auth.js/admin.js/authMiddleware.js call into this module
// directly rather than through db.js's onActivity-style hook, because
// unlike activity logging there's no single existing choke point to
// piggyback on (session issuance isn't otherwise recorded anywhere); this
// is the adapter layer itself, per Rule 3's
// existing-system -> adapter -> HomeCore-abstraction diagram.
const crypto = require("crypto");
const { db } = require("../db");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function recordSession(userId, token, deviceName) {
  try {
    db.prepare(
      `INSERT INTO hc_sessions (user_id, token_hash, device_name, last_seen_at)
       VALUES (?, ?, ?, datetime('now'))`
    ).run(userId, hashToken(token), deviceName ? String(deviceName).slice(0, 200) : null);
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(userId);
  } catch (err) {
    console.error("[homecore] failed to record session (login still succeeded):", err);
  }
}

function touchSession(token) {
  try {
    db.prepare(
      `UPDATE hc_sessions SET last_seen_at = datetime('now') WHERE token_hash = ? AND revoked_at IS NULL`
    ).run(hashToken(token));
  } catch (err) {
    console.error("[homecore] failed to touch session (request still succeeded):", err);
  }
}

function revokeAllSessions(userId) {
  try {
    db.prepare(
      `UPDATE hc_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`
    ).run(userId);
  } catch (err) {
    console.error("[homecore] failed to revoke sessions:", err);
  }
}

function listSessions(userId) {
  return db
    .prepare(
      `SELECT id, device_name AS deviceName, created_at AS createdAt,
              revoked_at AS revokedAt, last_seen_at AS lastSeenAt
       FROM hc_sessions WHERE user_id = ? ORDER BY created_at DESC`
    )
    .all(userId);
}

module.exports = { hashToken, recordSession, touchSession, revokeAllSessions, listSessions };
