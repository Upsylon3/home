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

function seedHomecloudApplication() {
  // eslint-disable-next-line global-require -- read lazily so this file has no import-time dependency on package.json's exact shape
  const pkg = require("../../package.json");
  const version = pkg.version || "0.0.0";
  // base_url is where HomeCloud's own frontend is served — what Home's
  // "Launch" links actually navigate to. docker-compose.yml sets
  // HOMECLOUD_FRONTEND_URL=/cloud/ (a *path*, not a full URL) because the
  // gateway now puts every app behind one origin — see gateway/nginx.conf.
  // The fallback below only kicks in when this file runs OUTSIDE Docker
  // (§4 of docs/SETUP.md, e.g. `npm run dev` inside homecore/ directly), where
  // there is no gateway in front of it yet, so a real host:port is needed
  // instead of a path. IMPORTANT: this must stay a *path-shaped* default
  // ("/cloud") to match the gateway once you *do* run behind it — a bare
  // "http://localhost:8080" fallback here would be silently wrong in
  // Docker if the env var were ever unset, since the gateway (not this
  // service) owns port 8080.
  const baseUrl = process.env.HOMECLOUD_FRONTEND_URL || "/cloud";

  const existing = db.prepare("SELECT id FROM hc_applications WHERE slug = 'homecloud'").get();
  if (existing) {
    db.prepare(
      "UPDATE hc_applications SET version = ?, base_url = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(version, baseUrl, existing.id);
    grantPermissions(existing.id, ["files.read", "files.write", "files.delete", "files.share"]);
    return existing.id;
  }

  const info = db
    .prepare(
      `INSERT INTO hc_applications (slug, name, description, version, icon, base_url, health_url, enabled)
       VALUES ('homecloud', 'HomeCloud', 'Personal file storage', ?, '/icons/homecloud.svg', ?, '/api/health', 1)`
    )
    .run(version, baseUrl);
  grantPermissions(info.lastInsertRowid, ["files.read", "files.write", "files.delete", "files.share"]);
  return info.lastInsertRowid;
}

// HomeMedia is a genuinely separate service (its own container, its own
// backend — see docker-compose.yml and homemedia-backend/), unlike
// HomeCore itself which still lives embedded in this process (§39's
// pragmatic v0 compromise). Because of that, HomeMedia can't self-register
// the way HomeCore's own health/system routes can report on themselves —
// it has no access to this database. Pre-seeding its registry entry here,
// from the one process that *does* already seed HomeCloud's own entry, is
// the smallest way to get a working "HomeMedia" card in Home out of the
// box; a proper self-hosted "install an application" admin flow (§45's
// lifecycle: discover → install → register → enable) is real future work,
// not a v0 requirement. This is a deliberate, documented shortcut, not an
// architectural pattern to repeat for every future application without
// reconsidering it.
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

function runSeed() {
  seedPermissions();
  seedHomecloudApplication();
  seedHomeMediaApplication();
  seedHomeSyncApplication();
  return seedHomeNotesApplication();
}

module.exports = { runSeed, DEFAULT_PERMISSIONS };
