// HomeTasks' own database.
//
// WHY ITS OWN DATABASE? (See docs/ARCHITECTURE.md, "Tier 1 apps".)
// Every Home app owns its own data and never reads another app's database.
// HomeTasks stores only small structured rows (a title, a date, a priority),
// so a SQLite file is exactly the right tool. It never stores a user's
// accounts either: who someone IS belongs to HomeCore. We keep just their
// numeric id in a `user_id` column so each person only ever sees their own
// tasks.
//
// SQLite is a whole database in ONE file, with no separate server to install.
// better-sqlite3 is the library that lets Node.js talk to it.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// Where the database file lives. In Docker this is the mounted /data volume
// (so it survives container restarts); on a dev machine it falls back to a
// "data" folder next to src/.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "hometasks.db"));

// WAL ("write-ahead logging") lets reads and writes happen at the same time
// without blocking each other. busy_timeout says "if the file is briefly
// locked, wait up to 5 seconds instead of failing immediately".
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

// CREATE TABLE IF NOT EXISTS is safe to run on every start: the first time it
// creates the tables, afterwards it does nothing.
db.exec(`
  -- A project is just a named bucket that tasks can belong to ("Groceries",
  -- "House move"). Tasks do NOT have to belong to one.
  CREATE TABLE IF NOT EXISTS task_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    -- COLLATE NOCASE makes "House" and "house" count as the same name.
    UNIQUE(user_id, name COLLATE NOCASE)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    -- NULL means "not in any project".
    project_id INTEGER REFERENCES task_projects(id),
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    -- 0 none, 1 low, 2 medium, 3 high (see src/validation.js).
    priority INTEGER NOT NULL DEFAULT 0,
    -- A plain calendar date, "YYYY-MM-DD", or NULL for "no due date".
    -- We use a date (not a date-and-time) on purpose: "due Friday" means
    -- Friday for the person, whatever time zone the server is in.
    due_date TEXT,
    -- NULL while the task is still open; the moment it was ticked off after.
    -- Storing WHEN (instead of a yes/no flag) gives us "completion history"
    -- for free later on.
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    -- Repeating tasks (see src/recurrence.js):
    --   repeat_rule       'none' for a normal task, else daily / weekdays /
    --                     weekly / monthly / yearly.
    --   repeat_anchor     the date the series started on; monthly and yearly
    --                     repeats use it so a task set for the 31st doesn't
    --                     get stuck on the 28th after February.
    --   spawned_task_id   when a repeating task is ticked off, the id of the
    --                     next copy we created, so un-ticking can remove it.
    repeat_rule TEXT NOT NULL DEFAULT 'none',
    repeat_anchor TEXT,
    spawned_task_id INTEGER
  );

  -- Indexes are like the index at the back of a book: they make the
  -- queries we run most (a person's open tasks, a project's tasks) fast.
  CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, completed_at, due_date);
  CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
  CREATE INDEX IF NOT EXISTS idx_task_projects_user ON task_projects(user_id);
`);

// ---------- Migrations ----------
// CREATE TABLE IF NOT EXISTS only helps on a FRESH database. Someone who
// installed HomeTasks 1.10.0 already has a `tasks` table WITHOUT the repeat
// columns, and "IF NOT EXISTS" will not touch it. So on every start we look at
// the columns that really exist and add any that are missing. Their
// defaults mean every existing task simply becomes a normal, non-repeating one,
// and no data is lost.
function addColumnIfMissing(table, column, definition) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!existing.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfMissing("tasks", "repeat_rule", "TEXT NOT NULL DEFAULT 'none'");
addColumnIfMissing("tasks", "repeat_anchor", "TEXT");
addColumnIfMissing("tasks", "spawned_task_id", "INTEGER");

module.exports = { db, DATA_DIR };
