// HomeMonitor's own small database: a little history for the charts, and the
// current alert state. Like every Home app it owns its data and never touches
// another app's database. Nothing here is precious: if this file is deleted
// the monitor just starts its history afresh.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "homemonitor.db"));
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

db.exec(`
  -- One row every few minutes, for the "last 24 hours" charts. ts is Unix time
  -- in seconds. Any column can be NULL (no reading, e.g. no network counters on
  -- this OS). Old rows are pruned (see history.js).
  CREATE TABLE IF NOT EXISTS samples (
    ts INTEGER PRIMARY KEY,
    cpu REAL,
    memory REAL,
    disk REAL,   -- the fullest disk, in percent
    rx REAL,     -- network bytes per second in
    tx REAL      -- network bytes per second out
  );

  -- One row per disk per day: how much was used. This is what the growth chart
  -- and the "full in about N days" forecast are built from.
  CREATE TABLE IF NOT EXISTS disk_daily (
    day TEXT NOT NULL,
    label TEXT NOT NULL,
    used_bytes INTEGER NOT NULL,
    total_bytes INTEGER NOT NULL,
    PRIMARY KEY (day, label)
  );

  -- The alert state machine's memory (see alerts.js). "active" = 1 means a
  -- real alert; 0 means "failing, but not for long enough yet".
  CREATE TABLE IF NOT EXISTS alert_state (
    key TEXT PRIMARY KEY,
    active INTEGER NOT NULL,
    checks INTEGER NOT NULL,
    since TEXT,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT ''
  );
`);

module.exports = { db, DATA_DIR };
