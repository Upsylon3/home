// GET /api/core/permissions — HOME_MASTER_SPECIFICATION.md §7.4.
//
// Application access keys enforce the supported files.* subset against both
// manifest declarations and explicit owner consent. Other catalog entries are
// not issuable key permissions. Trusted browser sessions retain identity/role/
// ownership checks and share an origin; the catalog does not sandbox that UI.
const express = require("express");
const { db } = require("../db");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT key, description FROM hc_permissions ORDER BY key ASC").all();
  res.json({ permissions: rows });
});

module.exports = router;
