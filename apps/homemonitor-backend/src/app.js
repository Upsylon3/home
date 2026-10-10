// The Express app, built but NOT started (server.js starts it; tests start it
// on a random port). createApp takes the pieces it needs so tests can supply
// fakes.
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const { requireAuth, HOMECORE_URL } = require("@home/homecore-client");
const { asyncHandler } = require("./asyncHandler");
const { forecastFull } = require("./forecast");

// HomeMonitor shows server internals (disk, services, backups), so it is for
// administrators only. This runs AFTER requireAuth has filled in req.user.
function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "HomeMonitor is for administrators only." });
  }
  next();
}

// A whole number from a query parameter, clamped to a sensible range.
function clampedInt(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function createApp({ monitor, history, now = Date.now }) {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  const corsOrigins = (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim());
  app.use(cors({ origin: corsOrigins.length === 1 && corsOrigins[0] === "*" ? "*" : corsOrigins }));
  app.use(express.json({ limit: "100kb" }));

  // Health check: no login, so Docker and other monitors can call it.
  app.get("/api/homemonitor/health", (req, res) => {
    res.json({ status: "ok", homecoreUrl: HOMECORE_URL });
  });

  const guarded = express.Router();
  guarded.use(requireAuth, requireAdmin);

  // GET /status — the latest snapshot plus active alerts.
  guarded.get(
    "/status",
    asyncHandler(async (req, res) => {
      res.json(await monitor.getStatus());
    })
  );

  // GET /history?hours=24 — chart samples, oldest first. (1 to 48 hours.)
  guarded.get("/history", (req, res) => {
    const hours = clampedInt(req.query.hours, 24, 1, 48);
    res.json({ hours, samples: history.getSamples(Math.floor(now() / 1000), hours) });
  });

  // GET /disk-growth?days=90 — daily disk usage per disk, plus a rough
  // "full in about N days" forecast when there is enough history.
  guarded.get("/disk-growth", (req, res) => {
    const days = clampedInt(req.query.days, 90, 7, 365);
    const today = new Date(now()).toISOString().slice(0, 10);
    const disks = history.getDiskGrowth(today, days).map((disk) => ({ ...disk, forecast: forecastFull(disk.points) }));
    res.json({ days, disks });
  });

  app.use("/api/homemonitor", guarded);

  app.use("/api", (req, res) => {
    res.status(404).json({ error: "Not found." });
  });

  // Error handler: show a message only for errors that carry their own status
  // (like "invalid JSON"); for surprises say something generic.
  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : "Internal server error." });
  });

  return app;
}

module.exports = { createApp };
