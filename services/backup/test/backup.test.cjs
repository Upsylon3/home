const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const script = path.resolve(__dirname, "../backup.sh");
const unix = { skip: process.platform === "win32" ? "Backup containers require POSIX sh; run these tests in Linux/WSL." : false };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "home-backup-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sources = path.join(root, "sources with spaces");
  const backups = path.join(root, "backups with spaces");
  const bin = path.join(root, "bin");
  for (const dir of [sources, backups, bin]) fs.mkdirSync(dir);
  function source(name) {
    const dir = path.join(sources, name);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "data.txt"), `data for ${name}`);
    fs.writeFileSync(path.join(dir, ".hidden"), "hidden data");
    return dir;
  }
  function oldArchive(name) {
    const file = path.join(backups, `${name}-backup-2020-01-01_00-00-00.tar.gz`);
    fs.writeFileSync(file, "prior archive marker");
    fs.utimesSync(file, 1, 1);
    return file;
  }
  function override(command, body) {
    const resolved = spawnSync("sh", ["-c", `command -v ${command}`], { encoding: "utf8" }).stdout.trim();
    assert.ok(resolved.startsWith("/"));
    // Command names are fixed test constants; paths are quoted for sh.
    const quoted = `'${resolved.replaceAll("'", "'\\''")}'`;
    fs.writeFileSync(path.join(bin, command), `#!/bin/sh\n${body}\nexec ${quoted} "$@"\n`, { mode: 0o755 });
  }
  function run(extraEnv = {}) {
    const result = spawnSync("sh", [script, "--once"], {
      encoding: "utf8", timeout: 10_000,
      env: { ...process.env, BACKUP_SOURCE_DIR: sources, BACKUP_DIR: backups,
        BACKUP_RETENTION_DAYS: "14", BACKUP_INTERVAL_SECONDS: "86400",
        PATH: `${bin}:${process.env.PATH}`, ...extraEnv }
    });
    assert.ifError(result.error);
    return { ...result, log: result.stdout + result.stderr };
  }
  return { sources, backups, source, oldArchive, override, run,
    archives: () => fs.readdirSync(backups).filter((f) => f.endsWith(".tar.gz")),
    partials: () => fs.readdirSync(backups).filter((f) => f.includes(".partial")) };
}

test("successful archives restore ordinary and hidden files before retention", unix, (t) => {
  const f = fixture(t);
  f.source("homecore");
  const old = f.oldArchive("homecore");
  const other = f.oldArchive("other-service");
  const nested = path.join(f.backups, "manual");
  fs.mkdirSync(nested);
  const nestedArchive = path.join(nested, path.basename(old));
  fs.copyFileSync(old, nestedArchive);
  fs.utimesSync(nestedArchive, 1, 1);
  const result = f.run();
  assert.equal(result.status, 0, result.log);
  assert.equal(fs.existsSync(old), false);
  assert.ok(fs.existsSync(other));
  assert.ok(fs.existsSync(nestedArchive));
  const archive = f.archives().find((name) => name.startsWith("homecore-"));
  const restored = path.join(f.backups, "restored");
  fs.mkdirSync(restored);
  const unpack = spawnSync("tar", ["xzf", path.join(f.backups, archive), "-C", restored], { encoding: "utf8" });
  assert.equal(unpack.status, 0, unpack.stderr);
  assert.equal(fs.readFileSync(path.join(restored, "data.txt"), "utf8"), "data for homecore");
  assert.equal(fs.readFileSync(path.join(restored, ".hidden"), "utf8"), "hidden data");
  assert.deepEqual(f.partials(), []);
});

test("archive creation failure preserves old backups and continues other sources", unix, (t) => {
  const f = fixture(t);
  f.source("a-failed"); f.source("b-healthy");
  const failedOld = f.oldArchive("a-failed");
  const healthyOld = f.oldArchive("b-healthy");
  f.override("tar", 'case "$*" in *a-failed*) exit 2 ;; esac');
  const result = f.run();
  assert.equal(result.status, 1);
  assert.ok(fs.existsSync(failedOld));
  assert.equal(fs.existsSync(healthyOld), false);
  assert.match(result.log, /finished 'b-healthy'/);
  assert.doesNotMatch(result.log, /finished 'a-failed'/);
  assert.deepEqual(f.partials(), []);
});

test("archive verification failure never publishes or prunes", unix, (t) => {
  const f = fixture(t);
  f.source("homecore");
  const old = f.oldArchive("homecore");
  f.override("tar", '[ "$1" != tzf ] || exit 2');
  const result = f.run();
  assert.equal(result.status, 1);
  assert.deepEqual(f.archives(), [path.basename(old)]);
  assert.deepEqual(f.partials(), []);
  assert.doesNotMatch(result.log, /finished/);
});

test("publication failure is reported and cannot delete the previous archive", unix, (t) => {
  const f = fixture(t);
  f.source("homecore");
  const old = f.oldArchive("homecore");
  f.override("mv", "exit 1");
  const result = f.run();
  assert.equal(result.status, 1);
  assert.deepEqual(f.archives(), [path.basename(old)]);
  assert.deepEqual(f.partials(), []);
  assert.doesNotMatch(result.log, /finished/);
});

test("retention failure marks the cycle failed but keeps the new archive", unix, (t) => {
  const f = fixture(t);
  f.source("homecore");
  f.oldArchive("homecore");
  f.override("find", "exit 1");
  const result = f.run();
  assert.equal(result.status, 1);
  assert.equal(f.archives().length, 2);
  assert.match(result.log, /retention FAILED/);
});

test("a missing source mount is not a successful empty backup", unix, (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.log, /no source volumes/);
  assert.deepEqual(f.archives(), []);
});

test("invalid retention configuration leaves existing backups untouched", unix, (t) => {
  const f = fixture(t);
  f.source("homecore");
  const old = f.oldArchive("homecore");
  const result = f.run({ BACKUP_RETENTION_DAYS: "-1" });
  assert.equal(result.status, 1);
  assert.deepEqual(f.archives(), [path.basename(old)]);
});

test("a repeated timestamp never replaces a completed archive", unix, (t) => {
  const f = fixture(t);
  f.source("homecore");
  f.override("date", "echo 2026-11-01_01-00-00; exit 0");
  assert.equal(f.run().status, 0);
  const archive = path.join(f.backups, f.archives()[0]);
  const bytes = fs.readFileSync(archive);
  fs.writeFileSync(path.join(f.sources, "homecore", "data.txt"), "changed");
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.log, /destination already exists/);
  assert.deepEqual(fs.readFileSync(archive), bytes);
});

test("a publication collision cannot overwrite the other archive or prune", unix, (t) => {
  const f = fixture(t);
  f.source("homecore");
  const old = f.oldArchive("homecore");
  // Emulate another process winning publication after our existence check.
  f.override("mv", 'printf "other process archive" > "$4"');
  const result = f.run();
  assert.equal(result.status, 1);
  assert.ok(fs.existsSync(old));
  const published = f.archives().find((name) => name !== path.basename(old));
  assert.equal(fs.readFileSync(path.join(f.backups, published), "utf8"), "other process archive");
  assert.deepEqual(f.partials(), []);
  assert.doesNotMatch(result.log, /finished/);
});

test("temporary archive creation failure preserves the previous backup", unix, (t) => {
  const f = fixture(t);
  f.source("homecore");
  const old = f.oldArchive("homecore");
  f.override("mktemp", "exit 1");
  const result = f.run();
  assert.equal(result.status, 1);
  assert.deepEqual(f.archives(), [path.basename(old)]);
  assert.doesNotMatch(result.log, /finished/);
});
