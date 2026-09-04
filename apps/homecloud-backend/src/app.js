// Mirrors homecore/src/app.js's and its siblings' split (app wiring here,
// process concerns in server.js).
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const { db } = require("./db"); // ensures the data directory + db file exist before anything else runs
const { requireAuth, HOMECORE_URL } = require("@home/homecore-client");
const filesRoutes = require("./files");
const foldersRoutes = require("./folders");
const publicShareRoutes = require("./publicShare");
const internalUsageRoutes = require("./internalUsage");

if (!process.env.HOMECORE_INTERNAL_SECRET || process.env.HOMECORE_INTERNAL_SECRET === "change_this_to_a_long_random_string") {
  console.warn(
    "\n[homecloud-backend] WARNING: HOMECORE_INTERNAL_SECRET is unset or using the example value.\n" +
    "GET /internal/users/usage will reject every request (fails closed by design) until this\n" +
    "is set to a real, matching value on both this server and HomeCore.\n"
  );
}

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
  res.json({ status: "ok", homecoreUrl: HOMECORE_URL });
});

// requireAuth applied once, here, at mount time — not inside files.js/
// folders.js themselves (they used to call router.use(requireAuth)
// directly, back when they were part of homecore's own process and could
// check sessions locally). Same pattern HomeMedia/HomeSync/HomeNotes
// already use: this service has no identity of its own, so every request
// past this point has already been verified against HomeCore.
//
// Routes live under /api/homecloud/... to match the sibling apps'
// /api/<app>/... convention (HomeMedia, HomeSync, HomeNotes), rather
// than bare /api/files, /api/folders paths — see gateway/nginx.conf for
// how the gateway routes this prefix here.
app.use("/api/homecloud/files", requireAuth, filesRoutes);
app.use("/api/homecloud/folders", requireAuth, foldersRoutes);

// Deliberately NOT under /api/homecloud/ and deliberately NOT behind
// requireAuth — see publicShare.js's header comment. A share link is a
// URL handed to someone with no account at all; keeping its path short
// and stable matters more here than internal API-prefix consistency,
// since a link already sent to someone needs to keep working.
app.use("/api/share", publicShareRoutes);

// Deliberately NOT under /api — same reasoning as HomeCore's own
// /internal/events (see homecore/src/internalEvents.js's header comment):
// this is a machine-to-machine call (HomeCore's admin panel asking on
// behalf of the whole user list, not any one signed-in user), so it's
// authenticated by shared secret instead of a user's bearer token.
app.use("/internal/users/usage", internalUsageRoutes);

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : "Internal server error." });
});

module.exports = { app, db };
