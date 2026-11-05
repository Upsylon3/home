// Trusted manifests for code already included in the HOME distribution.
// Core never downloads packages, fetches manifests or controls Docker.
const { db } = require("../db");
const definitions = [
  ["homecloud", "HomeCloud", "Personal file storage", "HOMECLOUD_FRONTEND_URL", "/cloud", [], ["files.read", "files.write", "files.delete", "files.share"]],
  ["homemedia", "HomeMedia", "Personal photo and video library", "HOMEMEDIA_FRONTEND_URL", "/media", ["homecloud"], ["files.read", "files.write"]],
  ["homesync", "HomeSync", "Automatic phone backup", "HOMESYNC_INFO_URL", "/sync", ["homecloud"], ["files.read", "files.write"]],
  ["homenotes", "HomeNotes", "Personal Markdown notes", "HOMENOTES_FRONTEND_URL", "/notes", ["homecloud"], ["files.read", "files.write"]],
  ["hometasks", "HomeTasks", "Tasks and projects", "HOMETASKS_FRONTEND_URL", "/tasks", [], []],
  ["homemonitor", "HomeMonitor", "Server, services and backups", "HOMEMONITOR_FRONTEND_URL", "/monitor", [], []],
  ["homevault", "HomeVault", "Client-side-encrypted password and secrets manager", "HOMEVAULT_FRONTEND_URL", "/vault", [], []]
];

function catalog() {
  return definitions.map(([slug, name, description, variable, baseUrl, dependencies, permissions]) => ({
    manifestVersion: 1, slug, name, description, version: "0.1.0", icon: `/icons/${slug}.svg`,
    baseUrl: process.env[variable] || baseUrl, healthUrl: `/api/${slug}/health`,
    dependencies: [...dependencies], permissions: [...permissions]
  }));
}
function failure(code, message, status = 409) { return Object.assign(new Error(message), { code, status }); }
function dependenciesFor(slug) { return catalog().find(app => app.slug === slug)?.dependencies || []; }
function requireDependencies(slug, enabled = false) {
  for (const dependency of dependenciesFor(slug)) {
    const row = db.prepare("SELECT installed, enabled FROM hc_applications WHERE slug = ?").get(dependency);
    if (!row?.installed || (enabled && !row.enabled)) {
      const name = catalog().find(app => app.slug === dependency)?.name || dependency;
      throw failure("DEPENDENCY_REQUIRED", `Install${enabled ? " and enable" : ""} ${name} first.`);
    }
  }
}
function requireNoDependants(slug, enabledOnly = false) {
  const dependants = catalog().filter(app => app.dependencies.includes(slug));
  for (const dependant of dependants) {
    const row = db.prepare("SELECT installed, enabled FROM hc_applications WHERE slug = ?").get(dependant.slug);
    if (row?.installed && (!enabledOnly || row.enabled)) {
      throw failure("APP_IN_USE", `${dependant.name} depends on this application. ${enabledOnly ? "Disable" : "Uninstall"} it first.`);
    }
  }
}
function audit(actor, slug, operation) {
  if (actor == null) return;
  db.prepare(`INSERT INTO hc_activity_events (actor_user_id, event_type, target_type, target_id)
    VALUES (?, ?, 'application', ?)`).run(actor, `homecore.application.${operation}`, slug);
}
function install(slug, actor = null) {
  const manifest = catalog().find(app => app.slug === slug);
  if (!manifest) throw failure("APP_NOT_AVAILABLE", "This application is not included in this server's catalog.", 404);
  return db.transaction(() => {
    const existing = db.prepare("SELECT * FROM hc_applications WHERE slug = ?").get(slug);
    if (existing?.installed) throw failure("APP_EXISTS", "This application is already installed.");
    requireDependencies(slug);
    const values = [manifest.name, manifest.description, manifest.version, manifest.icon, manifest.baseUrl, manifest.healthUrl];
    let id;
    if (existing) {
      id = existing.id;
      db.prepare(`UPDATE hc_applications SET name=?, description=?, version=?, icon=?, base_url=?, health_url=?,
        installed=1, enabled=0, updated_at=datetime('now') WHERE id=?`).run(...values, id);
    } else {
      id = db.prepare(`INSERT INTO hc_applications (name, description, version, icon, base_url, health_url, slug, installed, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)`).run(...values, slug).lastInsertRowid;
    }
    db.prepare("DELETE FROM hc_application_permissions WHERE application_id = ?").run(id);
    for (const key of manifest.permissions) {
      db.prepare(`INSERT INTO hc_application_permissions (application_id, permission_id)
        SELECT ?, id FROM hc_permissions WHERE key = ?`).run(id, key);
    }
    audit(actor, slug, "installed");
    return db.prepare("SELECT * FROM hc_applications WHERE id = ?").get(id);
  }).immediate();
}
module.exports = { catalog, install, dependenciesFor, requireDependencies, requireNoDependants, audit };
