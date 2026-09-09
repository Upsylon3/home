// HomeCore v0 — startup seeding.
//
// Registers the permission catalog from HOME_MASTER_SPECIFICATION.md §7.4
// and registers HomeCloud itself as the first application in the registry
// (§39: "register HomeCloud as the first application"), with the
// files.* permissions it actually uses declared on its manifest per §8.
//
// Safe to run on every startup: permissions use INSERT OR IGNORE, and each
// application row is updated in place (by slug) rather than duplicated if
// it already exists — e.g. so its `version` field stays in sync with
// package.json across restarts.
const { db } = require("../db");

const DEFAULT_PERMISSIONS = [
  ["files.read", "Read file and folder metadata and contents"],
  ["files.write", "Upload, move, and rename files and folders"],
  ["files.delete", "Delete or permanently purge files and folders"],
  ["files.share", "Create and revoke public share links"],
  ["users.read", "View other users' basic account info"],
  ["users.manage", "Create, disable, or modify other users' accounts"],
  ["system.read", "View system health and configuration"],
  ["system.manage", "Change system configuration"],
  ["applications.read", "View the installed application registry"],
  ["applications.manage", "Install, enable, disable, or remove applications"]
];

function seedPermissions() {
  const insert = db.prepare("INSERT OR IGNORE INTO hc_permissions (key, description) VALUES (?, ?)");
  for (const [key, description] of DEFAULT_PERMISSIONS) insert.run(key, description);
}

function grantPermissions(applicationId, keys) {
  const getPerm = db.prepare("SELECT id FROM hc_permissions WHERE key = ?");
  const link = db.prepare(
    "INSERT OR IGNORE INTO hc_application_permissions (application_id, permission_id) VALUES (?, ?)"
  );
  for (const key of keys) {
    const perm = getPerm.get(key);
    if (perm) link.run(applicationId, perm.id);
  }
}

// Every one of these four apps is a genuinely separate service (own
// container, own backend, own database) with no access to this database
// of its own to self-register into. Pre-seeding each one's registry entry
// here, from the one process that owns hc_applications, is the smallest
// way to get a working card in Home out of the box; a proper self-hosted
// "install an application" admin flow (§45's lifecycle: discover ->
// install -> register -> enable) is real future work, not a v1
// requirement. This is a deliberate, documented shortcut, not an
// architectural pattern to repeat for every future application without
// reconsidering it.
//
// HomeCore can't reach any of these four apps' own package.json to read
// their real version number the way its own health/system routes report
// on themselves — each is a separate service in its own container — so
// each one's version below is a fixed literal that needs updating by
// hand when that app's version changes. Fine for now; a registry that
// apps report their own version into is one of the things a real
// "install an application" flow above would also solve.
function seedHomecloudApplication() {
  // Path-shaped fallback for the same reason as its siblings below —
  // matches the gateway's /cloud/ route rather than a bare port. See
  // docs/DEPLOYMENT.md for when the fallback actually applies.
  const baseUrl = process.env.HOMECLOUD_FRONTEND_URL || "/cloud";

  const existing = db.prepare("SELECT id FROM hc_applications WHERE slug = 'homecloud'").get();
  if (existing) {
    db.prepare("UPDATE hc_applications SET base_url = ?, updated_at = datetime('now') WHERE id = ?").run(
      baseUrl,
      existing.id
    );
    grantPermissions(existing.id, ["files.read", "files.write", "files.delete", "files.share"]);
    return existing.id;
  }

  const info = db
    .prepare(
      `INSERT INTO hc_applications (slug, name, description, version, icon, base_url, health_url, enabled)
       VALUES ('homecloud', 'HomeCloud', 'Personal file storage', '0.1.0', '/icons/homecloud.svg', ?, '/api/homecloud/health', 1)`
    )
    .run(baseUrl);
  grantPermissions(info.lastInsertRowid, ["files.read", "files.write", "files.delete", "files.share"]);
  return info.lastInsertRowid;
}

function seedHomeMediaApplication() {
  // Path-shaped fallback for the same reason as seedHomecloudApplication above —
  // matches the gateway's /media/ route rather than the old pre-gateway port.
  const baseUrl = process.env.HOMEMEDIA_FRONTEND_URL || "/media";

  const existing = db.prepare("SELECT id FROM hc_applications WHERE slug = 'homemedia'").get();
  if (existing) {
    db.prepare("UPDATE hc_applications SET base_url = ?, updated_at = datetime('now') WHERE id = ?").run(
      baseUrl,
      existing.id
    );
    grantPermissions(existing.id, ["files.read", "files.write"]);
    return existing.id;
  }

  const info = db
    .prepare(
      `INSERT INTO hc_applications (slug, name, description, version, icon, base_url, health_url, enabled)
       VALUES ('homemedia', 'HomeMedia', 'Personal photo and video library', '0.1.0', '/icons/homemedia.svg', ?, '/api/homemedia/health', 1)`
    )
    .run(baseUrl);
  grantPermissions(info.lastInsertRowid, ["files.read", "files.write"]);
  return info.lastInsertRowid;
}

// HomeSync has no web frontend of its own (it's the Android app) — its
// base_url points at the small static info page homesync-backend serves
// at "/" (see homesync-backend/src/app.js) rather than a real launchable
// UI. Same pre-seeding shortcut and same caveat as seedHomeMediaApplication
// above: fine for a known, fixed set of docker-compose services, not a
// pattern to keep copy-pasting indefinitely.
function seedHomeSyncApplication() {
  // Path-shaped fallback matching the gateway's /sync/ route (HomeSync's
  // plain info page — see homesync-backend/src/app.js) rather than the
  // old pre-gateway port.
  const baseUrl = process.env.HOMESYNC_INFO_URL || "/sync";

  const existing = db.prepare("SELECT id FROM hc_applications WHERE slug = 'homesync'").get();
  if (existing) {
    db.prepare("UPDATE hc_applications SET base_url = ?, updated_at = datetime('now') WHERE id = ?").run(
      baseUrl,
      existing.id
    );
    grantPermissions(existing.id, ["files.read", "files.write"]);
    return existing.id;
  }

  const info = db
    .prepare(
      `INSERT INTO hc_applications (slug, name, description, version, icon, base_url, health_url, enabled)
       VALUES ('homesync', 'HomeSync', 'Automatic phone backup', '0.1.0', '/icons/homesync.svg', ?, '/api/homesync/health', 1)`
    )
    .run(baseUrl);
  grantPermissions(info.lastInsertRowid, ["files.read", "files.write"]);
  return info.lastInsertRowid;
}

// HomeNotes follows the exact same pre-seeding shortcut as HomeMedia and
// HomeSync above — its own separate service, own registry entry, real
// launchable web frontend (unlike HomeSync's info-page base_url).
function seedHomeNotesApplication() {
  // Path-shaped fallback matching the gateway's /notes/ route, same reasoning
  // as the three siblings above.
  const baseUrl = process.env.HOMENOTES_FRONTEND_URL || "/notes";

  const existing = db.prepare("SELECT id FROM hc_applications WHERE slug = 'homenotes'").get();
  if (existing) {
    db.prepare("UPDATE hc_applications SET base_url = ?, updated_at = datetime('now') WHERE id = ?").run(
      baseUrl,
      existing.id
    );
    grantPermissions(existing.id, ["files.read", "files.write"]);
    return existing.id;
  }

  const info = db
    .prepare(
      `INSERT INTO hc_applications (slug, name, description, version, icon, base_url, health_url, enabled)
       VALUES ('homenotes', 'HomeNotes', 'Personal Markdown notes', '0.1.0', '/icons/homenotes.svg', ?, '/api/homenotes/health', 1)`
    )
    .run(baseUrl);
  grantPermissions(info.lastInsertRowid, ["files.read", "files.write"]);
  return info.lastInsertRowid;
}

// The first application with no dependency on HomeCloud at all — it
// stores its own encrypted blobs, never a real file (see
// apps/homevault-backend/src/db.js). Its permission grant below is
// deliberately empty: everything it does is scoped to its own database
// through ordinary ownership checks, not through anything in
// DEFAULT_PERMISSIONS above (none of which describe "read/write your
// own vault" — that's not a cross-app concern the permission catalog
// needs to know about).
function seedHomevaultApplication() {
  const baseUrl = process.env.HOMEVAULT_FRONTEND_URL || "/vault";

  const existing = db.prepare("SELECT id FROM hc_applications WHERE slug = 'homevault'").get();
  if (existing) {
    db.prepare("UPDATE hc_applications SET base_url = ?, updated_at = datetime('now') WHERE id = ?").run(
      baseUrl,
      existing.id
    );
    return existing.id;
  }

  const info = db
    .prepare(
      `INSERT INTO hc_applications (slug, name, description, version, icon, base_url, health_url, enabled)
       VALUES ('homevault', 'HomeVault', 'Client-side-encrypted password and secrets manager', '0.1.0', '/icons/homevault.svg', ?, '/api/homevault/health', 1)`
    )
    .run(baseUrl);
  return info.lastInsertRowid;
}

function runSeed() {
  seedPermissions();
  seedHomecloudApplication();
  seedHomeMediaApplication();
  seedHomeSyncApplication();
  seedHomeNotesApplication();
  return seedHomevaultApplication();
}

module.exports = { runSeed, DEFAULT_PERMISSIONS };
