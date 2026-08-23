// GET /api/core/permissions — HOME_MASTER_SPECIFICATION.md §7.4.
//
// This lists the permission catalog and, importantly, is NOT yet wired up
// as an enforcement layer on any route (in HomeCloud or HomeCore itself).
// Authorization today is still §28's Layer 1 (identity) + Layer 2 (role:
// admin/user), exactly as it was before this migration. This table and its
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
