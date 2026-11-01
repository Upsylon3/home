const { createHash, randomUUID } = require("node:crypto");

function ensureAutomationSchema(db) {
  // No task FK: receipts survive task deletion and never retain task content.
  db.exec(`CREATE TABLE IF NOT EXISTS task_automation_receipts (
    id TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    integration_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    task_id INTEGER NOT NULL,
    created_day TEXT NOT NULL,
    PRIMARY KEY (user_id, integration_id, idempotency_key)
  );
  CREATE INDEX IF NOT EXISTS idx_task_automation_daily
    ON task_automation_receipts(user_id, integration_id, created_day);`);
}
const failure = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
function validateIntent(body) {
  if (!body || Array.isArray(body) || typeof body !== "object" ||
      Object.keys(body).length !== 3 || !["title", "notes", "idempotencyKey"].every(key => Object.hasOwn(body, key))) {
    throw failure(400, "Only title, notes and idempotencyKey are accepted.");
  }
  if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 200 || /[\x00-\x1f\x7f]/.test(body.title)) {
    throw failure(400, "Title must be plain text between 1 and 200 characters.");
  }
  if (typeof body.notes !== "string" || body.notes.length > 5000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body.notes)) {
    throw failure(400, "Notes must be text of at most 5000 characters.");
  }
  if (typeof body.idempotencyKey !== "string" || !/^[0-9a-f]{64}$/.test(body.idempotencyKey)) {
    throw failure(400, "Idempotency key must be a lowercase SHA-256 hex digest.");
  }
  return { title: body.title.trim(), notes: body.notes, idempotencyKey: body.idempotencyKey };
}
function createAutomationStore(db, { now = Date.now } = {}) {
  function receipt(row) {
    const exists = !!db.prepare("SELECT 1 FROM tasks WHERE id = ? AND user_id = ?").get(row.task_id, row.user_id);
    return { id: row.id, taskId: row.task_id, taskUrl: exists ? `/tasks/all?task=${row.task_id}` : null, state: exists ? "active" : "retired" };
  }
  function createOnce(principal, body) {
    if (principal.kind !== "delegation" || principal.integrationId !== "monitor-followup-v1" ||
        principal.audience !== "hometasks" || principal.action !== "tasks.automation.create-once" ||
        !Number.isSafeInteger(principal.subjectUserId) || principal.subjectUserId < 1 || principal.dailyCreateLimit !== 20) {
      throw failure(403, "Delegation is not authorized.");
    }
    const intent = validateIntent(body);
    const digest = createHash("sha256").update(JSON.stringify([intent.title, intent.notes])).digest("hex");
    return db.transaction(() => {
      const at = now();
      if (Date.parse(principal.expiresAt) <= at || !Number.isFinite(Date.parse(principal.expiresAt))) throw failure(403, "Delegation has expired.");
      const existing = db.prepare(`SELECT * FROM task_automation_receipts
        WHERE user_id = ? AND integration_id = ? AND idempotency_key = ?`)
        .get(principal.subjectUserId, principal.integrationId, intent.idempotencyKey);
      if (existing) {
        if (existing.payload_hash !== digest) throw failure(409, "Idempotency key already has a different payload.");
        return { created: false, receipt: receipt(existing) };
      }
      const day = new Date(at).toISOString().slice(0, 10);
      const count = db.prepare(`SELECT COUNT(*) AS n FROM task_automation_receipts
        WHERE user_id = ? AND integration_id = ? AND created_day = ?`).get(principal.subjectUserId, principal.integrationId, day).n;
      if (count >= 20) {
        const midnight = Date.parse(`${day}T00:00:00.000Z`) + 86400000;
        throw failure(429, "Daily automated-task limit reached.", { retryAfter: Math.max(1, Math.ceil((midnight - at) / 1000)) });
      }
      const taskId = Number(db.prepare("INSERT INTO tasks (user_id, title, notes) VALUES (?, ?, ?)")
        .run(principal.subjectUserId, intent.title, intent.notes).lastInsertRowid);
      const row = { id: randomUUID(), user_id: principal.subjectUserId, task_id: taskId };
      db.prepare(`INSERT INTO task_automation_receipts
        (id, user_id, integration_id, idempotency_key, payload_hash, task_id, created_day) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(row.id, row.user_id, principal.integrationId, intent.idempotencyKey, digest, taskId, day);
      return { created: true, receipt: receipt(row) };
    }).immediate();
  }
  return { createOnce };
}
module.exports = { ensureAutomationSchema, createAutomationStore, validateIntent };
