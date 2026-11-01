const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const Database = require("better-sqlite3");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-receipt-store-"));
process.env.DATA_DIR = dir;
const { db } = require("../src/db");
const { ensureAutomationSchema, createAutomationStore } = require("../src/automationStore");
after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const principal = id => ({ kind: "delegation", subjectUserId: id, integrationId: "monitor-followup-v1",
  audience: "hometasks", action: "tasks.automation.create-once", dailyCreateLimit: 20, expiresAt: "2099-01-01T00:00:00.000Z" });
const intent = value => ({ title: "Stable title", notes: "Stable notes", idempotencyKey: crypto.createHash("sha256").update(value).digest("hex") });
const DAY = Date.parse("2026-11-01T12:00:00.000Z");

// Independent Node processes contend on the real SQLite file. No Core or
// credentials are mocked here: this is specifically the local commit proof.
async function worker() {
  const script = `
    const Database = require(${JSON.stringify(require.resolve("better-sqlite3"))});
    const {createAutomationStore} = require(${JSON.stringify(require.resolve("../src/automationStore"))});
    const db = new Database(process.argv[1]); db.pragma('busy_timeout = 5000');
    const store = createAutomationStore(db, {now: () => ${DAY}});
    process.on('message', ({principal, bodies, crash}) => {
      const results = bodies.map(body => {try {return store.createOnce(principal, body);} catch(e) {return {status:e.status || 500};}});
      db.close();
      if(crash) process.exit(17);
      process.send(results, () => process.exit(0));
    }); process.send('ready');`;
  const child = spawn(process.execPath, ["-e", script, path.join(dir, "hometasks.db")], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let stderr = ""; child.stderr.on("data", chunk => { stderr += chunk; });
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  let results;
  child.on("message", message => { if (message === "ready") resolveReady(); else results = message; });
  const done = new Promise((resolve, reject) => {
    child.on("error", error => { rejectReady(error); reject(error); });
    child.on("exit", code => {
      if (![0, 17].includes(code)) { const error = new Error(stderr || `Worker exited ${code}`); rejectReady(error); reject(error); }
      else resolve({ code, results });
    });
  });
  await ready;
  return { run: message => { child.send(message); return done; } };
}
test("separate processes serialize concurrent receipt creation and the daily cap", { timeout: 15000 }, async () => {
  const a = await worker(); const b = await worker(); const body = intent("same-process-key");
  const same = await Promise.all([a.run({ principal: principal(101), bodies: [body] }), b.run({ principal: principal(101), bodies: [body] })]);
  assert.equal(same.filter(r => r.results[0].created).length, 1);
  assert.equal(same[0].results[0].receipt.id, same[1].results[0].receipt.id);
  const c = await worker(); const d = await worker();
  const batches = await Promise.all([c.run({ principal: principal(102), bodies: Array.from({ length: 13 }, (_, i) => intent(`c-${i}`)) }),
    d.run({ principal: principal(102), bodies: Array.from({ length: 13 }, (_, i) => intent(`d-${i}`)) })]);
  const results = batches.flatMap(r => r.results);
  assert.equal(results.filter(r => r.created).length, 20); assert.equal(results.filter(r => r.status === 429).length, 6);
});
test("process termination after commit but before reply replays the original receipt after reopening", { timeout: 10000 }, async () => {
  const child = await worker(); const body = intent("crash-after-commit");
  const result = await child.run({ principal: principal(103), bodies: [body], crash: true });
  assert.equal(result.code, 17); assert.equal(result.results, undefined);
  const copy = new Database(path.join(dir, "hometasks.db"));
  try {
    ensureAutomationSchema(copy);
    const replay = createAutomationStore(copy, { now: () => DAY }).createOnce(principal(103), body);
    assert.equal(replay.created, false);
    assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM tasks WHERE user_id = 103").get().n, 1);
  } finally { copy.close(); }
});
test("UTC rollover replenishes only new-create capacity; old receipts remain immutable and expiry is rechecked", () => {
  let at = DAY;
  const store = createAutomationStore(db, { now: () => at });
  const owner = principal(104); const body = intent("utc-first");
  const first = store.createOnce(owner, body);
  for (let i = 1; i < 20; i++) store.createOnce(owner, intent(`utc-${i}`));
  assert.throws(() => store.createOnce(owner, intent("utc-overflow")), { status: 429 });
  at = Date.parse("2026-11-02T00:00:00.000Z");
  assert.equal(store.createOnce(owner, intent("utc-next-day")).created, true);
  assert.deepEqual(store.createOnce(owner, body).receipt, first.receipt);
  assert.throws(() => store.createOnce({ ...owner, expiresAt: new Date(at).toISOString() }, body), { status: 403 });
});
test("additive schema preserves ordinary tasks and receipts across repeated migration", () => {
  const id = db.prepare("INSERT INTO tasks (user_id, title, notes) VALUES (105, 'ordinary', 'private notes')").run().lastInsertRowid;
  const before = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  const receipts = db.prepare("SELECT * FROM task_automation_receipts ORDER BY id").all();
  ensureAutomationSchema(db); ensureAutomationSchema(db);
  assert.deepEqual(db.prepare("SELECT * FROM tasks WHERE id = ?").get(id), before);
  assert.deepEqual(db.prepare("SELECT * FROM task_automation_receipts ORDER BY id").all(), receipts);
});
