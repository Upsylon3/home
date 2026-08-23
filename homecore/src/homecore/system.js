// GET /api/core/system — HOME_MASTER_SPECIFICATION.md §5.1 "System" (version
// information). Mounted with requireAuth in index.js; no admin gate for v0
// since this is read-only, non-sensitive info any signed-in user can see.
const express = require("express");
const os = require("os");
const path = require("path");

const router = express.Router();

router.get("/", (req, res) => {
  const pkg = require(path.join(__dirname, "..", "..", "package.json"));
  res.json({
    version: pkg.version || "0.0.0",
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    platform: os.platform()
  });
});

module.exports = router;
