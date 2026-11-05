const crypto = require('node:crypto');
const PERMISSIONS = Object.freeze(['files.read', 'files.write', 'files.delete', 'files.share']);
const TOKEN_RE = /^hc_app_[A-Za-z0-9_-]{43}$/;
const LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const hash = token => crypto.createHash('sha256').update(token).digest('hex');
const failure = (status, code, message) => Object.assign(new Error(message), { status, code });

function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS hc_application_access (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    application_id INTEGER NOT NULL REFERENCES hc_applications(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    permissions_json TEXT NOT NULL,
    token_version INTEGER NOT NULL,
    subject_role TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    UNIQUE(user_id, application_id)
  )`);
}

function createApplicationAccessStore(db, { now = Date.now } = {}) {
  const user = id => db.prepare('SELECT id, username, role, disabled, token_version, quota_override FROM users WHERE id=?').get(id);
  const app = id => db.prepare('SELECT id, slug, name, installed, enabled FROM hc_applications WHERE id=?').get(id);
  const declared = id => db.prepare(`SELECT p.key FROM hc_application_permissions ap
    JOIN hc_permissions p ON p.id=ap.permission_id WHERE ap.application_id=?`).all(id).map(p => p.key);
  function audit(row, operation, actor = row.user_id) {
    db.prepare(`INSERT INTO hc_activity_events (actor_user_id, application_id, event_type, target_type, target_id, metadata_json)
      VALUES (?, ?, ?, 'application-access', ?, ?)`).run(actor, row.application_id, 'homecore.application_access.' + operation, row.id,
      JSON.stringify({ permissions: JSON.parse(row.permissions_json) }));
  }
  function status(row) {
    if (row.revoked_at !== null) return 'revoked';
    if (row.expires_at <= now()) return 'expired';
    const owner = user(row.user_id), caller = app(row.application_id);
    if (!owner || owner.disabled || owner.token_version !== row.token_version || owner.role !== row.subject_role) return 'invalidated';
    const cloud = db.prepare("SELECT installed, enabled FROM hc_applications WHERE slug='homecloud'").get();
    if (!caller?.installed || !caller.enabled || !cloud?.installed || !cloud.enabled) return 'apps-disabled';
    const allowed = declared(row.application_id);
    return JSON.parse(row.permissions_json).every(p => PERMISSIONS.includes(p) && allowed.includes(p)) ? 'active' : 'permissions-changed';
  }
  function metadata(row) {
    const caller = app(row.application_id);
    return { id: row.id, applicationSlug: caller.slug, applicationName: caller.name,
      permissions: JSON.parse(row.permissions_json), status: status(row),
      createdAt: new Date(row.created_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString() };
  }
  function revokeRows(rows, operation, actor) {
    for (const row of rows) {
      db.prepare('UPDATE hc_application_access SET revoked_at=? WHERE id=?').run(now(), row.id);
      audit(row, operation, actor === undefined ? row.user_id : actor);
    }
    return rows.length;
  }
  return {
    issue(userId, tokenVersion, slug, permissions) {
      return db.transaction(() => {
        const owner = user(userId);
        if (!owner || owner.disabled || owner.token_version !== tokenVersion) throw failure(403, 'ACCESS_REFUSED', 'A current sign-in is required.');
        if (!Array.isArray(permissions) || !permissions.length || permissions.length > PERMISSIONS.length ||
            new Set(permissions).size !== permissions.length || permissions.some(p => !PERMISSIONS.includes(p))) {
          throw failure(400, 'INVALID_PERMISSIONS', 'Select explicit supported file permissions.');
        }
        const caller = db.prepare('SELECT * FROM hc_applications WHERE slug=? AND installed=1 AND enabled=1').get(slug);
        const cloud = db.prepare("SELECT 1 FROM hc_applications WHERE slug='homecloud' AND installed=1 AND enabled=1").get();
        if (!caller || !cloud) throw failure(409, 'APPS_DISABLED', 'The application and HomeCloud must be installed and enabled.');
        if (permissions.some(p => !declared(caller.id).includes(p))) throw failure(403, 'UNDECLARED_PERMISSION', 'The application has not declared these permissions.');
        const previous = db.prepare('SELECT * FROM hc_application_access WHERE user_id=? AND application_id=?').get(userId, caller.id);
        if (previous && status(previous) === 'active') throw failure(409, 'ACCESS_EXISTS', 'Revoke this application’s existing key before creating another.');
        if (!previous && db.prepare('SELECT COUNT(*) AS n FROM hc_application_access WHERE user_id=?').get(userId).n >= 100) {
          throw failure(429, 'ACCESS_LIMIT', 'Application access limit reached.');
        }
        const id = previous?.id || crypto.randomUUID(), token = 'hc_app_' + crypto.randomBytes(32).toString('base64url'), at = now();
        db.prepare(`INSERT INTO hc_application_access
          (id,user_id,application_id,token_hash,permissions_json,token_version,subject_role,created_at,expires_at)
          VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,application_id) DO UPDATE SET
          token_hash=excluded.token_hash, permissions_json=excluded.permissions_json, token_version=excluded.token_version,
          subject_role=excluded.subject_role, created_at=excluded.created_at, expires_at=excluded.expires_at, revoked_at=NULL`)
          .run(id, userId, caller.id, hash(token), JSON.stringify([...permissions].sort()), tokenVersion, owner.role, at, at + LIFETIME_MS);
        const row = db.prepare('SELECT * FROM hc_application_access WHERE id=?').get(id);
        audit(row, 'created');
        return { access: metadata(row), token };
      }).immediate();
    },
    list: userId => db.prepare('SELECT * FROM hc_application_access WHERE user_id=? ORDER BY created_at DESC').all(userId).map(metadata),
    revoke(userId, id) {
      db.transaction(() => {
        const row = db.prepare('SELECT * FROM hc_application_access WHERE id=? AND user_id=?').get(id, userId);
        if (!row) throw failure(404, 'ACCESS_NOT_FOUND', 'Application access not found.');
        if (row.revoked_at === null) revokeRows([row], 'revoked');
      }).immediate();
    },
    verify(token, audience, permission) {
      if (typeof token !== 'string' || !TOKEN_RE.test(token) || audience !== 'homecloud' || !PERMISSIONS.includes(permission)) return null;
      return db.transaction(() => {
        const row = db.prepare('SELECT * FROM hc_application_access WHERE token_hash=?').get(hash(token));
        if (!row || status(row) !== 'active' || !JSON.parse(row.permissions_json).includes(permission)) return null;
        const owner = user(row.user_id), caller = app(row.application_id);
        return { kind: 'application', id: row.id, applicationSlug: caller.slug, audience, permission,
          expiresAt: new Date(row.expires_at).toISOString(), user: { id: owner.id, username: owner.username, role: 'user', quotaOverride: owner.quota_override ?? null } };
      })();
    },
    revokeApplication(slug, actor) {
      return db.transaction(() => revokeRows(db.prepare(`SELECT * FROM hc_application_access WHERE revoked_at IS NULL
        AND (?='homecloud' OR application_id IN (SELECT id FROM hc_applications WHERE slug=?))`).all(slug, slug), 'revoked', actor)).immediate();
    },
    revokeRestored: () => db.transaction(() => revokeRows(db.prepare('SELECT * FROM hc_application_access WHERE revoked_at IS NULL').all(), 'restore_revoked', null)).immediate()
  };
}
module.exports = { ensureSchema, createApplicationAccessStore, PERMISSIONS, TOKEN_RE, LIFETIME_MS };
