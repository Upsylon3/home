// GET /api/core/activity — HOME_MASTER_SPECIFICATION.md §5.1 "Events" /
// §39 "Audit". This is the cross-application successor to HomeCloud's
// existing /api/admin/activity, reading from hc_activity_events instead of
// activity_log — populated automatically for every HomeCloud action via
// the bridge in homecore/db.js. The original /api/activity (per-user) and
// /api/admin/activity (admin, HomeCloud-only) both keep working unchanged.
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
