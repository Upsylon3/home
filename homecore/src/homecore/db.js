// HomeCore v0 — database foundation.
//
// This intentionally reuses the same SQLite connection as HomeCloud's own
// db.js (`../db`) rather than opening a second database. HOME_MASTER_SPECIFICATION.md
// §2.7 asks for a modular monolith with clear internal module boundaries, not
// a separate service per concept — so HomeCore's tables live in the same
// file, namespaced with an `hc_` prefix to keep them visually distinct from
// HomeCloud's original tables (users, files, folders, shares, activity_log).
//
// Everything in this file is additive: CREATE TABLE IF NOT EXISTS and the
// same try/catch ensureColumn() pattern already used in ../db.js. Requiring
// this module multiple times is safe (Node caches it), and running it
// against a database that already has these tables is a no-op.
const { db, ensureColumn, onActivity } = require("../db");
const { emitEvent, toEventType } = require("./events");

db.exec(`
  CREATE TABLE IF NOT EXISTS hc_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    version TEXT,
    icon TEXT,
    base_url TEXT,
    health_url TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS hc_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS hc_application_permissions (
    application_id INTEGER NOT NULL REFERENCES hc_applications(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES hc_permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (application_id, permission_id)
  );

  CREATE TABLE IF NOT EXISTS hc_activity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    application_id INTEGER REFERENCES hc_applications(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_hc_activity_events_created_at ON hc_activity_events(created_at);
  CREATE INDEX IF NOT EXISTS idx_hc_activity_events_actor ON hc_activity_events(actor_user_id);

  CREATE TABLE IF NOT EXISTS hc_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    application_id INTEGER REFERENCES hc_applications(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    data_json TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_hc_notifications_user_id ON hc_notifications(user_id);

  CREATE TABLE IF NOT EXISTS hc_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    device_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,
    revoked_at TEXT,
    last_seen_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_hc_sessions_user_id ON hc_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_hc_sessions_token_hash ON hc_sessions(token_hash);
`);

// §7.1 adds display_name, updated_at, and last_login_at to the users table
// on top of what HomeCloud already has. Nothing currently populates
// updated_at (there's no profile-edit flow yet beyond display name), so it
// stays NULL until something writes to it — that's honest, not a bug.
ensureColumn("users", "display_name TEXT");
ensureColumn("users", "updated_at TEXT");
ensureColumn("users", "last_login_at TEXT");

function getApplicationIdBySlug(slug) {
  const row = db.prepare("SELECT id FROM hc_applications WHERE slug = ?").get(slug);
  return row ? row.id : null;
}

// The action->eventType map (and its exact inverse, toAction) used to live
// here; moved to ./events in MIGRATION_PLAN.md's Phase 3 since toEventType
// is now needed by a second caller (the new POST /internal/events route —
// see ../internalEvents.js) and toAction by two more (the legacy
// GET /api/activity / /api/admin/activity routes) — one shared home for
// the map beats redefining or re-deriving it per caller.

// The bridge itself: every logActivity() call anywhere in HomeCloud now also
// produces a HomeCore activity event, without files.js/folders.js/auth.js/
// admin.js needing to know HomeCore exists.
onActivity((userId, action, targetName) => {
  emitEvent({
    actorUserId: userId,
    applicationId: getApplicationIdBySlug("homecloud"),
    eventType: toEventType(action),
    targetType: targetName ? "resource" : null,
    targetId: targetName
  });
});

module.exports = { getApplicationIdBySlug };
