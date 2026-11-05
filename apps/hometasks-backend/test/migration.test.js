// An OLD database (from HomeTasks 1.10.0, before repeating tasks existed) must
// keep working after an upgrade: the missing columns get added, nothing is
// lost, and old tasks simply become normal non-repeating tasks.
//
// `node --test` runs every test file in its own process, so we can safely
// build an old-format database in a temp folder BEFORE loading src/db.js
// (which reads DATA_DIR once, the moment it is first required).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const { spawnSync } = require('node:child_process');

test("an old tasks table is upgraded in place, keeping its rows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hometasks-migrate-"));

  // The exact table shape 1.10.0 created (no repeat columns).
  const old = new Database(path.join(dir, "hometasks.db"));
  old.exec(`
    CREATE TABLE task_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, name COLLATE NOCASE));
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      project_id INTEGER REFERENCES task_projects(id), title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
      priority INTEGER NOT NULL DEFAULT 0, due_date TEXT, completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO tasks (user_id, title, due_date) VALUES (7, 'From the old days', '2026-10-09');
  `);
  old.close();
  const maintain = database => spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/revoke-restored-assignments.js'),
    '--database', database, '--confirm-offline-restore'], { encoding: 'utf8' });
  assert.equal(maintain(path.join(dir, 'hometasks.db')).stdout.trim(), '{"revoked":0}');
  assert.equal(maintain(path.join(dir, 'missing.db')).status, 1);
  assert.equal(fs.existsSync(path.join(dir, 'missing.db')), false);

  process.env.DATA_DIR = dir;
  // eslint-disable-next-line global-require -- must load after DATA_DIR is set
  const { db } = require("../src/db");

  const columns = db.prepare("PRAGMA table_info(tasks)").all().map((c) => c.name);
  for (const name of ["repeat_rule", "repeat_anchor", "spawned_task_id", "reminder_at", "reminder_key", "reminder_sent_at", "reminder_error", "reminder_retry_at", 'assignee_id', 'assignee_username', 'owner_username', 'assignment_version']) {
    assert.ok(columns.includes(name), `missing column ${name}`);
  }

  const row = db.prepare("SELECT * FROM tasks WHERE title = 'From the old days'").get();
  assert.equal(row.repeat_rule, "none");
  assert.equal(row.repeat_anchor, null);
  assert.equal(row.due_date, "2026-10-09");
  assert.equal(row.reminder_at, null);
  assert.equal(row.reminder_key, null);
  assert.equal(row.assignee_id, null);
  assert.equal(row.assignment_version, 0);

  // Restart against the migrated file: additive migrations must be repeatable.
  db.prepare("UPDATE tasks SET assignee_id=9,assignee_username='fixture_member',owner_username='fixture_owner' WHERE id=?").run(row.id);
  db.close();
  delete require.cache[require.resolve("../src/db")];
  const restarted = require("../src/db").db;
  assert.equal(restarted.prepare("SELECT title FROM tasks WHERE id = ?").get(row.id).title, row.title);
  assert.equal(restarted.pragma("integrity_check", { simple: true }), "ok");
  assert.equal(restarted.prepare('SELECT assignee_id FROM tasks WHERE id=?').get(row.id).assignee_id, 9);
  const restored = maintain(path.join(dir, 'hometasks.db'));
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(restored.stdout.trim(), '{"revoked":1}');
  assert.equal(restarted.prepare('SELECT assignee_id FROM tasks WHERE id=?').get(row.id).assignee_id, null);

  restarted.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
