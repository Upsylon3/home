// GET /api/activity — HomeCloud's own "my recent activity" panel
// (apps/homecloud/src/pages/Settings.jsx). Response shape:
// {activity: [{action, targetName, createdAt}]} (see the frontend's
// describeActivity()/ACTION_LABELS in apps/homecloud/src/utils.js).
// Sourced from the shared hc_activity_events table, filtered down to
// just HomeCloud's own events (via applicationId) and just this user's
// (via actorUserId).
//
// Rows land in hc_activity_events two ways: ../db.js's in-process
// onActivity() bridge (the writer for auth.js/admin.js's actions, since
// those run inside this same process) and
// apps/homecloud-backend/src/db.js's HTTP-emit logActivity(), via
// ../internalEvents.js (the writer for files/folders/share-link actions,
// which happen in that separate service).
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
