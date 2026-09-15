const jwt = require("jsonwebtoken");
const { db } = require("../db");
// HomeCore v0 — records that this session was actually used, so
// /api/core/users/me/sessions' lastSeenAt reflects reality. Fails soft; see
// homecore/sessions.js.
const { touchSession } = require("../homecore/sessions");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or malformed authorization header." });
  }

  let payload;
  try {
    // Explicit, not strictly required — verified directly against this
    // project's pinned jsonwebtoken@9.0.3 that a forged `alg: "none"`
    // token is already rejected by default ("jwt signature is
    // required"), and the classic RS256-signed-as-HS256 confusion
    // attack has nothing to attach to here since this project only
    // ever signs with a single HMAC secret — no public/private keypair
    // exists anywhere for an attacker to redirect verification onto.
    // Pinning the allow-list anyway means that stays true regardless of
    // a future change (a new sign call using a different algorithm, a
    // library upgrade with different defaults) rather than depending on
    // today's default continuing to be safe.
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }

  // A pending-2FA token (issued right after a correct password, before the
  // authenticator code is checked) is a different, narrower kind of token
  // than a real session — it must never be usable here, or 2FA would be
  // pointless. Only /auth/2fa/verify is allowed to accept one.
  if (payload.pending2fa) {
    return res.status(401).json({ error: "Two-factor verification required." });
  }

  // The JWT itself only proves the token was signed by us at some point.
  // We still look the user up fresh so that a password change, a "sign out
  // everywhere" click, or an admin disabling the account takes effect
  // immediately instead of waiting out the token's natural expiry.
  const user = db.prepare("SELECT id, username, role, disabled, token_version FROM users WHERE id = ?").get(payload.sub);

  if (!user) {
    return res.status(401).json({ error: "Account no longer exists." });
  }
  if (user.disabled) {
    return res.status(403).json({ error: "This account has been disabled." });
  }
  if ((payload.tokenVersion ?? 0) !== user.token_version) {
    return res.status(401).json({ error: "Session has been signed out. Please log in again." });
  }

  req.user = { id: user.id, username: user.username, role: user.role };
  touchSession(token);
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
