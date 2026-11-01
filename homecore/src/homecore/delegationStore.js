const crypto = require("node:crypto");

const INTEGRATION = "monitor-followup-v1";
const LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const ACTIONS = Object.freeze({ homemonitor: "monitor.alerts.read", hometasks: "tasks.automation.create-once" });
const TOKEN_RE = /^hc_dg_[A-Za-z0-9_-]{43}$/;
const hash = token => crypto.createHash("sha256").update(token).digest("hex");

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hc_delegation_grants (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      integration_id TEXT NOT NULL CHECK (integration_id = 'monitor-followup-v1'),
      token_version INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      consented_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      UNIQUE(user_id, integration_id)
    );
    CREATE TABLE IF NOT EXISTS hc_delegation_credentials (
      id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL REFERENCES hc_delegation_grants(id) ON DELETE CASCADE,
      audience TEXT NOT NULL,
      action TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
      UNIQUE(grant_id, audience),
      CHECK ((audience = 'homemonitor' AND action = 'monitor.alerts.read') OR
             (audience = 'hometasks' AND action = 'tasks.automation.create-once'))
    );
  `);
}

function failure(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function createDelegationStore(db, { now = Date.now } = {}) {
  function applicationsEnabled() {
    return db.prepare("SELECT COUNT(*) AS n FROM hc_applications WHERE slug IN ('homemonitor', 'hometasks') AND enabled = 1").get().n === 2;
  }
  function account(userId) {
    return db.prepare("SELECT id, role, disabled, token_version FROM users WHERE id = ?").get(userId);
  }
  function audit(grant, operation, actor = grant.user_id) {
    db.prepare(`INSERT INTO hc_activity_events
      (actor_user_id, event_type, target_type, target_id, metadata_json)
      VALUES (?, ?, 'delegation', ?, ?)`).run(actor, `homecore.delegation.${operation}`, grant.id,
      JSON.stringify({ integrationId: INTEGRATION, subjectUserId: grant.user_id }));
  }
  function status(grant) {
    if (grant.revoked_at !== null) return "revoked";
    if (grant.expires_at <= now()) return "expired";
    const user = account(grant.user_id);
    if (!user || user.disabled || user.role !== "admin" || user.token_version !== grant.token_version) return "invalidated";
    return applicationsEnabled() ? "active" : "apps-disabled";
  }
  function metadata(grant) {
    return {
      id: grant.id, subjectUserId: grant.user_id, integrationId: grant.integration_id,
      createdAt: new Date(grant.created_at).toISOString(), consentedAt: new Date(grant.consented_at).toISOString(),
      expiresAt: new Date(grant.expires_at).toISOString(),
      revokedAt: grant.revoked_at === null ? null : new Date(grant.revoked_at).toISOString(),
      status: status(grant), dailyCreateLimit: 20,
      capabilities: db.prepare("SELECT id, audience, action FROM hc_delegation_credentials WHERE grant_id = ? ORDER BY audience").all(grant.id)
    };
  }
  function requireOwnerSession(userId, tokenVersion) {
    const user = account(userId);
    if (!user || user.disabled || user.role !== "admin" || user.token_version !== tokenVersion) {
      throw failure(403, "DELEGATION_FORBIDDEN", "A current administrator session is required.");
    }
  }
  function issue(userId, tokenVersion, grantId = null) {
    return db.transaction(() => {
      // Recheck inside the write transaction, including the session epoch,
      // so concurrent account changes cannot authorize a fresh delegation.
      requireOwnerSession(userId, tokenVersion);
      if (!applicationsEnabled()) throw failure(409, "APPS_DISABLED", "HomeMonitor and HomeTasks must be enabled.");
      const existing = grantId
        ? db.prepare("SELECT * FROM hc_delegation_grants WHERE id = ? AND user_id = ?").get(grantId, userId)
        : db.prepare("SELECT * FROM hc_delegation_grants WHERE user_id = ? AND integration_id = ?").get(userId, INTEGRATION);
      if (grantId && !existing) throw failure(404, "GRANT_NOT_FOUND", "Grant not found.");
      if (!grantId && existing) throw failure(409, "GRANT_EXISTS", "A grant already exists; renew it with fresh consent.");
      const at = now();
      const id = existing?.id || crypto.randomUUID();
      if (existing) {
        db.prepare("DELETE FROM hc_delegation_credentials WHERE grant_id = ?").run(id);
        db.prepare("UPDATE hc_delegation_grants SET token_version = ?, consented_at = ?, expires_at = ?, revoked_at = NULL WHERE id = ?")
          .run(tokenVersion, at, at + LIFETIME_MS, id);
      } else {
        db.prepare(`INSERT INTO hc_delegation_grants
          (id, user_id, integration_id, token_version, created_at, consented_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, userId, INTEGRATION, tokenVersion, at, at, at + LIFETIME_MS);
      }
      const capabilities = Object.entries(ACTIONS).map(([audience, action]) => {
        const token = `hc_dg_${crypto.randomBytes(32).toString("base64url")}`;
        const credentialId = crypto.randomUUID();
        db.prepare("INSERT INTO hc_delegation_credentials (id, grant_id, audience, action, token_hash) VALUES (?, ?, ?, ?, ?)")
          .run(credentialId, id, audience, action, hash(token));
        return { id: credentialId, audience, action, token };
      });
      const grant = db.prepare("SELECT * FROM hc_delegation_grants WHERE id = ?").get(id);
      audit(grant, existing ? "renewed" : "created");
      return { grant: metadata(grant), capabilities };
    }).immediate();
  }
  function revoke(userId, id) {
    return db.transaction(() => {
      const grant = db.prepare("SELECT * FROM hc_delegation_grants WHERE id = ? AND user_id = ?").get(id, userId);
      if (!grant) throw failure(404, "GRANT_NOT_FOUND", "Grant not found.");
      if (grant.revoked_at === null) {
        db.prepare("UPDATE hc_delegation_grants SET revoked_at = ? WHERE id = ?").run(now(), id);
        audit(grant, "revoked");
      }
    }).immediate();
  }
  function verify(token, audience, action) {
    if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
    // One read transaction observes the grant, account epoch and registry
    // together. No successful verification survives into a later request.
    return db.transaction(() => {
      const credential = db.prepare("SELECT * FROM hc_delegation_credentials WHERE token_hash = ?").get(hash(token));
      if (!credential || credential.audience !== audience || credential.action !== action || ACTIONS[audience] !== action) return null;
      const grant = db.prepare("SELECT * FROM hc_delegation_grants WHERE id = ?").get(credential.grant_id);
      if (!grant || status(grant) !== "active") return null;
      return {
        kind: "delegation", subjectUserId: grant.user_id, grantId: grant.id, credentialId: credential.id,
        integrationId: grant.integration_id, audience, action,
        expiresAt: new Date(grant.expires_at).toISOString(), dailyCreateLimit: 20
      };
    })();
  }
  function revokeRestored() {
    return db.transaction(() => {
      const grants = db.prepare("SELECT * FROM hc_delegation_grants WHERE revoked_at IS NULL").all();
      for (const grant of grants) {
        db.prepare("UPDATE hc_delegation_grants SET revoked_at = ? WHERE id = ?").run(now(), grant.id);
        audit(grant, "restore_revoked", null);
      }
      return grants.length;
    }).immediate();
  }
  return {
    issue, revoke, verify, revokeRestored,
    surrender: token => {
      if (typeof token !== "string" || !TOKEN_RE.test(token)) throw failure(403, "DELEGATION_REFUSED", "Delegation is not authorized.");
      db.transaction(() => {
        const credential = db.prepare("SELECT grant_id FROM hc_delegation_credentials WHERE token_hash = ?").get(hash(token));
        if (!credential) return;
        const grant = db.prepare("SELECT * FROM hc_delegation_grants WHERE id = ?").get(credential.grant_id);
        if (grant && grant.revoked_at === null) {
          db.prepare("UPDATE hc_delegation_grants SET revoked_at = ? WHERE id = ?").run(now(), grant.id);
          audit(grant, "surrendered", null);
        }
      }).immediate();
    },
    list: userId => db.prepare("SELECT * FROM hc_delegation_grants WHERE user_id = ? ORDER BY created_at DESC").all(userId).map(metadata)
  };
}

module.exports = { ensureSchema, createDelegationStore, INTEGRATION, LIFETIME_MS, ACTIONS };
