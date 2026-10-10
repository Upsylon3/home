const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseBackupName, summarizeBackups, readBackups } = require("../src/backups");

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);

test("parseBackupName only accepts finished backup archives", () => {
  assert.equal(parseBackupName("homecore-backup-2026-10-09_02-00-00.tar.gz"), "homecore");
  assert.equal(parseBackupName("homecloud-backend-backup-2026-10-09_02-00-00.tar.gz"), "homecloud-backend");
  assert.equal(parseBackupName("homecore-backup-2026-10-09_02-00-00.tar.gz.partial"), null); // unfinished
  assert.equal(parseBackupName("notes.txt"), null);
});

test("summarizeBackups: ok when every source has a recent backup", () => {
  const files = [
    { name: "a-backup-2026-10-09_02-00-00.tar.gz", size: 100, mtimeMs: NOW - 10 * HOUR },
    { name: "a-backup-2026-10-08_02-00-00.tar.gz", size: 90, mtimeMs: NOW - 34 * HOUR }, // older one is ignored for status
    { name: "b-backup-2026-10-09_02-00-00.tar.gz", size: 50, mtimeMs: NOW - 10 * HOUR }
  ];
  const result = summarizeBackups(files, NOW, 36);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.sources.map((s) => [s.source, s.count, s.ageHours, s.latestSize]), [
    ["a", 2, 10, 100],
    ["b", 1, 10, 50]
  ]);
});

test("summarizeBackups: stale if ANY source is too old, and names it", () => {
  const files = [
    { name: "a-backup-2026-10-09_02-00-00.tar.gz", size: 1, mtimeMs: NOW - 5 * HOUR },
    { name: "b-backup-2026-10-01_02-00-00.tar.gz", size: 1, mtimeMs: NOW - 200 * HOUR }
  ];
  const result = summarizeBackups(files, NOW, 36);
  assert.equal(result.status, "stale");
  assert.match(result.detail, /b not backed up/);
  assert.equal(result.sources.find((s) => s.source === "b").status, "stale");
});

test("summarizeBackups: none when there is nothing usable", () => {
  assert.equal(summarizeBackups([], NOW, 36).status, "none");
  assert.equal(summarizeBackups([{ name: "x.partial", size: 1, mtimeMs: NOW }], NOW, 36).status, "none");
});

test("readBackups reads a real folder, ignoring .partial and unrelated files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backups-test-"));
  const make = (name, ageHours, content = "x") => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    const t = (NOW - ageHours * HOUR) / 1000;
    fs.utimesSync(file, t, t);
  };
  make("homecore-backup-2026-10-09_02-00-00.tar.gz", 3, "12345");
  make("homecore-backup-2026-10-09_09-00-00.tar.gz.partial", 0); // unfinished: must not count
  make("README.txt", 1);

  const result = readBackups(dir, NOW, 36);
  assert.equal(result.status, "ok");
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].latestSize, 5);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("readBackups: not configured is 'unknown'; a missing folder is 'none'", () => {
  assert.equal(readBackups("", NOW, 36).status, "unknown");
  const missing = readBackups(path.join(os.tmpdir(), "definitely-not-here-xyz"), NOW, 36);
  assert.equal(missing.status, "none");
  assert.match(missing.detail, /ENOENT/);
});
