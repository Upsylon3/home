const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { Secret, TOTP } = require("otpauth");
const { createRateLimiter } = require("./rateLimiter");
const { db, logActivity } = require("./db");
const { requireAuth } = require("./middleware/authMiddleware");
const { asyncHandler } = require("./asyncHandler");
// HomeCore v0 session adapter — see homecore/sessions.js for why auth.js
// calls into it directly instead of through a hook.
const { recordSession, revokeAllSessions } = require("./homecore/sessions");

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

// Slows down brute-force password guessing. Keyed by IP address; a genuine
// family member mistyping their password a few times won't hit this, but a
// script trying thousands of guesses will.
const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait 15 minutes and try again." }
});

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, tokenVersion: user.token_version ?? 0 },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

// A short-lived, narrowly-scoped token issued right after a correct
// password when 2FA is enabled — it only proves "this person just entered
// the right password," not "this person is fully logged in." It's only
// ever accepted by the /2fa/verify route below, and expires quickly since
// its only job is to bridge the few seconds between typing a password and
// typing an authenticator code.
function signPendingToken(userId) {
  return jwt.sign({ sub: userId, pending2fa: true }, process.env.JWT_SECRET, { expiresIn: "5m" });
}

function buildTotp(username, base32Secret) {
  return new TOTP({
    issuer: "homecloud",
    label: username,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(base32Secret)
  });
}

// Recovery codes are for when someone loses their authenticator app.
// Displayed once, in full, right after being generated — only their
// bcrypt hash is ever stored, exactly like passwords.
function generateRecoveryCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString("hex"); // 10 hex chars
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`.toUpperCase());
  }
  return codes;
}

async function storeRecoveryCodes(userId, codes) {
  db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(userId);
  for (const code of codes) {
    const hash = await bcrypt.hash(code, 10);
    db.prepare("INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)").run(userId, hash);
  }
}

// Tries to match (and consume) one of a user's unused recovery codes.
// Returns true if the code was valid and has now been marked used.
async function tryConsumeRecoveryCode(userId, candidate) {
  const rows = db
    .prepare("SELECT id, code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL")
    .all(userId);

  for (const row of rows) {
    if (await bcrypt.compare(candidate, row.code_hash)) {
      db.prepare("UPDATE recovery_codes SET used_at = datetime('now') WHERE id = ?").run(row.id);
      return true;
    }
  }
  return false;
}

router.post(
  "/register",
  authLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};

    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({
        error: "Username must be 3-32 characters: letters, numbers, dots, dashes, underscores only."
      });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (existing) {
      return res.status(409).json({ error: "That username is already taken." });
    }

    // The very first account created on a fresh server becomes the admin,
    // so there's always someone who can manage the family's accounts without
    // any manual database setup.
    const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
    const role = userCount === 0 ? "admin" : "user";

    const passwordHash = await bcrypt.hash(password, 12);
    const info = db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
      .run(username, passwordHash, role);

    const user = { id: info.lastInsertRowid, username, token_version: 0 };
    const token = signToken(user);
    recordSession(user.id, token, req.headers["user-agent"]);
    res.status(201).json({ token, user: { id: user.id, username: user.username, role } });
  })
);

router.post(
  "/login",
  authLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};

    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (!row) {
      return res.status(401).json({ error: "Incorrect username or password." });
    }
    if (row.disabled) {
      return res.status(403).json({ error: "This account has been disabled. Ask your admin for help." });
    }

    const valid = await bcrypt.compare(password, row.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Incorrect username or password." });
    }

    if (row.totp_enabled) {
      // Correct password, but not done yet — hand back a short-lived pending
      // token instead of a real session, and make the frontend ask for the
      // authenticator code before actually logging in.
      return res.json({ requires2fa: true, pendingToken: signPendingToken(row.id) });
    }

    const token = signToken(row);
    recordSession(row.id, token, req.headers["user-agent"]);
    res.json({ token, user: { id: row.id, username: row.username, role: row.role } });
  })
);

router.post(
  "/2fa/verify",
  authLimiter,
  asyncHandler(async (req, res) => {
    const { pendingToken, code } = req.body || {};
    if (typeof pendingToken !== "string" || typeof code !== "string" || !pendingToken || !code) {
      return res.status(400).json({ error: "Pending token and code are required." });
    }

    let payload;
    try {
      payload = jwt.verify(pendingToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: "That login attempt has expired. Please log in again." });
    }
    if (!payload.pending2fa) {
      return res.status(400).json({ error: "Invalid pending token." });
    }

    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub);
    if (!row || row.disabled || !row.totp_enabled) {
      return res.status(401).json({ error: "Unable to complete login." });
    }

    const cleanCode = String(code).trim().toUpperCase();
    const totp = buildTotp(row.username, row.totp_secret);
    const totpValid = totp.validate({ token: cleanCode, window: 1 }) !== null;
    const usedRecoveryCode = !totpValid && (await tryConsumeRecoveryCode(row.id, cleanCode));

    if (!totpValid && !usedRecoveryCode) {
      return res.status(401).json({ error: "Incorrect code." });
    }

    const token = signToken(row);
    recordSession(row.id, token, req.headers["user-agent"]);
    logActivity(row.id, usedRecoveryCode ? "2fa_recovery_login" : "2fa_login");
    res.json({ token, user: { id: row.id, username: row.username, role: row.role } });
  })
);

router.get("/me", requireAuth, (req, res) => {
  // Used to also compute quotaBytes/usedBytes here with a direct query
  // against a local `files` table — that table (and the query) is gone as
  // of MIGRATION_PLAN.md's Phase 5: apps/homecloud's and apps/home's
  // frontends both now call apps/homecloud-backend's own
  // GET /api/homecloud/files/quota instead (see CHANGELOG.md's [0.9.0]).
  // quotaOverride stays — it's the one piece of this that's genuinely a
  // HomeCore/identity concern (the raw per-user limit override), which
  // homecloud-backend's own quota check reads from here.
  const row = db.prepare("SELECT quota_override, totp_enabled FROM users WHERE id = ?").get(req.user.id);

  res.json({
    id: req.user.id,
    username: req.user.username,
    role: req.user.role,
    totpEnabled: Boolean(row.totp_enabled),
    quotaOverride: row.quota_override ?? null
  });
});

router.post(
  "/change-password",
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};

    if (typeof currentPassword !== "string" || typeof newPassword !== "string" || !currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are required." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters." });
    }

    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    const valid = await bcrypt.compare(currentPassword, row.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    // Bumping token_version invalidates every previously issued token for this
    // user — including whatever device is compromised or lost, if that's why
    // the password is being changed — so a fresh login is required everywhere.
    db.prepare("UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?").run(
      newHash,
      req.user.id
    );

    const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    const token = signToken(updated);
    revokeAllSessions(req.user.id);
    recordSession(updated.id, token, req.headers["user-agent"]);
    logActivity(req.user.id, "password_change");
    res.json({ token, user: { id: updated.id, username: updated.username, role: updated.role } });
  })
);

router.post("/logout-everywhere", requireAuth, (req, res) => {
  db.prepare("UPDATE users SET token_version = token_version + 1 WHERE id = ?").run(req.user.id);
  revokeAllSessions(req.user.id);
  logActivity(req.user.id, "logout_everywhere");
  res.json({ ok: true });
});

// Step 1 of turning on 2FA: generate a new secret and hand back the
// otpauth:// URL (for a QR code) plus the raw secret (for manual entry).
// Nothing is actually enabled yet — that only happens once the person
// proves they scanned it correctly in /2fa/confirm.
//
// If 2FA is already enabled, re-running this would silently replace the
// working secret and flip totp_enabled off — which would let a stolen
// session token alone (no password needed) strip 2FA from an account.
// So when it's already on, this requires the current password first,
// same bar as /2fa/disable.
router.post(
  "/2fa/setup",
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);

    if (row.totp_enabled) {
      const { password } = req.body || {};
      if (typeof password !== "string") {
        return res.status(400).json({ error: "Enter your current password to reset two-factor authentication." });
      }
      const valid = await bcrypt.compare(password, row.password_hash);
      if (!valid) {
        return res.status(401).json({ error: "Current password is incorrect." });
      }
    }

    const secret = new Secret({ size: 20 });
    db.prepare("UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?").run(secret.base32, req.user.id);

    const totp = buildTotp(req.user.username, secret.base32);
    res.json({ secret: secret.base32, otpauthUrl: totp.toString() });
  })
);

// Step 2: confirm the authenticator app is actually working before we
// commit to requiring it on every future login. On success, generates
// recovery codes and returns them once, in plain text.
router.post(
  "/2fa/confirm",
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const { code } = req.body || {};
    const row = db.prepare("SELECT totp_secret FROM users WHERE id = ?").get(req.user.id);

    if (!row?.totp_secret) {
      return res.status(400).json({ error: "Start 2FA setup first." });
    }

    const totp = buildTotp(req.user.username, row.totp_secret);
    if (totp.validate({ token: String(code || "").trim(), window: 1 }) === null) {
      return res
        .status(401)
        .json({ error: "That code didn't match. Double check your authenticator app and try again." });
    }

    db.prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?").run(req.user.id);
    const recoveryCodes = generateRecoveryCodes();
    await storeRecoveryCodes(req.user.id, recoveryCodes);
    logActivity(req.user.id, "2fa_enable");
    res.json({ ok: true, recoveryCodes });
  })
);

// Turning 2FA off requires the current password, same bar as changing it —
// so a stolen, still-logged-in session alone isn't enough to remove this
// protection.
router.post(
  "/2fa/disable",
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const { password } = req.body || {};
    if (typeof password !== "string") {
      return res.status(400).json({ error: "Password is required." });
    }
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);

    const valid = await bcrypt.compare(password, row.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    db.prepare("UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?").run(req.user.id);
    db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").run(req.user.id);
    logActivity(req.user.id, "2fa_disable");
    res.json({ ok: true });
  })
);

// Invalidates any old recovery codes and issues a fresh set — for when
// someone's used most of them up, or just wants to rotate them.
router.post(
  "/2fa/recovery-codes",
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const { password } = req.body || {};
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);

    if (!row.totp_enabled) {
      return res.status(400).json({ error: "2FA isn't enabled on this account." });
    }
    if (typeof password !== "string") {
      return res.status(400).json({ error: "Password is required." });
    }

    const valid = await bcrypt.compare(password, row.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const recoveryCodes = generateRecoveryCodes();
    await storeRecoveryCodes(req.user.id, recoveryCodes);
    logActivity(req.user.id, "2fa_recovery_codes_regenerated");
    res.json({ ok: true, recoveryCodes });
  })
);

module.exports = router;
