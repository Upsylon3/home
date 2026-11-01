const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { requireAuth, HOMECORE_URL } = require("@home/homecore-client");
const { searchAll } = require("./search");

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));

const corsOrigins = (process.env.CORS_ORIGIN || "*").split(",").map((value) => value.trim());
app.use(cors({ origin: corsOrigins.length === 1 && corsOrigins[0] === "*" ? "*" : corsOrigins }));
app.use(express.json({ limit: "100kb" }));

app.get("/api/homebridge/health", (_req, res) => {
  res.json({ status: "ok", homecoreUrl: HOMECORE_URL });
});

app.get("/api/homebridge/search", requireAuth, async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (query.length < 2 || query.length > 100) {
    return res.status(400).json({ error: "Search query must contain 2-100 characters." });
  }

  const requestedLimit = req.query.limit === undefined ? 8 : Number(req.query.limit);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 12) {
    return res.status(400).json({ error: "limit must be an integer between 1 and 12." });
  }

  try {
    const payload = await searchAll({ query, limit: requestedLimit, token: req.token });
    res.json(payload);
  } catch (err) {
    console.error("[homebridge] search registry request failed:", err.message);
    res.status(502).json({ error: "HomeBridge could not reach HomeCore. Try again shortly." });
  }
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
app.use((err, _req, res, next) => {
  console.error("[homebridge] request failed:", err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : "Internal server error." });
});

module.exports = { app };
