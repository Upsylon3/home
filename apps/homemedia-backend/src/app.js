// Mirrors homecore/src/app.js's split (app wiring here, process concerns in
// server.js) — built that way from the start this time, having learned
// from having to retrofit it onto HomeCloud's backend.
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const { db } = require("./db"); // ensures tables + data directories exist before anything else runs
const { requireAuth, HOMECORE_URL } = require("@home/homecore-client");
const libraryRoutes = require("./library");
const collectionsRoutes = require("./collections");
const uploadRoutes = require("./upload");
const { ticketRouter, streamRouter } = require("./stream");

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
  res.json({ status: "ok", homecoreUrl: HOMECORE_URL });
});

// The stream route is registered BEFORE the requireAuth mounts below on
// purpose: Express tries routes in order, and a <video>/<audio>/<img> tag
// can't send a login header, so its ticket (see stream.js) is the only
// credential it has. Moving this line below them would 401 every playback.
app.use("/api/homemedia/stream", streamRouter);

app.use("/api/homemedia", requireAuth, uploadRoutes);
app.use("/api/homemedia", requireAuth, ticketRouter);
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
