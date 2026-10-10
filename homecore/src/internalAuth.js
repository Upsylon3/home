// The ONE place that decides whether an /internal/... request is allowed.
//
// /internal/... routes are machine-to-machine: one trusted Home service
// calling HomeCore as itself, not as a signed-in person. They are protected
// by a shared secret (HOMECORE_INTERNAL_SECRET, the same value on both sides)
// sent in the X-Internal-Secret header, instead of a user's bearer token.
//
// Keeping this check in one file means /internal/events, /internal/apps and
// /internal/notifications can never drift into slightly different rules.
const crypto = require("crypto");

function requireInternalSecret(req, res, next) {
  const configured = process.env.HOMECORE_INTERNAL_SECRET;
  const provided = req.headers["x-internal-secret"];

  // Fail closed if the secret was never configured. An unset secret must
  // never quietly mean "anyone gets in": it must mean "nobody does".
  if (!configured || !provided) {
    return res.status(401).json({ error: "Invalid or missing internal service credentials." });
  }

  // timingSafeEqual compares in constant time, so an attacker can't learn the
  // secret one character at a time by measuring how long a wrong guess takes.
  // It requires equal lengths, hence the length check first.
  const a = Buffer.from(String(provided));
  const b = Buffer.from(configured);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Invalid or missing internal service credentials." });
  }
  next();
}

module.exports = { requireInternalSecret };
