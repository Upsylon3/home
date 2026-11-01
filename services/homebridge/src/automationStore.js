const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3");
const INTEGRATION = "monitor-followup-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function createAutomationStore({ directory, key }) {
  if (!path.isAbsolute(directory) || !Buffer.isBuffer(key) || key.length !== 32) throw new Error("Invalid automation storage configuration.");
  key = Buffer.from(key);
  fs.mkdirSync(directory, { recursive: true });
  const db = new Database(path.join(directory, "homebridge.db"));
  db.pragma("journal_mode = WAL"); db.pragma("busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS bridge_rules (
    subject INTEGER PRIMARY KEY, grant_id TEXT, instance_id TEXT, expires_at TEXT,
    enabled INTEGER NOT NULL DEFAULT 0, revocation_pending INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'disabled', reason TEXT,
    monitor_cipher TEXT, tasks_cipher TEXT, qualification TEXT NOT NULL DEFAULT '{}',
    last_evaluation TEXT, last_checked INTEGER, last_success INTEGER, last_delivery INTEGER,
    retry_at INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0, control_until INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS bridge_intents (
    subject INTEGER NOT NULL, instance_id TEXT NOT NULL, incident_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL, payload_cipher TEXT, state TEXT NOT NULL DEFAULT 'pending',
    receipt_id TEXT, task_id INTEGER,
    PRIMARY KEY (subject, instance_id, incident_id)
  );`);
  db.exec("CREATE TABLE IF NOT EXISTS bridge_slots (slot INTEGER PRIMARY KEY, owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0)");
  for (let slot = 1; slot <= 4; slot++) db.prepare("INSERT OR IGNORE INTO bridge_slots (slot) VALUES (?)").run(slot);
  const aad = (rule, audience) => Buffer.from(JSON.stringify([INTEGRATION, rule.subject, rule.grant_id, audience]));
  function encrypt(rule, audience, value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(aad(rule, audience));
    const bytes = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return JSON.stringify({ iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: bytes.toString("base64") });
  }
  function decrypt(rule, audience, value) {
    const envelope = JSON.parse(value);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(aad(rule, audience)); decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8"));
  }
  const get = subject => db.prepare("SELECT * FROM bridge_rules WHERE subject = ?").get(subject);
  const allowed = new Set(["grant_id", "instance_id", "expires_at", "enabled", "revocation_pending", "revision", "status", "reason",
    "monitor_cipher", "tasks_cipher", "qualification", "last_evaluation", "last_checked", "last_success", "last_delivery", "retry_at", "lease_owner", "lease_until", "control_until"]);
  function update(subject, fields) {
    const entries = Object.entries(fields);
    if (entries.some(([field]) => !allowed.has(field))) throw new Error("Invalid rule field.");
    db.prepare(`UPDATE bridge_rules SET ${entries.map(([field]) => `${field} = ?`).join(", ")} WHERE subject = ?`)
      .run(...entries.map(([, value]) => value), subject);
  }
  function ensure(subject) { db.prepare("INSERT OR IGNORE INTO bridge_rules (subject) VALUES (?)").run(subject); return get(subject); }
  function view(subject) {
    const row = get(subject); if (!row) return null;
    return { grantId: row.grant_id, instanceId: row.instance_id, expiresAt: row.expires_at,
      enabled: !!row.enabled, revocationPending: !!row.revocation_pending, status: row.status, reason: row.reason,
      lastCheckedAt: row.last_checked, lastSuccessAt: row.last_success, lastDeliveryAt: row.last_delivery,
      retryAt: row.retry_at || null,
      qualifyingIncidents: Object.keys(JSON.parse(row.qualification)).length,
      pendingDeliveries: db.prepare("SELECT COUNT(*) AS n FROM bridge_intents WHERE subject = ? AND state = 'pending'").get(subject).n };
  }
  function credentials(row) {
    return { homemonitor: decrypt(row, "homemonitor", row.monitor_cipher), hometasks: decrypt(row, "hometasks", row.tasks_cipher) };
  }
  function install(subject, issued, instanceId, revision, claim) {
    return db.transaction(() => {
      const current = get(subject);
      if (current.control_until !== claim) return false;
      const row = { subject, grant_id: issued.grant.id };
      const tokens = Object.fromEntries(issued.capabilities.map(cap => [cap.audience, cap.token]));
      const cancelled = current.revision !== revision;
      update(subject, { grant_id: issued.grant.id, instance_id: instanceId, expires_at: issued.grant.expiresAt,
        monitor_cipher: encrypt(row, "homemonitor", tokens.homemonitor), tasks_cipher: encrypt(row, "hometasks", tokens.hometasks),
        enabled: 0, revocation_pending: cancelled ? 1 : 0,
        status: cancelled ? "stopping" : "enrolling", reason: null, qualification: "{}", last_evaluation: null, retry_at: 0 });
      return !cancelled;
    }).immediate();
  }
  function lease(subject, owner, at) {
    return db.transaction(() => {
      const slot = db.prepare("SELECT slot FROM bridge_slots WHERE lease_until <= ? ORDER BY slot LIMIT 1").get(at);
      if (!slot) return false;
      const changed = db.prepare(`UPDATE bridge_rules SET lease_owner = ?, lease_until = ?
        WHERE subject = ? AND (enabled = 1 OR revocation_pending = 1 OR status = 'enrolling') AND lease_until <= ?`)
        .run(owner, at + 60000, subject, at).changes;
      if (!changed) return false;
      db.prepare("UPDATE bridge_slots SET owner = ?, lease_until = ? WHERE slot = ?").run(owner, at + 60000, slot.slot);
      return true;
    }).immediate();
  }
  function current(subject, revision, owner, at) {
    const row = get(subject);
    return row?.enabled === 1 && row.revision === revision && row.lease_owner === owner && row.lease_until > at;
  }
  function intent(rule, incident, payload) {
    const key = crypto.createHash("sha256").update(JSON.stringify([INTEGRATION, rule.subject, rule.instance_id, incident])).digest("hex");
    db.prepare(`INSERT OR IGNORE INTO bridge_intents (subject, instance_id, incident_id, idempotency_key, payload_cipher)
      VALUES (?, ?, ?, ?, ?)`).run(rule.subject, rule.instance_id, incident, key,
      encrypt(rule, `intent:${rule.instance_id}:${incident}`, { ...payload, idempotencyKey: key }));
  }
  return { db, get, ensure, update, view, credentials, install, lease, current, intent, encrypt, decrypt,
    recoverEnrollments: at => db.prepare(`UPDATE bridge_rules SET enabled = 0, revision = revision + 1,
      revocation_pending = CASE WHEN grant_id IS NOT NULL THEN 1 ELSE 0 END,
      status = CASE WHEN grant_id IS NOT NULL THEN 'stopping' ELSE 'attention' END,
      reason = 'enrollment-failed', control_until = 0
      WHERE status = 'enrolling' AND control_until <= ?`).run(at),
    begin: (subject, at) => db.transaction(() => {
      const row = ensure(subject);
      if (row.control_until > at) throw Object.assign(new Error("Enrollment is already running. Try again shortly."), { status: 409 });
      const revision = row.revision + 1, claim = at + 30000;
      update(subject, { revision, control_until: claim, enabled: 0, status: "enrolling", qualification: "{}" });
      return { revision, claim };
    }).immediate(),
    endControl: (subject, claim) => db.prepare("UPDATE bridge_rules SET control_until = 0 WHERE subject = ? AND control_until = ?").run(subject, claim),
    rules: () => db.prepare("SELECT subject FROM bridge_rules WHERE enabled = 1 OR revocation_pending = 1 ORDER BY subject").all(),
    findIntent: (row, incident) => db.prepare("SELECT * FROM bridge_intents WHERE subject = ? AND instance_id = ? AND incident_id = ?").get(row.subject, row.instance_id, incident),
    pending: row => db.prepare("SELECT * FROM bridge_intents WHERE subject = ? AND instance_id = ? AND state = 'pending' ORDER BY rowid LIMIT 4").all(row.subject, row.instance_id),
    finish: (row, incident, state, receipt = {}) => db.prepare(`UPDATE bridge_intents SET state = ?, payload_cipher = NULL, receipt_id = ?, task_id = ?
      WHERE subject = ? AND instance_id = ? AND incident_id = ?`).run(state, receipt.id || null, receipt.taskId || null, row.subject, row.instance_id, incident),
    release: (subject, owner) => db.transaction(() => {
      db.prepare("UPDATE bridge_rules SET lease_owner = NULL, lease_until = 0 WHERE subject = ? AND lease_owner = ?").run(subject, owner);
      db.prepare("UPDATE bridge_slots SET owner = NULL, lease_until = 0 WHERE owner = ?").run(owner);
    })(),
    close: () => { db.close(); key.fill(0); } };
}
function configuredStore(env = process.env) {
  if (!env.HOMEBRIDGE_DATA_DIR || !env.HOMEBRIDGE_KEY_FILE) return null;
  try {
    if (!path.isAbsolute(env.HOMEBRIDGE_KEY_FILE)) return null;
    const file = fs.realpathSync(env.HOMEBRIDGE_KEY_FILE);
    const data = fs.existsSync(env.HOMEBRIDGE_DATA_DIR) ? fs.realpathSync(env.HOMEBRIDGE_DATA_DIR) : path.resolve(env.HOMEBRIDGE_DATA_DIR);
    const repository = fs.realpathSync(path.resolve(__dirname, "../../.."));
    const inside = root => { const relative = path.relative(root, file); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); };
    if (inside(data) || inside(repository) || !fs.statSync(file).isFile()) return null;
    const key = fs.readFileSync(file);
    return createAutomationStore({ directory: env.HOMEBRIDGE_DATA_DIR, key });
  } catch { return null; }
}
module.exports = { createAutomationStore, configuredStore, INTEGRATION, UUID };
