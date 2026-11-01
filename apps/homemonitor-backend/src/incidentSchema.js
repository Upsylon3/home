const { randomUUID } = require("node:crypto");

function ensureIncidentSchema(db) {
  const columns = db.prepare("PRAGMA table_info(alert_state)").all().map(c => c.name);
  if (!columns.includes("incident_id")) db.exec("ALTER TABLE alert_state ADD COLUMN incident_id TEXT");
  if (!columns.includes("state")) db.exec("ALTER TABLE alert_state ADD COLUMN state TEXT NOT NULL DEFAULT 'unknown'");
  db.exec(`
    CREATE TABLE IF NOT EXISTS monitor_identity (
      id INTEGER PRIMARY KEY CHECK (id = 1), instance_id TEXT NOT NULL, evaluated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS notification_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, payload_json TEXT NOT NULL
    );
  `);
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO monitor_identity (id, instance_id) VALUES (1, ?)").run(randomUUID());
    const update = db.prepare("UPDATE alert_state SET incident_id = ? WHERE key = ? AND incident_id IS NULL");
    for (const row of db.prepare("SELECT key FROM alert_state WHERE active = 1 AND incident_id IS NULL").all()) update.run(randomUUID(), row.key);
  }).immediate();
}

module.exports = { ensureIncidentSchema };
