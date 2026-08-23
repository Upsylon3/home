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

const router = express.Router();

const SLUG_RE = /^[a-z][a-z0-9-]{1,31}$/;

function findApp(idOrSlug) {
  if (/^\d+$/.test(idOrSlug)) {
    return db.prepare("SELECT * FROM hc_applications WHERE id = ?").get(Number(idOrSlug));
  }
  return db.prepare("SELECT * FROM hc_applications WHERE slug = ?").get(idOrSlug);
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
  const rows = db.prepare("SELECT * FROM hc_applications ORDER BY created_at ASC").all();
  res.json({ applications: rows.map(serializeApp) });
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
  if (db.prepare("SELECT id FROM hc_applications WHERE slug = ?").get(slug)) {
    return res.status(409).json(errorBody(req, "APP_EXISTS", "An application with that slug is already registered."));
  }

  const info = db
    .prepare(
      `INSERT INTO hc_applications (slug, name, description, version, icon, base_url, health_url, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(slug, name.trim(), description || null, version || "0.0.0", icon || null, baseUrl || null, healthUrl || null);

  if (Array.isArray(permissions)) {
    linkPermissions(info.lastInsertRowid, permissions.filter((p) => typeof p === "string"));
  }

  const row = db.prepare("SELECT * FROM hc_applications WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json({ application: serializeApp(row) });
});

router.patch("/:id", requireAdmin, (req, res) => {
  const row = findApp(req.params.id);
  if (!row) return res.status(404).json(errorBody(req, "APP_NOT_FOUND", "No application with that id or slug."));

  const { name, description, version, icon, baseUrl, healthUrl, enabled, permissions } = req.body || {};

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

  const updated = db.prepare("SELECT * FROM hc_applications WHERE id = ?").get(row.id);
  res.json({ application: serializeApp(updated) });
});

// §9 (application lifecycle) warns uninstalling must not destroy shared
// user data without an explicit destructive confirmation. v0 doesn't yet
// have per-application data to worry about beyond HomeCloud itself, so this
// only removes the registry row — but HomeCloud, being the storage
// foundation everything else in the ecosystem builds on (§3, §12), is not
// something v0 allows removing from the registry at all.
router.delete("/:id", requireAdmin, (req, res) => {
  const row = findApp(req.params.id);
  if (!row) return res.status(404).json(errorBody(req, "APP_NOT_FOUND", "No application with that id or slug."));
  if (row.slug === "homecloud") {
    return res
      .status(400)
      .json(errorBody(req, "CANNOT_REMOVE_CORE_APP", "HomeCloud is the storage foundation and can't be removed from the registry."));
  }
  db.prepare("DELETE FROM hc_applications WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

module.exports = router;
