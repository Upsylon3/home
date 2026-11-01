const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const monitorHelper = require("../../../apps/homemonitor-backend/test/helpers/app");
const tasksHelper = require("../../../apps/hometasks-backend/test/helpers/app");
const { makeClient, registerUser } = require("../../../homecore/test/helpers/client");
const { createAutomationStore, configuredStore } = require("../src/automationStore");
const { createAutomation, validateFeed } = require("../src/automation");
const { getJSON } = require("../src/upstream");
let monitor, tasks, core, at;
before(async () => { monitor = await monitorHelper.startTestApp(); tasks = await tasksHelper.startTestApp(); core = monitor.homecore; });
after(async () => { try { await tasksHelper.stopTestApp(); } finally { await monitorHelper.stopTestApp(); } });
async function fixture(t, options = {}) {
  at = Date.now(); monitor.machine.at = at; monitor.machine.service = "up"; monitor.machine.disk = 50;
  monitor.history.saveAlertState({}); monitor.db.prepare("DELETE FROM notification_outbox").run(); await monitor.monitor.tick();
  const user = await registerUser(core.baseUrl);
  core.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.user.id);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-automation-"));
  const key = crypto.randomBytes(32);
  const store = createAutomationStore({ directory, key });
  const stores = [store];
  const service = createAutomation({ store, homecoreUrl: core.baseUrl, monitorUrl: monitor.baseUrl, tasksUrl: tasks.baseUrl, now: () => at, ...options });
  t.after(() => { service.stop(); for (const opened of stores.toReversed()) opened.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { user, store, service, directory, key, stores };
}
async function advance(ms = 300000) { at += ms; monitor.machine.at = at; await monitor.monitor.tick(); }
async function critical() { monitor.machine.service = "down"; await monitor.monitor.tick(); await monitor.monitor.tick(); }
async function qualify(service) { for (let i = 0; i < 4; i++) { if (i) await advance(); await service.tick(); } }
const rows = user => tasks.db.prepare("SELECT * FROM tasks WHERE user_id = ?").all(user.user.id);

test("consent enrolls owner only, encrypts both audiences and never persists a browser session", async t => {
  const f = await fixture(t); await f.service.enroll(f.user.user.id, f.user.token);
  const internal = f.store.get(f.user.user.id); const publicView = f.service.status(f.user.user.id);
  assert.equal(publicView.rule.enabled, true); assert.ok(publicView.rule.instanceId);
  assert.ok(!JSON.stringify(internal).includes(f.user.token));
  const caps = f.store.credentials(internal);
  for (const token of Object.values(caps)) {
    assert.match(token, /^hc_dg_/); assert.ok(!JSON.stringify(internal).includes(token)); assert.ok(!JSON.stringify(publicView).includes(token));
  }
  assert.ok(!JSON.stringify(publicView).includes("cipher"));
  const swapped = { ...internal, subject: internal.subject + 1 };
  assert.throws(() => f.store.credentials(swapped));
  assert.throws(() => f.store.decrypt(internal, "hometasks", internal.monitor_cipher));
});
test("four fresh critical readings spanning 15 minutes create one manual inbox task", async t => {
  const f = await fixture(t); await f.service.enroll(f.user.user.id, f.user.token);
  const second = await registerUser(core.baseUrl);
  core.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(second.user.id);
  await f.service.enroll(second.user.id, second.token); await critical();
  for (let i = 0; i < 3; i++) { if (i) await advance(); await f.service.tick(); assert.equal(rows(f.user).length, 0); }
  await advance(); await f.service.tick(); assert.equal(rows(f.user).length, 1);
  const task = rows(f.user)[0]; assert.match(task.title, /^Review HomeMonitor alert:/);
  assert.equal(rows(second).length, 1); assert.notEqual(rows(second)[0].id, task.id);
  const own = makeClient(tasks.baseUrl); own.setToken(f.user.token);
  assert.equal((await own.get(`/api/hometasks/tasks/${rows(second)[0].id}`)).status, 404);
  assert.match(task.notes, /Source: HomeMonitor\nIncident opened: .*\n\/monitor\//);
  assert.equal(task.due_date, null); assert.equal(task.repeat_rule, "none"); assert.equal(task.priority, 0);
  for (let i = 0; i < 4; i++) { await advance(); await f.service.tick(); }
  assert.equal(rows(f.user).length, 1);
  const intent = f.store.db.prepare("SELECT * FROM bridge_intents").get();
  assert.equal(intent.state, "delivered"); assert.equal(intent.payload_cipher, null);
});
test("duplicate, stale, future, warning and unknown evaluations reset incomplete qualification", async t => {
  const f = await fixture(t); await f.service.enroll(f.user.user.id, f.user.token); await critical();
  await f.service.tick(); await f.service.tick();
  assert.equal(f.service.status(f.user.user.id).rule.qualifyingIncidents, 0);
  await advance(121000); // snapshot stays stale relative to the worker clock below
  at += 121000; await f.service.tick(); assert.equal(rows(f.user).length, 0);
  monitor.machine.at = at + 31000; await monitor.monitor.tick(); await f.service.tick();
  assert.equal(rows(f.user).length, 0);
  monitor.machine.at = at; monitor.machine.service = "unknown"; await monitor.monitor.tick();
  at += 300000; monitor.machine.at = at; await monitor.monitor.tick(); await f.service.tick();
  assert.equal(f.service.status(f.user.user.id).rule.qualifyingIncidents, 0);
  monitor.machine.service = "up"; monitor.machine.disk = 85; await monitor.monitor.tick(); await monitor.monitor.tick();
  await advance(); await f.service.tick(); assert.equal(rows(f.user).length, 0);
});
test("qualification requires 15 minutes and resets after a gap over ten minutes", async t => {
  const f = await fixture(t); await f.service.enroll(f.user.user.id, f.user.token); await critical();
  for (let i = 0; i < 4; i++) { if (i) await advance(60000); await f.service.tick(); }
  assert.equal(rows(f.user).length, 0);
  await advance(601000); await f.service.tick(); assert.equal(rows(f.user).length, 0);
  for (let i = 0; i < 3; i++) { await advance(); await f.service.tick(); }
  assert.equal(rows(f.user).length, 1);
});
test("lost task response retries the persisted payload/key and manual deletion remains acknowledged after restart", async t => {
  let lose = true;
  const f = await fixture(t, { request: async (url, token, options) => {
    const response = await getJSON(url, token, options);
    if (url.endsWith("/automation/tasks") && lose) { lose = false; throw new Error("lost fixture response"); }
    return response;
  } });
  await f.service.enroll(f.user.user.id, f.user.token); await critical(); await qualify(f.service);
  assert.equal(rows(f.user).length, 1);
  const pending = f.store.db.prepare("SELECT * FROM bridge_intents").get(); assert.equal(pending.state, "pending");
  assert.ok(pending.payload_cipher); assert.ok(!pending.payload_cipher.includes(rows(f.user)[0].title));
  const taskId = rows(f.user)[0].id;
  const client = makeClient(tasks.baseUrl); client.setToken(f.user.token); await client.delete(`/api/hometasks/tasks/${taskId}`);
  const restarted = createAutomation({ store: f.store, homecoreUrl: core.baseUrl, monitorUrl: monitor.baseUrl, tasksUrl: tasks.baseUrl, now: () => at });
  await advance();
  // Rename after qualification; a retry must use the stored original title.
  monitor.db.prepare("UPDATE alert_state SET title = 'Renamed alert' WHERE key = 'service:homecloud'").run();
  await restarted.tick();
  assert.equal(rows(f.user).length, 0);
  assert.equal(f.store.db.prepare("SELECT state FROM bridge_intents").get().state, "delivered");
});
test("positive resolution cancels uncertain pending delivery without editing the committed task", async t => {
  const f = await fixture(t, { request: async (url, token, options) => {
    const response = await getJSON(url, token, options);
    if (url.endsWith("/automation/tasks")) throw new Error("lost response"); return response;
  } });
  await f.service.enroll(f.user.user.id, f.user.token); await critical(); await qualify(f.service);
  const before = rows(f.user)[0]; monitor.machine.service = "up"; await advance(); await f.service.tick();
  assert.equal(f.store.db.prepare("SELECT state FROM bridge_intents").get().state, "resolved");
  assert.deepEqual(rows(f.user)[0], before);
});
test("restart resets incomplete qualification; concurrent workers do not create duplicates", async t => {
  const f = await fixture(t); await f.service.enroll(f.user.user.id, f.user.token); await critical();
  await f.service.tick(); await advance(); await f.service.tick();
  const otherStore = createAutomationStore({ directory: f.directory, key: f.key });
  const other = createAutomation({ store: otherStore, homecoreUrl: core.baseUrl, monitorUrl: monitor.baseUrl, tasksUrl: tasks.baseUrl, now: () => at });
  f.stores.push(otherStore);
  for (let i = 0; i < 3; i++) { await advance(); await Promise.all([f.service.tick(), other.tick()]); assert.equal(rows(f.user).length, 0); }
  await advance(); await Promise.all([f.service.tick(), other.tick()]); assert.equal(rows(f.user).length, 1);
});
test("source identity change and account invalidation pause; renewal preserves delivery deduplication", async t => {
  const f = await fixture(t); await f.service.enroll(f.user.user.id, f.user.token); await critical(); await qualify(f.service);
  const original = monitor.history.loadAlertFeed().instanceId;
  monitor.db.prepare("UPDATE monitor_identity SET instance_id = ?").run(crypto.randomUUID());
  await advance(); await f.service.tick(); assert.equal(f.service.status(f.user.user.id).rule.reason, "source-changed");
  monitor.db.prepare("UPDATE monitor_identity SET instance_id = ?").run(original);
  await f.service.enroll(f.user.user.id, f.user.token); await qualify(f.service); assert.equal(rows(f.user).length, 1);
  core.db.prepare("UPDATE users SET token_version = token_version + 1 WHERE id = ?").run(f.user.user.id);
  await advance(); await f.service.tick(); assert.equal(f.service.status(f.user.user.id).rule.reason, "grant-refused");
});
test("disable pauses immediately and durably retries surrender after Core outage and restart", async t => {
  let offline = false;
  const request = async (url, token, options) => { if (offline && url.includes("/delegations/surrender")) throw new Error("offline fixture"); return getJSON(url, token, options); };
  const f = await fixture(t, { request }); await f.service.enroll(f.user.user.id, f.user.token); await critical();
  offline = true; const disabled = await f.service.disable(f.user.user.id);
  assert.equal(disabled.enabled, false); assert.equal(disabled.revocationPending, true); assert.equal(disabled.status, "stopping");
  const restarted = createAutomation({ store: f.store, homecoreUrl: core.baseUrl, monitorUrl: monitor.baseUrl, tasksUrl: tasks.baseUrl, now: () => at });
  await restarted.tick();
  assert.equal(restarted.status(f.user.user.id).rule.status, "disabled");
  assert.equal(rows(f.user).length, 0);
  assert.equal((await f.user.client.get("/api/core/delegations")).body.grants[0].status, "revoked");
});
test("missing/wrong keys fail closed; an unconfigured server still offers search", async t => {
  assert.equal(configuredStore({}), null);
  const f = await fixture(t); await f.service.enroll(f.user.user.id, f.user.token);
  const wrong = createAutomationStore({ directory: f.directory, key: crypto.randomBytes(32) });
  f.stores.push(wrong);
  const service = createAutomation({ store: wrong, homecoreUrl: core.baseUrl, monitorUrl: monitor.baseUrl, tasksUrl: tasks.baseUrl, now: () => at });
  assert.equal(service.status(f.user.user.id).rule.reason, "credentials-unavailable");
  await service.tick(); assert.equal(rows(f.user).length, 0);
});
test("enrollment failure after issuance surrenders the grant and exposes only metadata", async t => {
  const f = await fixture(t, { request: async (url, token, options) => {
    if (url.endsWith("/automation/alerts")) throw new Error("unavailable source"); return getJSON(url, token, options);
  } });
  await assert.rejects(f.service.enroll(f.user.user.id, f.user.token), { status: 502 });
  const grants = (await f.user.client.get("/api/core/delegations")).body.grants;
  assert.equal(grants[0].status, "revoked"); assert.equal(f.service.status(f.user.user.id).rule.enabled, false);
  const failedWrite = await fixture(t);
  failedWrite.store.db.exec(`CREATE TEMP TRIGGER refuse_encrypted_persistence BEFORE UPDATE ON bridge_rules
    WHEN NEW.monitor_cipher IS NOT NULL BEGIN SELECT RAISE(ABORT, 'fixture storage failure'); END`);
  await assert.rejects(failedWrite.service.enroll(failedWrite.user.user.id, failedWrite.user.token), { status: 502 });
  assert.equal((await failedWrite.user.client.get("/api/core/delegations")).body.grants[0].status, "revoked");
  assert.equal(failedWrite.store.get(failedWrite.user.user.id).monitor_cipher, null);
});
test("browser controls enforce own-account consent and provide no credentials", async t => {
  const f = await fixture(t);
  const { createApp } = require("../src/app");
  const server = http.createServer(createApp({ homecoreUrl: core.baseUrl, tasksUrl: tasks.baseUrl, automation: f.service }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const client = makeClient(`http://127.0.0.1:${server.address().port}`); client.setToken(f.user.token);
  for (const body of [{}, { consent: false }, { consent: true, userId: 2 }]) assert.equal((await client.post("/api/homebridge/automation/enroll", body)).status, 400);
  const enrolled = await client.post("/api/homebridge/automation/enroll", { consent: true });
  assert.equal(enrolled.status, 200); assert.ok(!JSON.stringify(enrolled.body).includes("hc_dg_")); assert.ok(!JSON.stringify(enrolled.body).includes("cipher"));
  const other = await registerUser(core.baseUrl); client.setToken(other.token);
  assert.equal((await client.get("/api/homebridge/automation")).body.rule, null);
  assert.equal((await client.post("/api/homebridge/automation/enroll", { consent: true })).status, 403);
});
test("malformed incident feeds cannot qualify or dispatch", () => {
  const feed = { instanceId: crypto.randomUUID(), evaluatedAt: new Date(at).toISOString(), conditions: [] };
  assert.throws(() => validateFeed({ ...feed, evaluatedAt: "bad" }, at));
  assert.throws(() => validateFeed({ ...feed, instanceId: "bad" }, at));
  assert.throws(() => validateFeed({ ...feed, conditions: [null] }, at));
});

test("disable during pre-write validation prevents dispatch and enrollment cannot undo a concurrent disable", async t => {
  let mode = null, reads = 0, reached, release;
  let arrived = new Promise(resolve => { reached = resolve; });
  let gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { request: async (url, token, options) => {
    const result = await getJSON(url, token, options);
    if ((mode === "write" && url.endsWith("/automation/alerts") && ++reads === 2) ||
        (mode === "enroll" && url.includes("/internal/delegations"))) { reached(); await gate; }
    return result;
  } });
  await f.service.enroll(f.user.user.id, f.user.token); await critical();
  for (let i = 0; i < 3; i++) { if (i) await advance(); await f.service.tick(); }
  await advance(); mode = "write";
  const cycle = f.service.tick(); await arrived; await f.service.disable(f.user.user.id); release(); await cycle;
  assert.equal(rows(f.user).length, 0); assert.equal(f.service.status(f.user.user.id).rule.enabled, false);
  mode = "enroll"; arrived = new Promise(resolve => { reached = resolve; }); gate = new Promise(resolve => { release = resolve; });
  const enrollment = f.service.enroll(f.user.user.id, f.user.token); await arrived;
  await f.service.disable(f.user.user.id); release(); await enrollment;
  assert.equal(f.service.status(f.user.user.id).rule.enabled, false);
  assert.equal((await f.user.client.get("/api/core/delegations")).body.grants[0].status, "revoked");
});
test("shared SQLite slots bound concurrent workers to four and stale leases cannot dispatch", async t => {
  const f = await fixture(t);
  for (let subject = 1001; subject <= 1006; subject++) { f.store.ensure(subject); f.store.update(subject, { enabled: 1 }); }
  const other = createAutomationStore({ directory: f.directory, key: f.key }); f.stores.push(other);
  for (let i = 0; i < 4; i++) assert.equal((i % 2 ? other : f.store).lease(1001 + i, `worker-${i}`, at), true);
  assert.equal(other.lease(1005, "fifth", at), false);
  at += 60001; assert.equal(other.lease(1001, "replacement", at), true);
  assert.equal(f.store.current(1001, 0, "worker-0", at), false);
  f.store.release(1001, "worker-0"); assert.equal(other.current(1001, 0, "replacement", at), true);
});
test("task daily limit honors a longer Retry-After and keeps canonical pending intent", async t => {
  let calls = 0, status = 429;
  const f = await fixture(t, { request: async (url, token, options) => {
    if (url.endsWith("/automation/tasks")) { calls++; throw Object.assign(new Error("limit fixture"), { status, retryAfter: 3600 }); }
    return getJSON(url, token, options);
  } });
  await f.service.enroll(f.user.user.id, f.user.token); await critical(); await qualify(f.service);
  assert.equal(calls, 1); assert.equal(f.service.status(f.user.user.id).rule.reason, "daily-limit");
  const pending = f.store.db.prepare("SELECT * FROM bridge_intents").get();
  for (let i = 0; i < 3; i++) { await advance(); await f.service.tick(); }
  assert.equal(calls, 1); assert.deepEqual(f.store.db.prepare("SELECT * FROM bridge_intents").get(), pending);
  await advance(3600000); await f.service.tick(); assert.equal(calls, 2);
  status = 409; await advance(3600000); await f.service.tick();
  assert.equal(f.service.status(f.user.user.id).rule.status, "attention");
  assert.equal(f.service.status(f.user.user.id).rule.enabled, false);
});
test("encryption survives actual database reopening and rejects swapped grant context", async t => {
  const f = await fixture(t); await f.service.enroll(f.user.user.id, f.user.token);
  const row = f.store.get(f.user.user.id); const expected = f.store.credentials(row);
  const copy = createAutomationStore({ directory: f.directory, key: f.key }); f.stores.push(copy);
  assert.deepEqual(copy.credentials(copy.get(f.user.user.id)), expected);
  assert.throws(() => copy.credentials({ ...row, grant_id: crypto.randomUUID() }));
  const token = expected.homemonitor;
  assert.ok(!fs.readFileSync(path.join(f.directory, "homebridge.db")).includes(Buffer.from(token)));
  const wal = path.join(f.directory, "homebridge.db-wal");
  if (fs.existsSync(wal)) assert.ok(!fs.readFileSync(wal).includes(Buffer.from(token)));
  f.store.intent(row, crypto.randomUUID(), { title: "Bounded pending summary", notes: "Source: HomeMonitor\n/monitor/" });
  const restored = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-restored-"));
  t.after(() => fs.rmSync(restored, { recursive: true, force: true }));
  await f.store.db.backup(path.join(restored, "homebridge.db"));
  const { spawnSync } = require("node:child_process");
  const maintenance = spawnSync(process.execPath, [path.resolve(__dirname, "../scripts/pause-restored-automation.js"),
    "--database", path.join(restored, "homebridge.db"), "--confirm-offline-restore"], { encoding: "utf8", timeout: 10000 });
  assert.equal(maintenance.status, 0, maintenance.stderr);
  assert.equal(JSON.parse(maintenance.stdout).paused, 1);
  const restoredStore = createAutomationStore({ directory: restored, key: f.key }); f.stores.push(restoredStore);
  const restoredRule = restoredStore.get(f.user.user.id);
  assert.equal(restoredRule.enabled, 0); assert.equal(restoredRule.revocation_pending, 1);
  assert.deepEqual(restoredStore.credentials(restoredRule), expected);
  const pending = restoredStore.pending(restoredRule)[0];
  assert.equal(restoredStore.decrypt(restoredRule, `intent:${restoredRule.instance_id}:${pending.incident_id}`, pending.payload_cipher).title, "Bounded pending summary");
  assert.throws(() => restoredStore.decrypt(restoredRule, `intent:${restoredRule.instance_id}:${crypto.randomUUID()}`, pending.payload_cipher));
});

test("real Core outage resets qualification without writing; local expiry pauses before dispatch", async t => {
  const f = await fixture(t); await f.service.enroll(f.user.user.id, f.user.token); await critical(); await f.service.tick();
  const port = core.server.address().port; core.server.closeAllConnections();
  await new Promise(resolve => core.server.close(resolve));
  try {
    await advance(); await f.service.tick();
    assert.equal(rows(f.user).length, 0);
    assert.equal(f.service.status(f.user.user.id).rule.qualifyingIncidents, 0);
  } finally { await new Promise(resolve => core.server.listen(port, "127.0.0.1", resolve)); }
  f.store.update(f.user.user.id, { expires_at: new Date(at).toISOString(), retry_at: 0 });
  await f.service.tick(); assert.equal(f.service.status(f.user.user.id).rule.reason, "grant-expired");
});
