// GET /api/core/health — HOME_MASTER_SPECIFICATION.md §32.
// Deliberately public (no requireAuth), same as the existing /api/health,
// since monitoring tools generally can't authenticate.
const express = require("express");
const fs = require("fs");
const path = require("path");
const { db, DATA_DIR } = require("../db");

const router = express.Router();

router.get("/", (req, res) => {
  const checks = { database: "healthy", storage: "healthy" };

  try {
    db.prepare("SELECT 1").get();
  } catch {
    checks.database = "unhealthy";
  }

  // "storage" here means this service's own data directory (where its
  // SQLite file lives) is writable — a distinct signal from a successful
  // query below (a full disk or permissions issue can block writes while
  // reads still succeed). Not a check on file uploads — those belong to
  // apps/homecloud-backend's own health check as of MIGRATION_PLAN.md's
  // Phase 5, not this one.
  try {
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
  } catch {
    checks.storage = "unhealthy";
  }

  const overall = Object.values(checks).every((v) => v === "healthy") ? "healthy" : "degraded";
  const pkg = require(path.join(__dirname, "..", "..", "package.json"));

  res.status(overall === "healthy" ? 200 : 503).json({
    status: overall,
    version: pkg.version || "0.0.0",
    checks
  });
});

module.exports = router;
