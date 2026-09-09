const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const { db } = require("./db");
const { requireAuth, HOMECORE_URL } = require("@home/homecore-client");
const { router: vaultRoutes } = require("./vault");
const { router: itemRoutes } = require("./items");

const app = express();
app.use(helmet({ contentSecurityPolicy: false })); // real CSP is a project-wide, gateway-level decision — see docs/SECURITY.md's HomeVault prerequisites
app.disable("x-powered-by");

const corsOrigins = (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim());
app.use(
  cors({
    origin: corsOrigins.length === 1 && corsOrigins[0] === "*" ? "*" : corsOrigins
  })
);
app.use(express.json({ limit: "256kb" })); // generous for any single encrypted item; nowhere near HomeCloud's file-upload scale, so no reason to allow more

app.get("/api/homevault/health", (req, res) => {
  res.json({ status: "ok", homecoreUrl: HOMECORE_URL });
});

app.use("/api/homevault", requireAuth, vaultRoutes);
app.use("/api/homevault", requireAuth, itemRoutes);

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : "Internal server error." });
});

module.exports = { app, db };
