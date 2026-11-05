// /api/core/apps/* — HOME_MASTER_SPECIFICATION.md §5.1 "Applications" /
// §7.3 / §40. Listing is available to any signed-in user (Home's dashboard
// needs to show installed apps to everyone); registering, editing, and
// removing applications requires admin, matching the authorization layers
// in §28.
//
// The spec's milestone list writes these as /api/core/apps/:id. Rather than
// forcing callers to know a numeric id, :id here accepts either the numeric
// id or the application's slug (e.g. "homecloud") — slugs are what the rest
// of the spec actually references applications by (§7.3, §8 manifests), so
// this is friendlier without breaking the documented URL shape.
const express = require("express");
const { db } = require("../db");
const { requireAdmin } = require("../middleware/authMiddleware");
const { errorBody } = require("./errors");
const lifecycle = require("./catalog");
const delegations = require("./delegationStore").createDelegationStore(db);

const router = express.Router();

const SLUG_RE = /^[a-z][a-z0-9-]{1,31}$/;

function findApp(idOrSlug) {
  if (/^\d+$/.test(idOrSlug)) {
    return db.prepare("SELECT * FROM hc_applications WHERE id = ? AND installed = 1").get(Number(idOrSlug));
  }
  return db.prepare("SELECT * FROM hc_applications WHERE slug = ? AND installed = 1").get(idOrSlug);
}

function serializeApp(row) {
  const permissions = db
    .prepare(
      `SELECT p.key FROM hc_application_permissions ap
       JOIN hc_permissions p ON p.id = ap.permission_id
       WHERE ap.application_id = ?
       ORDER BY p.key ASC`
    )
    .all(row.id)
    .map((r) => r.key);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    version: row.version,
    icon: row.icon,
    baseUrl: row.base_url,
    healthUrl: row.health_url,
    enabled: Boolean(row.enabled),
    installed: Boolean(row.installed),
    dependencies: lifecycle.dependenciesFor(row.slug),
    permissions,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function linkPermissions(applicationId, keys) {
  const getPerm = db.prepare("SELECT id FROM hc_permissions WHERE key = ?");
  const link = db.prepare(
    "INSERT OR IGNORE INTO hc_application_permissions (application_id, permission_id) VALUES (?, ?)"
  );
  for (const key of keys) {
    const perm = getPerm.get(key);
    if (perm) link.run(applicationId, perm.id);
  }
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM hc_applications WHERE installed = 1 ORDER BY created_at ASC").all();
  res.json({ applications: rows.map(serializeApp) });
});

const catalogRouter = express.Router();
catalogRouter.get("/", (req, res) => {
  const applications = lifecycle.catalog().map(manifest => {
    const row = findApp(manifest.slug);
    return { ...manifest, installed: !!row, enabled: !!row?.enabled };
  });
  res.json({ applications });
});

router.post("/:id/install", requireAdmin, (req, res) => {
  if (Array.isArray(req.body) || Object.keys(req.body || {}).length) return res.status(400).json(errorBody(req, "INVALID_MANIFEST", "Install accepts no manifest overrides."));
  const row = lifecycle.install(req.params.id, req.user.id);
  res.status(201).json({ application: serializeApp(row) });
});

router.get("/:id", (req, res) => {
  const row = findApp(req.params.id);
  if (!row) return res.status(404).json(errorBody(req, "APP_NOT_FOUND", "No application with that id or slug."));
  res.json({ application: serializeApp(row) });
});

router.post("/", requireAdmin, (req, res) => {
  const { slug, name, description, version, icon, baseUrl, healthUrl, permissions } = req.body || {};

  if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
    return res
      .status(400)
      .json(errorBody(req, "INVALID_SLUG", "slug must start with a letter and contain only lowercase letters, numbers, and dashes."));
  }
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json(errorBody(req, "INVALID_NAME", "name is required."));
  }
  const existing = db.prepare("SELECT * FROM hc_applications WHERE slug = ?").get(slug);
  if (existing?.installed) {
    return res.status(409).json(errorBody(req, "APP_EXISTS", "An application with that slug is already registered."));
  }
  if (lifecycle.catalog().some(app => app.slug === slug)) {
    return res.status(409).json(errorBody(req, "USE_CATALOG", "Install bundled applications from the catalog."));
  }

  const row = db.transaction(() => {
    const existing = db.prepare("SELECT * FROM hc_applications WHERE slug = ?").get(slug);
    if (existing?.installed) throw Object.assign(new Error("An application with that slug is already registered."), { status: 409, code: "APP_EXISTS" });
    const info = existing ? { lastInsertRowid: existing.id } : db
      .prepare(
        `INSERT INTO hc_applications (slug, name, description, version, icon, base_url, health_url, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
      )
      .run(slug, name.trim(), description || null, version || "0.0.0", icon || null, baseUrl || null, healthUrl || null);
    if (existing) {
      db.prepare(`UPDATE hc_applications SET name=?, description=?, version=?, icon=?, base_url=?, health_url=?,
        installed=1, enabled=1, updated_at=datetime('now') WHERE id=?`)
        .run(name.trim(), description || null, version || "0.0.0", icon || null, baseUrl || null, healthUrl || null, existing.id);
      db.prepare("DELETE FROM hc_application_permissions WHERE application_id = ?").run(existing.id);
    }

    if (Array.isArray(permissions)) {
      linkPermissions(info.lastInsertRowid, permissions.filter((p) => typeof p === "string"));
    }

    lifecycle.audit(req.user.id, slug, "registered");
    return db.prepare("SELECT * FROM hc_applications WHERE id = ?").get(info.lastInsertRowid);
  }).immediate();
  res.status(201).json({ application: serializeApp(row) });
});

router.patch("/:id", requireAdmin, (req, res) => {
  const row = findApp(req.params.id);
  if (!row) return res.status(404).json(errorBody(req, "APP_NOT_FOUND", "No application with that id or slug."));

  const { name, description, version, icon, baseUrl, healthUrl, enabled, permissions } = req.body || {};

  db.transaction(() => {
    if (!findApp(req.params.id)) throw Object.assign(new Error("Application is no longer installed."), { status: 404, code: "APP_NOT_FOUND" });
    if (enabled === true) lifecycle.requireDependencies(row.slug, true);
    if (enabled === false) lifecycle.requireNoDependants(row.slug, true);
    db.prepare(
      `UPDATE hc_applications SET
         name = COALESCE(?, name),
         description = COALESCE(?, description),
         version = COALESCE(?, version),
         icon = COALESCE(?, icon),
         base_url = COALESCE(?, base_url),
         health_url = COALESCE(?, health_url),
         enabled = COALESCE(?, enabled),
         updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      name ?? null,
      description ?? null,
      version ?? null,
      icon ?? null,
      baseUrl ?? null,
      healthUrl ?? null,
      typeof enabled === "boolean" ? (enabled ? 1 : 0) : null,
      row.id
    );

    if (Array.isArray(permissions)) {
      linkPermissions(row.id, permissions.filter((p) => typeof p === "string"));
    }
    if (typeof enabled === "boolean" && enabled !== Boolean(row.enabled)) lifecycle.audit(req.user.id, row.slug, enabled ? "enabled" : "disabled");
  }).immediate();

  const updated = db.prepare("SELECT * FROM hc_applications WHERE id = ?").get(row.id);
  res.json({ application: serializeApp(updated) });
});

// Uninstall only changes Core lifecycle state. Keep IDs, history and all app
// databases/files. Reinstallation requires a separate install and enable action.
router.delete("/:id", requireAdmin, (req, res) => {
  const row = findApp(req.params.id);
  if (!row) return res.status(404).json(errorBody(req, "APP_NOT_FOUND", "No application with that id or slug."));
  if (row.slug === "homecloud") {
    return res
      .status(400)
      .json(errorBody(req, "CANNOT_REMOVE_CORE_APP", "HomeCloud is the storage foundation and can't be removed from the registry."));
  }
  db.transaction(() => {
    if (!findApp(req.params.id)) throw Object.assign(new Error("Application is no longer installed."), { status: 404, code: "APP_NOT_FOUND" });
    lifecycle.requireNoDependants(row.slug);
    db.prepare("UPDATE hc_applications SET installed=0, enabled=0, updated_at=datetime('now') WHERE id=?").run(row.id);
    // Uninstall must not make old automation authority usable after reinstall.
    delegations.revokeApplication(row.slug, req.user.id);
    lifecycle.audit(req.user.id, row.slug, "uninstalled");
  }).immediate();
  res.json({ ok: true, dataPreserved: true });
});

router.use((error, req, res, next) => {
  if (error.status && error.code) return res.status(error.status).json(errorBody(req, error.code, error.message));
  next(error);
});

module.exports = router;
module.exports.catalogRouter = catalogRouter;
