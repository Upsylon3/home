// Express app construction, split out from server.js so it can be
// required by the test suite (test/helpers/app.js) without starting a
// real network listener, trash-purge timer, or process-level signal/error
// handlers — none of which belong to more than one running instance at a
// time. server.js is the only thing that should call app.listen() on
// this; everything here is pure app wiring.
//
// Deliberately does NOT call `require("dotenv").config()` — that's a
// process-entrypoint concern (server.js does it, before requiring this
// file) and must never run implicitly when this module is required from a
// test process, where a developer's real backend/.env sitting on disk
// should not silently leak into what's supposed to be an isolated test
// database/config.
//
// This is the real, separated Tier 0 HomeCore described in
// docs/ARCHITECTURE.md — identity, sessions, permissions, the application
// registry, and cross-app events/audit. File/folder/share storage lives
// entirely in apps/homecloud-backend, its own independent service with
// its own database.
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const { db } = require("./db"); // ensures tables + data directories exist before anything else runs

const authRoutes = require("./auth");
const adminRoutes = require("./admin");
// Same route (/api/activity), backed by the shared hc_activity_events
// table rather than a HomeCloud-only log table. See that file's header
// comment for the full picture of who writes to it.
const activityRoutes = require("./homecore/homecloudActivity");
// HomeCore v0 — shared platform (identity extras, application registry,
// permissions catalog, cross-app events/audit, health, notifications). See
// HOME_MASTER_SPECIFICATION.md §39-40. Required after HomeCloud's own
// routes so its startup seeding (registering HomeCloud as the first
// application) runs against an already-initialized database.
const homecoreRoutes = require("./homecore");
// See internalEvents.js's header comment for why this is a separate,
// shared-secret-authenticated mount rather than another route under
// /api/core.
const internalEventsRoutes = require("./internalEvents");

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "change_this_to_a_long_random_string") {
  console.warn(
    "\n[homecore] WARNING: JWT_SECRET is unset or using the example value.\n" +
    "Set a real secret in your .env file before exposing this server beyond your LAN.\n"
  );
}

if (!process.env.HOMECORE_INTERNAL_SECRET || process.env.HOMECORE_INTERNAL_SECRET === "change_this_to_a_long_random_string") {
  console.warn(
    "\n[homecore] WARNING: HOMECORE_INTERNAL_SECRET is unset or using the example value.\n" +
    "POST /internal/events will reject every request (fails closed by design) until this\n" +
    "is set to a real, matching value on both this server and the app calling it.\n"
  );
}

const { TRUSTED_PROXIES } = require("./rateLimiter");

const app = express();
app.set("trust proxy", TRUSTED_PROXIES);

// Sets a battery of protective HTTP response headers (blocks MIME sniffing,
// disables framing to prevent clickjacking, etc). We disable the default
// Content-Security-Policy here because it's tuned for server-rendered HTML
// pages, not a decoupled API — the frontend's own nginx config is a better
// place for CSP, since nginx is what actually serves HTML.
app.use(helmet({ contentSecurityPolicy: false }));

// Note: cors() treats a bare "*" string specially (allow every origin),
// but an *array* containing "*" is treated as a literal origin to match
// against — which never matches a real browser's Origin header, so it
// would silently block every cross-origin request instead of allowing
// them. Handling the single-wildcard case separately avoids that trap.
const corsOrigins = (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim());
app.use(
  cors({
    origin: corsOrigins.length === 1 && corsOrigins[0] === "*" ? "*" : corsOrigins
  })
);
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/core", homecoreRoutes);
// Deliberately not under /api — see internalEvents.js's header comment for
// why this is machine-to-machine (shared-secret) rather than user-facing.
app.use("/internal/events", internalEventsRoutes);

// Catches routes that don't exist, so a typo'd or outdated frontend request
// gets a clean 404 instead of falling through to the error handler below.
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

// Fallback error handler so unexpected errors don't leak stack traces to
// clients. Anything asyncHandler catches ends up here via next(err).
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal server error." });
});

module.exports = { app, db };
