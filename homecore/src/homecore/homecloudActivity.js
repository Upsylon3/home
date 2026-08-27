// GET /api/activity — HomeCloud's own "my recent activity" panel
// (apps/homecloud/src/pages/Settings.jsx). Moved here from the old
// homecore/src/activity.js in MIGRATION_PLAN.md's Phase 3: same URL, same
// {activity: [{action, targetName, createdAt}]} response shape the
// frontend has always expected (see its describeActivity()/ACTION_LABELS
// in apps/homecloud/src/utils.js), but now sourced from the shared
// hc_activity_events table instead of the now-dropped activity_log —
// scoped back down to just HomeCloud's own events (via applicationId) and
// just this user's (via actorUserId), which is exactly what activity_log
// only ever held anyway.
//
// Rows land in hc_activity_events two ways: homecore/db.js's in-process
// onActivity() bridge (still the only writer for auth.js/admin.js's
// actions, since they never left this process) and
// apps/homecloud-backend/src/db.js's HTTP-emit logActivity(), via
// ../internalEvents.js (the writer for the split-out files/folders/
// publicShare actions).
const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const { getApplicationIdBySlug } = require("./db");
const { listEvents, toAction } = require("./events");

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  const events = listEvents({
    limit: 100, // matches the original activity_log query's LIMIT 100
    actorUserId: req.user.id,
    applicationId: getApplicationIdBySlug("homecloud")
  });
  res.json({
    activity: events.map((e) => ({
      action: toAction(e.eventType),
      targetName: e.targetId,
      createdAt: e.createdAt
    }))
  });
});

module.exports = router;
