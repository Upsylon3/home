const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const { db } = require("./db");
const { requireAuth } = require("./authMiddleware");
const { HOMECLOUD_URL } = require("./homecloudClient");
const noteFolderRoutes = require("./noteFolders");
const noteRoutes = require("./notes");

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));

const corsOrigins = (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim());
app.use(
  cors({
    origin: corsOrigins.length === 1 && corsOrigins[0] === "*" ? "*" : corsOrigins
  })
);
app.use(express.json({ limit: "2mb" })); // notes can be long; the default express.json limit is comfortably smaller than a very long markdown document

app.get("/api/homenotes/health", (req, res) => {
  res.json({ status: "ok", homecloudUrl: HOMECLOUD_URL });
});

app.use("/api/homenotes", requireAuth, noteFolderRoutes);
app.use("/api/homenotes", requireAuth, noteRoutes);

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "That attachment is too large." });
  }
  res.status(err.status || 500).json({ error: err.status ? err.message : "Internal server error." });
});

module.exports = { app, db };
