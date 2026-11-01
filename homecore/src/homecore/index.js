// Canonical HomeCore entry point. Legacy top-level auth/admin/activity
// mounts remain compatible; shared router instances preserve authorization,
// session behavior and rate-limit counters across both URL families.
//
// Requiring ./db here — before any routes are set up — is what actually
// creates the hc_ tables, adds the new users columns, seeds the permission
// catalog, registers HomeCloud in the application registry, and wires the
// onActivity -> hc_activity_events bridge. Every route module below
// assumes that's already happened.
const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
require("./db");
const { runSeed } = require("./seed");
const { attachRequestId, coreErrorHandler } = require("./errors");

const healthRoutes = require("./health");
const systemRoutes = require("./system");
const usersRoutes = require("./users");
const appsRoutes = require("./apps");
const permissionsRoutes = require("./permissions");
const activityRoutes = require("./activity");
const notificationsRoutes = require("./notifications");
const { publicRouter: delegationRoutes } = require("./delegations");
const authRoutes = require("../auth");
const adminRoutes = require("../admin");
const homecloudActivityRoutes = require("./homecloudActivity");

runSeed();

const router = express.Router();
router.use(attachRequestId);

// Public, unauthenticated — see health.js for why.
router.use("/health", healthRoutes);
router.use("/delegations", delegationRoutes);
router.use("/auth", authRoutes);
router.use("/admin", adminRoutes);
// The existing /activity and /activity/me are cross-application views.
// Give the legacy HomeCloud-shaped personal feed an explicit scoped path.
router.use("/activity/homecloud", homecloudActivityRoutes);

// Everything else requires a signed-in HomeCloud/HomeCore identity.
router.use("/system", requireAuth, systemRoutes);
router.use("/users", requireAuth, usersRoutes);
router.use("/apps", requireAuth, appsRoutes);
router.use("/permissions", requireAuth, permissionsRoutes);
router.use("/activity", requireAuth, activityRoutes);
router.use("/notifications", requireAuth, notificationsRoutes);

router.use((req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found.", requestId: req.requestId } });
});

router.use(coreErrorHandler);

module.exports = router;
