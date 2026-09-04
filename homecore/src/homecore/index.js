// HomeCore v0 entry point. Mounted at /api/core in server.js, alongside
// (not instead of) this service's own /api/auth, /api/admin, and
// /api/activity — see HOME_MASTER_SPECIFICATION.md §10 "Keep application
// APIs separate."
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

runSeed();

const router = express.Router();
router.use(attachRequestId);

// Public, unauthenticated — see health.js for why.
router.use("/health", healthRoutes);

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
