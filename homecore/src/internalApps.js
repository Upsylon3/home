// GET /internal/apps — the list of registered applications, for services that
// need it but have no signed-in user to ask on behalf of.
//
// First user: HomeMonitor. It checks every app's health on a timer, with
// nobody logged in, so it can't call the browser-facing /api/core/apps (that
// one needs a person's token). This is the same registry, read by a trusted
// service using the shared secret (see ./internalAuth.js).
//
// Only what a health checker needs is returned: no permissions, no ids.
const express = require("express");
const { db } = require("./db");
const { requireInternalSecret } = require("./internalAuth");

const router = express.Router();

router.get("/", requireInternalSecret, (req, res) => {
  const apps = db
    .prepare("SELECT slug, name, health_url AS healthUrl, enabled FROM hc_applications ORDER BY name")
    .all()
    .map((row) => ({ slug: row.slug, name: row.name, healthUrl: row.healthUrl, enabled: row.enabled === 1 }));
  res.json({ apps });
});

module.exports = router;
