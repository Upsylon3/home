const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const { db } = require("./db");
const { requireAuth } = require("./authMiddleware");
const { HOMECLOUD_URL } = require("./homecloudClient");
const deviceRoutes = require("./devices");
const syncRoutes = require("./sync");
const authProxyRoutes = require("./authProxy");

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));

const corsOrigins = (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim());
app.use(
  cors({
    origin: corsOrigins.length === 1 && corsOrigins[0] === "*" ? "*" : corsOrigins
  })
);
app.use(express.json());

// Not part of the /api surface — a plain, static info page for a human
// clicking "HomeSync" from Home's app list. HomeSync has no web frontend
// of its own (it's the Android app), so without this, that click would
// land nowhere useful. Deliberately just static HTML: no framework, no
// build step, nothing to test beyond "does this string render."
app.get("/", (req, res) => {
  res.type("html").send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HomeSync</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; background: #14171c; color: #e8e6e1; max-width: 480px; margin: 60px auto; padding: 0 20px; line-height: 1.5; }
    h1 { font-size: 20px; }
    code { background: #1d2128; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>HomeSync</h1>
  <p>Automatic phone backup for HomeCloud. Install the HomeSync Android app, sign in with your usual HomeCloud account, and choose what to back up — photos, videos, screenshots, or downloads.</p>
  <p>Backed-up files land in HomeCloud under folders like <code>Photos/2026/August</code>, and show up in HomeMedia automatically.</p>
</body>
</html>`);
});

// Public — lets the Android app (and a future HomeMonitor) confirm this
// service itself is reachable, distinct from whether HomeCloud is.
app.get("/api/homesync/health", (req, res) => {
  res.json({ status: "ok", homecloudUrl: HOMECLOUD_URL });
});

app.use("/api/homesync", authProxyRoutes);
app.use("/api/homesync", requireAuth, deviceRoutes);
app.use("/api/homesync", requireAuth, syncRoutes);

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  // multer's file-too-large error carries its own code rather than a
  // plain .status — translate it into the same shape every other error
  // here already uses, so the app doesn't need a special case for it.
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "That file is too large." });
  }
  res.status(err.status || 500).json({ error: err.status ? err.message : "Internal server error." });
});

module.exports = { app, db };
