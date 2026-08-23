// Mirrors backend/src/app.js's split (app wiring here, process concerns in
// server.js) — built that way from the start this time, having learned
// from having to retrofit it onto HomeCloud's backend.
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const { db } = require("./db"); // ensures tables + data directories exist before anything else runs
const { requireAuth } = require("./authMiddleware");
const { HOMECLOUD_URL } = require("./homecloudClient");
const libraryRoutes = require("./library");
const collectionsRoutes = require("./collections");

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));

const corsOrigins = (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim());
app.use(
  cors({
    origin: corsOrigins.length === 1 && corsOrigins[0] === "*" ? "*" : corsOrigins
  })
);
app.use(express.json());

// Public — no auth, so a monitoring tool (or a person's browser, before
// they've even logged in) can confirm this service itself is up, distinct
// from whether HomeCloud (its storage foundation) is reachable.
app.get("/api/homemedia/health", (req, res) => {
  res.json({ status: "ok", homecloudUrl: HOMECLOUD_URL });
});

app.use("/api/homemedia", requireAuth, libraryRoutes);
app.use("/api/homemedia", requireAuth, collectionsRoutes);

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : "Internal server error." });
});

module.exports = { app, db };
