// GET /api/core/activity — HOME_MASTER_SPECIFICATION.md §5.1 "Events" /
// §39 "Audit". This is the cross-application successor to HomeCloud's
// own /api/admin/activity, reading from the same hc_activity_events
// table that both HomeCloud-scoped feeds read from too. The difference
// from those two is scope, not data source: this one is deliberately
// cross-application (no applicationId filter — see ./events.js's
// listEvents), where ./homecloudActivity.js's /api/activity and
// admin.js's /api/admin/activity both filter down to just HomeCloud's
// own events.
//
// Two views, two audiences:
//   GET /api/core/activity      — every user's events, admin-only (mounted
//                                  with requireAdmin below; matches the
//                                  existing admin activity feed's scope)
//   GET /api/core/activity/me   — the signed-in user's own events across
//                                  every application, open to anyone. This
//                                  is what Home's dashboard "RECENT" widget
//                                  (§4.1) actually uses — a personal feed,
//                                  not an admin audit tool, so it can't sit
//                                  behind requireAdmin.
const express = require("express");
const { requireAdmin } = require("../middleware/authMiddleware");
const { listEvents } = require("./events");

const router = express.Router();

router.get("/me", (req, res) => {
  const limit = req.query.limit;
  res.json({ events: listEvents({ limit, actorUserId: req.user.id }) });
});

router.get("/", requireAdmin, (req, res) => {
  const limit = req.query.limit;
  res.json({ events: listEvents({ limit }) });
});

module.exports = router;
