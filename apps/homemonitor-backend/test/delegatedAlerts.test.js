const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { spawnSync } = require("node:child_process");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerUser } = require("../../../homecore/test/helpers/client");
let ctx, user, issued, delegated;
const route = "/api/homemonitor/automation/alerts";
before(async () => {
  ctx = await startTestApp(); user = await registerUser(ctx.homecore.baseUrl);
  issued = (await user.client.post("/internal/delegations", { integrationId: "monitor-followup-v1", consent: true })).body;
  delegated = makeClient(ctx.baseUrl); delegated.setToken(issued.capabilities.find(c => c.audience === "homemonitor").token);
});
after(stopTestApp);
test("delegated feed is unavailable before evaluation and never triggers a synthetic collection", async () => {
  assert.equal((await delegated.get(route)).status, 503);
  assert.equal(ctx.history.loadAlertFeed().evaluatedAt, null);
});
test("feed is a curated projection with durable identity and committed evaluation time", async () => {
  ctx.machine.at = Date.now(); ctx.machine.service = "down";
  await ctx.monitor.tick(); ctx.machine.at += 1000; await ctx.monitor.tick();
  const reply = await delegated.get(route);
  assert.equal(reply.status, 200); assert.equal(reply.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(reply.body).sort(), ["conditions", "evaluatedAt", "instanceId"]);
  const alert = reply.body.conditions.find(c => c.key === "service:homecloud");
  assert.equal(alert.state, "active"); assert.equal(alert.severity, "critical");
  assert.match(alert.incidentId, /^[0-9a-f-]{36}$/);
  assert.equal(reply.body.evaluatedAt, new Date(ctx.machine.at).toISOString());
  assert.deepEqual(Object.keys(alert).sort(), ["incidentId", "key", "openedAt", "severity", "state", "title"]);
  assert.ok(!JSON.stringify(reply.body).includes("HTTP 500"));
  assert.equal((await delegated.get(`${route}?subjectUserId=2`)).status, 400);
  const saved = ctx.history.loadAlertState();
  try {
    ctx.db.prepare("UPDATE alert_state SET title = ? WHERE key = 'service:homecloud'").run(`bad\u0000${"x".repeat(250)}`);
    const bounded = (await delegated.get(route)).body.conditions.find(c => c.key === alert.key);
    assert.equal(bounded.title.length, 200); assert.ok(!bounded.title.includes("\u0000"));
    ctx.history.saveAlertState(Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`fixture:${i}`, saved[alert.key]])));
    assert.equal((await delegated.get(route)).status, 503);
    ctx.history.saveAlertState({ ["x".repeat(257)]: saved[alert.key] });
    assert.equal((await delegated.get(route)).status, 503);
  } finally { ctx.history.saveAlertState(saved); }
});
test("unknown services and missing conditions keep identity without claiming positive resolution", async () => {
  const first = (await delegated.get(route)).body.conditions.find(c => c.key === "service:homecloud");
  ctx.machine.service = "unknown"; ctx.machine.at += 1000; await ctx.monitor.tick();
  const unknown = (await delegated.get(route)).body.conditions.find(c => c.key === first.key);
  assert.equal(unknown.state, "unknown"); assert.equal(unknown.incidentId, first.incidentId);
  ctx.machine.service = "up"; ctx.machine.at += 1000; await ctx.monitor.tick();
  const clear = (await delegated.get(route)).body.conditions.find(c => c.key === first.key);
  assert.equal(clear.state, "resolved"); assert.equal(clear.incidentId, first.incidentId);
  ctx.machine.service = "down"; await ctx.monitor.tick(); await ctx.monitor.tick();
  assert.notEqual((await delegated.get(route)).body.conditions.find(c => c.key === first.key).incidentId, first.incidentId);
});
test("ordinary sessions and wrong audiences cannot read projection, capabilities cannot read broad Monitor APIs", async () => {
  const browser = makeClient(ctx.baseUrl); browser.setToken(user.token);
  assert.equal((await browser.get(route)).status, 403);
  const wrong = makeClient(ctx.baseUrl); wrong.setToken(issued.capabilities.find(c => c.audience === "hometasks").token);
  assert.equal((await wrong.get(route)).status, 403);
  for (const path of ["status", "history", "disk-growth"]) {
    assert.equal((await delegated.get(`/api/homemonitor/${path}`)).status, 401);
  }
});
test("migration is idempotent, preserves old alerts and histories, and reopening preserves source identity", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "monitor-migration-"));
  let copy;
  try {
    const { ensureIncidentSchema } = require("../src/incidentSchema");
    copy = new Database(path.join(dir, "legacy.db"));
    copy.exec(`CREATE TABLE alert_state (key TEXT PRIMARY KEY, active INTEGER, checks INTEGER, since TEXT, severity TEXT, title TEXT, body TEXT);
      CREATE TABLE samples (ts INTEGER PRIMARY KEY, cpu REAL);
      INSERT INTO samples VALUES (123, 10);
      INSERT INTO alert_state VALUES ('service:legacy', 1, 2, '2026-10-01T00:00:00Z', 'critical', 'Legacy down', 'private detail');`);
    ensureIncidentSchema(copy);
    const first = copy.prepare("SELECT * FROM alert_state").get();
    assert.ok(first.incident_id); assert.equal(first.state, "unknown");
    const identity = copy.prepare("SELECT * FROM monitor_identity").get();
    assert.equal(identity.evaluated_at, null);
    ensureIncidentSchema(copy);
    assert.deepEqual(copy.prepare("SELECT * FROM alert_state").get(), first);
    assert.deepEqual(copy.prepare("SELECT * FROM samples").get(), { ts: 123, cpu: 10 });
    copy.close(); copy = new Database(path.join(dir, "legacy.db")); ensureIncidentSchema(copy);
    assert.deepEqual(copy.prepare("SELECT * FROM monitor_identity").get(), identity);
    assert.equal(copy.prepare("SELECT incident_id FROM alert_state").get().incident_id, first.incident_id);
  } finally { copy?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test("Core refusal and outage fail closed even after successful projection reads", async () => {
  ctx.homecore.db.prepare("UPDATE hc_applications SET enabled = 0 WHERE slug = 'hometasks'").run();
  try { assert.equal((await delegated.get(route)).status, 403); }
  finally { ctx.homecore.db.prepare("UPDATE hc_applications SET enabled = 1 WHERE slug = 'hometasks'").run(); }
  assert.equal((await delegated.get(route)).status, 200);
  const port = ctx.homecore.server.address().port; ctx.homecore.server.closeAllConnections();
  await new Promise(resolve => ctx.homecore.server.close(resolve));
  try { assert.equal((await delegated.get(route)).status, 502); }
  finally { await new Promise(resolve => ctx.homecore.server.listen(port, "127.0.0.1", resolve)); }
  await user.client.delete(`/api/core/delegations/${issued.grant.id}`);
  assert.equal((await delegated.get(route)).status, 403);
});

test("offline restore resets pinned instance and freshness without destroying incidents or notification intent", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "monitor-restore-"));
  const file = path.join(dir, "monitor.db");
  const script = path.resolve(__dirname, "../scripts/reset-restored-identity.js");
  let copy;
  try {
    await ctx.db.backup(file);
    copy = new Database(file);
    const before = copy.prepare("SELECT * FROM monitor_identity").get();
    const alerts = copy.prepare("SELECT * FROM alert_state ORDER BY key").all();
    const outbox = copy.prepare("SELECT * FROM notification_outbox ORDER BY id").all();
    copy.close(); copy = null;
    const result = spawnSync(process.execPath, [script, "--database", file, "--confirm-offline-restore"], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), { reset: true });
    copy = new Database(file);
    const identity = copy.prepare("SELECT * FROM monitor_identity").get();
    assert.notEqual(identity.instance_id, before.instance_id); assert.equal(identity.evaluated_at, null);
    assert.deepEqual(copy.prepare("SELECT * FROM alert_state ORDER BY key").all(), alerts);
    assert.deepEqual(copy.prepare("SELECT * FROM notification_outbox ORDER BY id").all(), outbox);
    copy.close(); copy = null;
    const absent = path.join(dir, "absent.db");
    assert.equal(spawnSync(process.execPath, [script, "--database", absent, "--confirm-offline-restore"]).status, 1);
    assert.equal(fs.existsSync(absent), false);
    assert.equal(spawnSync(process.execPath, [script, "--database", file]).status, 1);
  } finally { copy?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
