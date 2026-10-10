// Reading and writing the monitor's history and alert state.
// All the SQL lives here so the rest of the code deals in plain objects.
const { db } = require("./db");

const SAMPLE_KEEP_SECONDS = 48 * 3600; // chart samples: keep two days
const DISK_DAILY_KEEP_DAYS = 400; // daily disk usage: keep over a year

// Save one chart sample from a snapshot (see collector.js for its shape).
function recordSample(tsSeconds, snapshot) {
  const usable = snapshot.disks.filter((d) => !d.error);
  const fullest = usable.length ? Math.max(...usable.map((d) => d.usedPercent)) : null;
  db.prepare("INSERT OR REPLACE INTO samples (ts, cpu, memory, disk, rx, tx) VALUES (?, ?, ?, ?, ?, ?)").run(
    tsSeconds,
    snapshot.system.cpuPercent,
    snapshot.system.memory.percent,
    fullest,
    snapshot.system.network ? snapshot.system.network.rxBytesPerSec : null,
    snapshot.system.network ? snapshot.system.network.txBytesPerSec : null
  );
}

// Save today's disk usage for each readable disk. Writing again on the same day
// just overwrites, so the row ends up holding the day's latest reading.
function recordDiskDaily(day, disks) {
  const upsert = db.prepare("INSERT OR REPLACE INTO disk_daily (day, label, used_bytes, total_bytes) VALUES (?, ?, ?, ?)");
  db.transaction(() => {
    for (const disk of disks) {
      if (!disk.error) upsert.run(day, disk.label, Math.round(disk.usedBytes), Math.round(disk.totalBytes));
    }
  })();
}

function prune(nowSeconds, today) {
  db.prepare("DELETE FROM samples WHERE ts < ?").run(nowSeconds - SAMPLE_KEEP_SECONDS);
  const [year, month, day] = today.split("-").map(Number);
  const cutoff = new Date(Date.UTC(year, month - 1, day - DISK_DAILY_KEEP_DAYS)).toISOString().slice(0, 10);
  db.prepare("DELETE FROM disk_daily WHERE day < ?").run(cutoff);
}

// Samples from the last `hours`, oldest first, ready for a chart.
function getSamples(nowSeconds, hours) {
  return db
    .prepare("SELECT ts AS t, cpu, memory, disk, rx, tx FROM samples WHERE ts >= ? ORDER BY ts ASC")
    .all(nowSeconds - hours * 3600);
}

// Daily disk usage for the last `days` days, grouped per disk, oldest first.
function getDiskGrowth(today, days) {
  const [year, month, day] = today.split("-").map(Number);
  const since = new Date(Date.UTC(year, month - 1, day - days)).toISOString().slice(0, 10);
  const rows = db
    .prepare("SELECT day, label, used_bytes AS usedBytes, total_bytes AS totalBytes FROM disk_daily WHERE day >= ? ORDER BY day ASC")
    .all(since);

  const byLabel = new Map();
  for (const row of rows) {
    if (!byLabel.has(row.label)) byLabel.set(row.label, []);
    byLabel.get(row.label).push({ day: row.day, usedBytes: row.usedBytes, totalBytes: row.totalBytes });
  }
  return [...byLabel.entries()].map(([label, points]) => ({ label, points }));
}

// ---------- alert state ----------

function loadAlertState() {
  const state = {};
  for (const row of db.prepare("SELECT * FROM alert_state").all()) {
    state[row.key] = {
      active: row.active === 1,
      checks: row.checks,
      since: row.since,
      severity: row.severity,
      title: row.title,
      body: row.body
    };
  }
  return state;
}

// Replace the whole saved state with `state`, in one transaction.
function saveAlertState(state) {
  const insert = db.prepare(
    "INSERT INTO alert_state (key, active, checks, since, severity, title, body) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  db.transaction(() => {
    db.prepare("DELETE FROM alert_state").run();
    for (const [key, s] of Object.entries(state)) {
      insert.run(key, s.active ? 1 : 0, s.checks, s.since, s.severity, s.title, s.body || "");
    }
  })();
}

module.exports = { recordSample, recordDiskDaily, prune, getSamples, getDiskGrowth, loadAlertState, saveAlertState };
