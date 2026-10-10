// Needs its own temp database: DATA_DIR is read once when src/db.js first loads.
const fs = require("fs");
const os = require("os");
const path = require("path");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "homemonitor-history-"));

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const history = require("../src/history");
const { db } = require("../src/db");

after(() => {
  db.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

const snap = (over = {}) => ({
  system: { cpuPercent: 12.5, memory: { percent: 40 }, network: { rxBytesPerSec: 100, txBytesPerSec: 50 }, ...over.system },
  disks: over.disks || [
    { label: "data", usedPercent: 60, usedBytes: 6e9, totalBytes: 10e9 },
    { label: "backups", usedPercent: 85, usedBytes: 8.5e9, totalBytes: 10e9 }
  ]
});

test("a sample stores cpu, memory, the FULLEST disk, and network", () => {
  history.recordSample(1000, snap());
  const [row] = history.getSamples(1000, 1);
  assert.deepEqual(row, { t: 1000, cpu: 12.5, memory: 40, disk: 85, rx: 100, tx: 50 });
});

test("missing readings are stored as null, not zero", () => {
  history.recordSample(2000, snap({ system: { cpuPercent: null, network: null }, disks: [{ label: "x", error: "ENOENT" }] }));
  const row = history.getSamples(2000, 1).find((r) => r.t === 2000);
  assert.equal(row.cpu, null);
  assert.equal(row.rx, null);
  assert.equal(row.disk, null);
});

test("getSamples returns only the asked window, oldest first", () => {
  for (const t of [10_000, 11_000, 20_000]) history.recordSample(t, snap());
  const rows = history.getSamples(20_000, 1); // the last hour = 16,400..20,000
  assert.deepEqual(rows.map((r) => r.t), [20_000]);
  const wider = history.getSamples(20_000, 3); // since 9,200
  assert.deepEqual(wider.map((r) => r.t), [10_000, 11_000, 20_000]);
});

test("daily disk usage: one row per disk per day, overwritten within the day", () => {
  history.recordDiskDaily("2026-10-08", snap().disks);
  history.recordDiskDaily("2026-10-09", [{ label: "data", usedBytes: 7e9, totalBytes: 10e9 }]);
  history.recordDiskDaily("2026-10-09", [{ label: "data", usedBytes: 7.5e9, totalBytes: 10e9 }]); // same day again
  history.recordDiskDaily("2026-10-09", [{ label: "broken", error: "EIO" }]); // unreadable disks aren't stored

  const growth = history.getDiskGrowth("2026-10-09", 30);
  const data = growth.find((d) => d.label === "data");
  assert.deepEqual(data.points.map((p) => [p.day, p.usedBytes]), [["2026-10-08", 6e9], ["2026-10-09", 7.5e9]]);
  assert.equal(growth.find((d) => d.label === "broken"), undefined);
});

test("prune drops old samples and very old daily rows", () => {
  const now = 1_000_000;
  history.recordSample(now - 49 * 3600, snap()); // older than 48 h
  history.recordSample(now - 1 * 3600, snap());
  history.recordDiskDaily("2025-01-01", [{ label: "data", usedBytes: 1, totalBytes: 2 }]); // > 400 days before 2026-10-09
  history.prune(now, "2026-10-09");
  const ts = history.getSamples(now, 100).map((r) => r.t);
  assert.ok(!ts.includes(now - 49 * 3600));
  assert.ok(ts.includes(now - 3600));
  assert.equal(history.getDiskGrowth("2026-10-09", 365).some((d) => d.points.some((p) => p.day === "2025-01-01")), false);
});

test("alert state round-trips, and saving replaces the old state completely", () => {
  const a = { active: true, checks: 2, since: "t0", severity: "critical", title: "A is down", body: "HTTP 500" };
  const b = { active: false, checks: 1, since: null, severity: "warning", title: "B", body: "" };
  history.saveAlertState({ "service:a": a, "disk:b": b });
  assert.deepEqual(history.loadAlertState(), { "service:a": a, "disk:b": b });

  history.saveAlertState({ "service:a": a });
  assert.deepEqual(Object.keys(history.loadAlertState()), ["service:a"]);
  history.saveAlertState({});
  assert.deepEqual(history.loadAlertState(), {});
});
