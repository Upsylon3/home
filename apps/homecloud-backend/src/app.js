// Mirrors homecore/src/app.js's and its siblings' split (app wiring here,
// process concerns in server.js). See db.js's header comment — this is
// Phase 1 of MIGRATION_PLAN.md, an intentionally near-empty shell.
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const { db } = require("./db"); // ensures the data directory + db file exist before anything else runs
const { requireAuth, HOMECLOUD_URL } = require("@home/homecore-client");

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));

const corsOrigins = (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim());
app.use(
  cors({
    origin: corsOrigins.length === 1 && corsOrigins[0] === "*" ? "*" : corsOrigins
  })
);
app.use(express.json());

// Public — no auth, so a monitoring tool (or Docker's own HEALTHCHECK,
// see the Dockerfile) can confirm this service itself is up, distinct
// from whether HomeCore (where auth delegation actually happens) is
// reachable.
app.get("/api/homecloud/health", (req, res) => {
  res.json({ status: "ok", homecoreUrl: HOMECLOUD_URL });
});

// Temporary — proves the auth-delegation pattern actually works end to
// end (not just imported and unused) before Phase 2 adds real routes
// here. Real HomeCloud requests through this service delegate to
// HomeCore exactly the same way HomeMedia/HomeSync/HomeNotes already do
// — see packages/homecore-client. Remove or repurpose once Phase 2 lands
// genuine authenticated routes (files, folders, shares) to replace it.
app.get("/api/homecloud/whoami", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : "Internal server error." });
});

module.exports = { app, db };
