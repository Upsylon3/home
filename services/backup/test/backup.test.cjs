const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");
const { Worker } = require("node:worker_threads");
const { once } = require("node:events");

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
    const db = new Database(path.join(dir, "app.db"));
    db.exec("CREATE TABLE example (value TEXT); INSERT INTO example VALUES ('restorable')");
    db.close();
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
  f.override("python3", 'case "$*" in *a-failed*) exit 2 ;; esac');
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

function restore(f, name) {
  const archive = f.archives().find((entry) => entry.startsWith(`${name}-backup-`));
  assert.ok(archive);
  const restored = path.join(f.backups, "restored");
  fs.mkdirSync(restored);
  const unpack = spawnSync("tar", ["xzf", path.join(f.backups, archive), "-C", restored], { encoding: "utf8" });
  assert.equal(unpack.status, 0, unpack.stderr);
  return restored;
}

test("a WAL snapshot restores committed data without sidecars or uncommitted rows", unix, (t) => {
  const f = fixture(t);
  const source = f.source("homecore");
  const db = new Database(path.join(source, "app.db"));
  t.after(() => db.close());
  db.pragma("journal_mode = WAL");
  db.exec("INSERT INTO example VALUES ('committed in WAL'); BEGIN; INSERT INTO example VALUES ('uncommitted')");
  assert.ok(fs.statSync(path.join(source, "app.db-wal")).size > 0);
  const result = f.run();
  assert.equal(result.status, 0, result.log);
  const restored = restore(f, "homecore");
  assert.ok(!fs.existsSync(path.join(restored, "app.db-wal")));
  assert.ok(!fs.existsSync(path.join(restored, "app.db-shm")));
  const copy = new Database(path.join(restored, "app.db"));
  t.after(() => copy.close());
  assert.deepEqual(copy.pragma("integrity_check"), [{ integrity_check: "ok" }]);
  assert.deepEqual(copy.prepare("SELECT value FROM example").all(), [
    { value: "restorable" }, { value: "committed in WAL" }
  ]);
  copy.exec("INSERT INTO example VALUES ('writable after restore')");
  db.exec("ROLLBACK");
  assert.equal(db.prepare("SELECT count(*) AS n FROM example").get().n, 2);
});

test("restored snapshots remain transaction-consistent during continuous writes", unix, async (t) => {
  const f = fixture(t);
  const source = f.source("homecore");
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const Database = require(workerData.module);
    const db = new Database(workerData.file);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE generations (value INTEGER, payload BLOB)');
    db.transaction(() => {
      const insert = db.prepare('INSERT INTO generations VALUES (0, zeroblob(1024))');
      for (let i = 0; i < 2500; i++) insert.run();
    })();
    const update = db.prepare('UPDATE generations SET value = value + 1');
    update.run();
    parentPort.postMessage('ready');
    setInterval(() => update.run(), 2);
  `, { eval: true, workerData: { module: require.resolve("better-sqlite3"), file: path.join(source, "app.db") } });
  let result;
  try {
    await once(worker, "message");
    result = f.run({ BACKUP_TIMEOUT_SECONDS: "8" });
  } finally {
    await worker.terminate();
  }
  assert.equal(result.status, 0, result.log);
  const copy = new Database(path.join(restore(f, "homecore"), "app.db"));
  t.after(() => copy.close());
  const row = copy.prepare("SELECT count(*) AS n, min(value) AS lo, max(value) AS hi FROM generations").get();
  assert.equal(row.n, 2500);
  assert.ok(row.lo >= 1);
  assert.equal(row.lo, row.hi, "every row must come from the same committed transaction");
  assert.deepEqual(copy.pragma("integrity_check"), [{ integrity_check: "ok" }]);
});

function cloudSource(f) {
  const source = f.source("homecloud-backend");
  const db = new Database(path.join(source, "homecloud.db"));
  db.exec(`CREATE TABLE files (user_id INTEGER, stored_name TEXT, size INTEGER,
    thumbnail_name TEXT, deleted_at TEXT);
    INSERT INTO files VALUES (1, 'original.db', 7, 'thumb.jpg', '2026-01-01');`);
  db.close();
  const uploads = path.join(source, "uploads", "1");
  fs.mkdirSync(uploads, { recursive: true });
  // A user-uploaded .db is ordinary content, not an application database.
  fs.writeFileSync(path.join(uploads, "original.db"), "payload");
  fs.writeFileSync(path.join(uploads, "thumb.jpg"), "thumbnail");
  return { source, uploads };
}

test("HomeCloud restores referenced uploads and thumbnails, including trash and uploaded .db files", unix, (t) => {
  const f = fixture(t);
  cloudSource(f);
  const result = f.run();
  assert.equal(result.status, 0, result.log);
  const restored = restore(f, "homecloud-backend");
  assert.equal(fs.readFileSync(path.join(restored, "uploads/1/original.db"), "utf8"), "payload");
  assert.equal(fs.readFileSync(path.join(restored, "uploads/1/thumb.jpg"), "utf8"), "thumbnail");
});

for (const problem of ["missing upload", "wrong size", "missing thumbnail", "unsafe reference"]) {
  test(`HomeCloud ${problem} fails restore verification and preserves prior backups`, unix, (t) => {
    const f = fixture(t);
    const { source, uploads } = cloudSource(f);
    const old = f.oldArchive("homecloud-backend");
    if (problem === "missing upload") fs.unlinkSync(path.join(uploads, "original.db"));
    if (problem === "wrong size") fs.writeFileSync(path.join(uploads, "original.db"), "truncated");
    if (problem === "missing thumbnail") fs.unlinkSync(path.join(uploads, "thumb.jpg"));
    if (problem === "unsafe reference") {
      const db = new Database(path.join(source, "homecloud.db"));
      db.exec("UPDATE files SET stored_name = '../outside'");
      db.close();
    }
    const result = f.run();
    assert.equal(result.status, 1, result.log);
    assert.deepEqual(f.archives(), [path.basename(old)]);
    assert.deepEqual(f.partials(), []);
    assert.equal(fs.readdirSync(f.backups).some((name) => name.startsWith(".snapshot-")), false);
  });
}

for (const problem of ["corrupt database", "no database", "uninitialized database", "symlink"]) {
  test(`${problem} is rejected without pruning an older archive`, unix, (t) => {
    const f = fixture(t);
    const source = f.source("homecore");
    const old = f.oldArchive("homecore");
    if (problem === "corrupt database") fs.writeFileSync(path.join(source, "app.db"), "not SQLite");
    if (problem === "no database") fs.unlinkSync(path.join(source, "app.db"));
    if (problem === "uninitialized database") fs.writeFileSync(path.join(source, "app.db"), "");
    if (problem === "symlink") fs.symlinkSync("data.txt", path.join(source, "link"));
    const result = f.run();
    assert.equal(result.status, 1, result.log);
    assert.deepEqual(f.archives(), [path.basename(old)]);
    assert.deepEqual(f.partials(), []);
  });
}

test("a locked database times out, cleans staging and leaves previous backups", unix, (t) => {
  const f = fixture(t);
  const source = f.source("homecore");
  const old = f.oldArchive("homecore");
  const db = new Database(path.join(source, "app.db"));
  t.after(() => db.close());
  db.exec("BEGIN EXCLUSIVE");
  const result = f.run({ BACKUP_TIMEOUT_SECONDS: "1" });
  db.exec("ROLLBACK");
  assert.equal(result.status, 1, result.log);
  assert.deepEqual(f.archives(), [path.basename(old)]);
  assert.deepEqual(f.partials(), []);
  assert.equal(fs.readdirSync(f.backups).some((name) => name.startsWith(".snapshot-")), false);
});

test("an invalid timeout is rejected before touching backups", unix, (t) => {
  const f = fixture(t);
  f.source("homecore");
  const old = f.oldArchive("homecore");
  const result = f.run({ BACKUP_TIMEOUT_SECONDS: "0" });
  assert.equal(result.status, 1);
  assert.match(result.log, /invalid timeout/);
  assert.deepEqual(f.archives(), [path.basename(old)]);
});
