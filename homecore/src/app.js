// ============================================================================
// TRANSITIONAL FILE — read this before changing anything below.
//
// This directory is named `homecore/`, but it is NOT yet the real,
// separated Tier 0 HomeCore described in docs/ARCHITECTURE.md. It is still the
// original HomeCloud file-storage backend (authRoutes, fileRoutes,
// folderRoutes, adminRoutes, activityRoutes, publicShareRoutes below) with
// the real HomeCore platform code (`./homecore`, mounted at /api/core)
// living inside it. One process, one database, one deploy — the rename
// happened, the architectural split has not.
//
// The plan to actually separate these into two independent services (own
// process, own database each, HomeCloud calling HomeCore for identity the
// same way HomeMedia/HomeSync/HomeNotes already do) is written down in
// MIGRATION_PLAN.md at the repo root. Do the split there, in a dedicated
// branch, with the test suite as your guardrail — not as a drive-by change
// while working on something else.
// ============================================================================
//
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
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const { db } = require("./db"); // ensures tables + data directories exist before anything else runs

const authRoutes = require("./auth");
const fileRoutes = require("./files");
const folderRoutes = require("./folders");
const adminRoutes = require("./admin");
// Moved into ./homecore/ in MIGRATION_PLAN.md's Phase 3 — same route
// (/api/activity), now backed by hc_activity_events instead of the
// now-dropped activity_log. See that file's header comment.
const activityRoutes = require("./homecore/homecloudActivity");
const publicShareRoutes = require("./publicShare");
// HomeCore v0 — shared platform (identity extras, application registry,
// permissions catalog, cross-app events/audit, health, notifications). See
// HOME_MASTER_SPECIFICATION.md §39-40. Required after HomeCloud's own
// routes so its startup seeding (registering HomeCloud as the first
// application) runs against an already-initialized database.
const homecoreRoutes = require("./homecore");
// New in Phase 3 — see internalEvents.js's header comment for why this is
// a separate, shared-secret-authenticated mount rather than another route
// under /api/core.
const internalEventsRoutes = require("./internalEvents");

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "change_this_to_a_long_random_string") {
  console.warn(
    "\n[homecloud] WARNING: JWT_SECRET is unset or using the example value.\n" +
    "Set a real secret in your .env file before exposing this server beyond your LAN.\n"
  );
}

if (!process.env.HOMECORE_INTERNAL_SECRET || process.env.HOMECORE_INTERNAL_SECRET === "change_this_to_a_long_random_string") {
  console.warn(
    "\n[homecloud] WARNING: HOMECORE_INTERNAL_SECRET is unset or using the example value.\n" +
    "POST /internal/events will reject every request (fails closed by design) until this\n" +
    "is set to a real, matching value on both this server and the app calling it.\n"
  );
}

const app = express();

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
app.use("/api/files", fileRoutes);
app.use("/api/folders", folderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/share", publicShareRoutes);
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
