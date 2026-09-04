// POST /internal/events — the HTTP side of "may emit events to the shared
// bus, fire-and-forget" (docs/ARCHITECTURE.md §4's Tier 1 rule).
//
// apps/homecloud-backend runs in its own separate process from HomeCore,
// so it can't reach ./db.js's in-process onActivity() hook directly (that
// hook only sees logActivity() calls made inside this same process, i.e.
// from auth.js/admin.js). It POSTs here instead — its own logActivity()
// (apps/homecloud-backend/src/db.js) does exactly this, fire-and-forget,
// never awaited by its callers.
//
// Deliberately NOT under /api/core: everything there is browser-facing,
// authenticated as a signed-in *user* (see homecore/index.js's requireAuth).
// This is a machine-to-machine call — "one trusted service calling another
// as itself, not as a user" — so it's protected by a shared secret instead
// of a user's bearer token. logActivity()'s signature only ever carried a
// plain userId (it never had a per-request token to forward — see its
// callers in files.js/folders.js), so authenticating this call as
// "HomeCloud's backend, acting on userId's behalf" is the natural fit,
// not a workaround.
const express = require("express");
const { getApplicationIdBySlug } = require("./homecore/db");
const { emitEvent, toEventType } = require("./homecore/events");

const router = express.Router();

function requireInternalSecret(req, res, next) {
  const configured = process.env.HOMECORE_INTERNAL_SECRET;
  const provided = req.headers["x-internal-secret"];
  // Fail closed if the secret was never configured. An unset secret must
  // never quietly mean "anyone gets in" — it must mean "nobody does."
  if (!configured || !provided || provided !== configured) {
    return res.status(401).json({ error: "Invalid or missing internal service credentials." });
  }
  next();
}

router.post("/", requireInternalSecret, (req, res) => {
  const { userId, applicationSlug, action, targetName = null } = req.body || {};

  if (!Number.isInteger(userId)) {
    return res.status(400).json({ error: "userId (integer) is required." });
  }
  if (typeof applicationSlug !== "string" || !applicationSlug.trim()) {
    return res.status(400).json({ error: "applicationSlug is required." });
  }
  if (typeof action !== "string" || !action.trim()) {
    return res.status(400).json({ error: "action is required." });
  }

  const applicationId = getApplicationIdBySlug(applicationSlug);
  if (!applicationId) {
    return res.status(400).json({ error: `Unknown application "${applicationSlug}".` });
  }

  // Fire this synchronously (better-sqlite3 is sync) and respond — there's
  // nothing further to await. If the caller doesn't wait for this response
  // (it doesn't — see apps/homecloud-backend/src/db.js), that's exactly the
  // fire-and-forget contract working as intended, not a race.
  emitEvent({
    actorUserId: userId,
    applicationId,
    eventType: toEventType(action),
    targetType: targetName ? "resource" : null,
    targetId: targetName
  });

  res.status(202).json({ ok: true });
});

module.exports = router;
