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

  process.env.DATA_DIR = dir;
  // eslint-disable-next-line global-require -- must load after DATA_DIR is set
  const { db } = require("../src/db");

  const columns = db.prepare("PRAGMA table_info(tasks)").all().map((c) => c.name);
  for (const name of ["repeat_rule", "repeat_anchor", "spawned_task_id"]) {
    assert.ok(columns.includes(name), `missing column ${name}`);
  }

  const row = db.prepare("SELECT * FROM tasks WHERE title = 'From the old days'").get();
  assert.equal(row.repeat_rule, "none");
  assert.equal(row.repeat_anchor, null);
  assert.equal(row.due_date, "2026-10-09");

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
