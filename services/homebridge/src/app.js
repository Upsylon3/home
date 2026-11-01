const express = require("express");
const helmet = require("helmet");
const { requireAuth, HOMECORE_URL } = require("@home/homecore-client");
const { origin, getJSON } = require("./upstream");

const SOURCES = {
  homenotes: { name: "Notes", key: "notes", path: "/api/homenotes/notes" },
  hometasks: { name: "Tasks", key: "tasks", path: "/api/hometasks/tasks", status: "all" }
};
const RESULT_LIMIT = 20;

function normalize(row, source) {
  if (!row || !Number.isSafeInteger(row.id) || row.id <= 0 || typeof row.title !== "string") {
    throw new Error("Invalid source item.");
  }
  const excerpt = source === "homenotes" ? row.excerpt : row.notes;
  if (typeof excerpt !== "string") throw new Error("Invalid source excerpt.");
  return {
    source, id: row.id, title: row.title.slice(0, 240), excerpt: excerpt.slice(0, 160),
    href: source === "homenotes" ? `/notes/notes/${row.id}`
      : `/tasks/${row.completedAt ? "done" : "all"}?task=${row.id}`
  };
}

function createApp({
  homecoreUrl = HOMECORE_URL,
  notesUrl = process.env.HOMENOTES_INTERNAL_URL || "http://homenotes-backend:4400",
  tasksUrl = process.env.HOMETASKS_INTERNAL_URL || "http://hometasks-backend:4700",
  timeoutMs = 5000, maxBytes = 1024 * 1024
} = {}) {
  const core = origin(homecoreUrl);
  const origins = { homenotes: origin(notesUrl), hometasks: origin(tasksUrl) };
  const limits = { timeoutMs, maxBytes };
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  app.use(express.json({ limit: "4kb" }));
  app.get("/api/homebridge/health", (req, res) => res.json({ status: "ok" }));
  app.post("/api/homebridge/search", requireAuth, async (req, res) => {
    const { query, sources } = req.body || {};
    if (typeof query !== "string" || query.trim().length < 2 || query.trim().length > 200 ||
        !Array.isArray(sources) || sources.length < 1 || sources.length > 2 ||
        sources.some(source => typeof source !== "string" || !Object.hasOwn(SOURCES, source)) ||
        new Set(sources).size !== sources.length) {
      return res.status(400).json({ error: "Enter 2–200 characters and choose Notes and/or Tasks once each." });
    }
    let applications;
    try {
      const registry = await getJSON(`${core}/api/core/apps`, req.token, limits);
      applications = registry.applications;
      if (!Array.isArray(applications) || applications.some(item => !item ||
          typeof item.slug !== "string" || typeof item.enabled !== "boolean")) {
        throw new Error("Invalid registry response.");
      }
    } catch (error) {
      return res.status(error.status === 401 ? 401 : 502).json({ error:
        error.status === 401 ? "Please sign in again." : "Couldn't check available applications. Try again." });
    }
    const groups = await Promise.all(sources.map(async source => {
      const definition = SOURCES[source];
      const base = { source, name: definition.name, results: [], limited: false };
      if (!applications.some(item => item.slug === source && item.enabled)) {
        return { ...base, status: "disabled" };
      }
      try {
        const url = new URL(definition.path, origins[source]);
        url.searchParams.set("search", query.trim());
        if (definition.status) url.searchParams.set("status", definition.status);
        const data = await getJSON(url, req.token, limits);
        const rows = data[definition.key];
        if (!Array.isArray(rows)) throw new Error("Invalid source response.");
        return { ...base, status: "ok", limited: rows.length > RESULT_LIMIT,
          results: rows.slice(0, RESULT_LIMIT).map(row => normalize(row, source)) };
      } catch {
        // Never expose upstream response bodies, queries, tokens or addresses.
        return { ...base, status: "unavailable" };
      }
    }));
    res.json({ groups, limit: RESULT_LIMIT });
  });
  app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status === 413 ? 413 : error.type === "entity.parse.failed" ? 400 : 500;
    res.status(status).json({ error: status === 413 ? "Search request is too large." : "Invalid search request." });
  });
  return app;
}

module.exports = { createApp };
