// GET /internal/users/usage — per-user storage usage, for HomeCore's
// admin panel (homecore/src/admin.js) to show alongside each account.
// Authenticated with a shared secret rather than a user's bearer token
// (the same pattern as POST /internal/events, see
// homecore/src/internalEvents.js) — there's no per-request user token to
// forward here, since this is HomeCore asking on behalf of the whole
// admin panel, not any one user.
//
// Deliberately reuses HOMECORE_INTERNAL_SECRET rather than minting a
// second secret for a second internal endpoint — one shared secret
// authenticating machine-to-machine calls between these two services in
// either direction, not two independent ones to generate, document, and
// keep in sync.
const express = require("express");
const { db } = require("./db");

const router = express.Router();

function requireInternalSecret(req, res, next) {
  const configured = process.env.HOMECORE_INTERNAL_SECRET;
  const provided = req.headers["x-internal-secret"];
  // Same fail-closed rule as homecore/src/internalEvents.js: an unset
  // secret must never quietly mean "anyone gets in."
  if (!configured || !provided || provided !== configured) {
    return res.status(401).json({ error: "Invalid or missing internal service credentials." });
  }
  next();
}

router.get("/", requireInternalSecret, (req, res) => {
  // Only users with at least one file appear here — the caller (admin.js)
  // treats anyone missing as 0 bytes used, which is both correct and
  // cheaper than this query explicitly listing every zero-usage account.
  const rows = db.prepare("SELECT user_id AS userId, SUM(size) AS usedBytes FROM files GROUP BY user_id").all();
  res.json({ usage: rows });
});

module.exports = router;
