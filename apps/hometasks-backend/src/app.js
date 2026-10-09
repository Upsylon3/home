// The Express app, built but NOT started. server.js starts it; tests start
// it on a random port. Keeping "building the app" and "listening on a port"
// in separate files is what lets tests run it without side effects.
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const { db } = require("./db");
// requireAuth asks HomeCore "is this token valid, and who is it?" and puts the
// answer on req.user. HomeTasks never checks passwords or tokens itself.
const { requireAuth, HOMECORE_URL } = require("@home/homecore-client");
const projectRoutes = require("./projects");
const taskRoutes = require("./tasks");

const app = express();

// helmet adds a set of safe HTTP security headers to every response.
app.use(helmet({ contentSecurityPolicy: false }));

// CORS decides which websites' JavaScript may call this API. "*" means any;
// fine while auth is a Bearer token (no cookies), see docs/SECURITY.md.
const corsOrigins = (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim());
app.use(cors({ origin: corsOrigins.length === 1 && corsOrigins[0] === "*" ? "*" : corsOrigins }));

// Lets handlers read JSON request bodies as req.body. Tasks are tiny, so a
// small limit is plenty and stops anyone sending a giant body.
app.use(express.json({ limit: "100kb" }));

// Health check: no login needed. Docker calls this to learn whether the
// container is working.
app.get("/api/hometasks/health", (req, res) => {
  res.json({ status: "ok", homecoreUrl: HOMECORE_URL });
});

// Everything below needs a valid login.
app.use("/api/hometasks", requireAuth, projectRoutes);
app.use("/api/hometasks", requireAuth, taskRoutes);

// Any other /api/... address: a clean JSON 404 instead of an HTML error page.
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

// The error handler (four parameters is how Express recognises one). Anything
// thrown or passed to next(err) lands here. We show the message only for
// errors that carry their own status (like "invalid JSON"); for surprises we
// say something generic so internal details never leak to the client.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : "Internal server error." });
});

module.exports = { app, db };
