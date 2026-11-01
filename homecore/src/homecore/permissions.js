// GET /api/core/permissions — HOME_MASTER_SPECIFICATION.md §7.4.
//
// This lists the application-manifest catalog, not a browser-session grant
// enforcement layer. Separate action/audience-bound delegation checks do
// not establish a caller-app identity or implement these catalog grants.
// Ordinary authorization uses identity, current roles and resource ownership.
// This table and its
// links to applications (§7.5) establish the foundation for Layer 3
// (per-permission checks) without a real per-user grant model yet — that's
// a deliberate, explicitly-scoped-out v0 limitation, not an oversight.
const express = require("express");
const { db } = require("../db");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT key, description FROM hc_permissions ORDER BY key ASC").all();
  res.json({ permissions: rows });
});

module.exports = router;
