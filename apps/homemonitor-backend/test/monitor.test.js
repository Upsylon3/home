// The whole tick loop with a pretend machine: a scripted collector, the real
// database, and a recording notifier. DATA_DIR must be set before src/db loads.
const fs = require("fs");
const os = require("os");
const path = require("path");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "homemonitor-loop-"));

const { test, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const history = require("../src/history");
const { db } = require("../src/db");
const { createMonitor } = require("../src/monitor");
const { loadConfig } = require("../src/config");

after(() => {
  db.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  history.saveAlertState({});
  db.prepare("DELETE FROM notification_outbox").run();
  db.prepare("UPDATE monitor_identity SET evaluated_at = NULL").run();
  db.prepare("DELETE FROM samples").run();
});

const BASE = Date.UTC(2026, 9, 9, 12, 0, 0);

// A collector whose "machine" can be changed between ticks.
function pretendMachine() {
  const machine = { disk: 50, service: "up", at: BASE };
  const collector = {
    collect: async () => ({
      at: new Date(machine.at).toISOString(),
      system: { cpuPercent: 10, memory: { percent: 30 }, network: null, loadAverage: [0, 0, 0], uptimeSeconds: 5 },
      disks: [{ label: "data", usedPercent: machine.disk, usedBytes: machine.disk * 1e9, totalBytes: 100e9 }],
      services: [{ slug: "homecloud", name: "HomeCloud", status: machine.service, detail: machine.service === "down" ? "HTTP 500" : null }],
      registryError: null,
      backups: { status: "ok", detail: null, sources: [] }
    })
  };
  return { machine, collector };
}

function build(overrides = {}) {
  const { machine, collector } = pretendMachine();
  const sent = [];
  const config = loadConfig({ SERVICE_DOWN_CHECKS: "2", SAMPLE_EVERY_SECONDS: "300", ...overrides.env });
  const notifier = overrides.notifier || (async (items) => void sent.push(...items));
  const monitor = createMonitor({ config, collector, history, notifier, now: () => machine.at });
  return { machine, monitor, sent };
}

test("an alert opens after two bad readings, notifies once, and resolves once", async () => {
  const { machine, monitor, sent } = build();
  machine.service = "down";
  await monitor.tick();
  assert.equal(sent.length, 0); // one failure: not yet
  await monitor.tick();
  assert.deepEqual(sent.map((n) => [n.kind, n.title]), [["opened", "HomeCloud is not responding"]]);
  await monitor.tick();
  assert.equal(sent.length, 1); // still down, but no repeat notification

  const status = await monitor.getStatus();
  assert.deepEqual(status.alerts.map((a) => a.key), ["service:homecloud"]);

  machine.service = "up";
  await monitor.tick();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].kind, "resolved");
  assert.deepEqual((await monitor.getStatus()).alerts, []);
});

test("critical alerts are listed before warnings", async () => {
  const { machine, monitor } = build();
  machine.disk = 85;
  machine.service = "down";
  await monitor.tick();
  await monitor.tick();
  const { alerts } = await monitor.getStatus();
  assert.deepEqual(alerts.map((a) => a.severity), ["critical", "warning"]);
});

test("if HomeCore can't be told, nothing is lost: the alert is retried on the next tick", async () => {
  let attempts = 0;
  const delivered = [];
  const { machine, monitor } = build({
    notifier: async (items) => {
      attempts += 1;
      if (attempts === 1) throw new Error("HomeCore unreachable");
      delivered.push(...items);
    }
  });
  machine.service = "down";
  await monitor.tick(); // failing reading #1
  await monitor.tick(); // reading #2 opens the alert, but sending fails
  assert.equal(delivered.length, 0);
  assert.equal((await monitor.getStatus()).alerts.length, 1); // evaluation commits before notification delivery
  const incidentId = history.loadAlertFeed().conditions.find(c => c.key === "service:homecloud").incidentId;
  assert.ok(incidentId);
  assert.equal(history.pendingNotifications().length, 1);
  assert.equal((await monitor.getStatus()).notifyError, "HomeCore unreachable");

  await monitor.tick(); // worked out again and sent successfully
  assert.equal(delivered.length, 1);
  assert.equal((await monitor.getStatus()).alerts.length, 1);
  assert.equal((await monitor.getStatus()).notifyError, null);
  assert.equal(history.pendingNotifications().length, 0);
  assert.equal(history.loadAlertFeed().conditions.find(c => c.key === "service:homecloud").incidentId, incidentId);
});

test("incident identity survives severity, unknown readings and monitor restart, changing only after positive clear", async () => {
  const { machine, monitor } = build();
  machine.disk = 96; await monitor.tick(); await monitor.tick();
  const first = history.loadAlertFeed();
  const incident = first.conditions.find(c => c.key === "disk:data");
  assert.equal(incident.state, "active"); assert.equal(incident.severity, "critical");
  machine.disk = 85; machine.at += 1000; await monitor.tick();
  assert.equal(history.loadAlertFeed().conditions.find(c => c.key === incident.key).incidentId, incident.incidentId);
  // A new orchestrator reads durable identity/state, not process-local memory.
  const restarted = createMonitor({ config: loadConfig({}), collector: { collect: async () => ({
    at: new Date(machine.at + 1000).toISOString(), system: { cpuPercent: 0, memory: { percent: 0 } },
    disks: [{ label: "data", error: "EIO" }], services: [], backups: { status: "unknown" }
  }) }, history, notifier: async () => {}, now: () => machine.at + 1000 });
  await restarted.tick();
  const unknown = history.loadAlertFeed().conditions.find(c => c.key === incident.key);
  assert.equal(unknown.state, "unknown"); assert.equal(unknown.incidentId, incident.incidentId);
  assert.equal(history.loadAlertFeed().instanceId, first.instanceId);
  machine.disk = 96; await monitor.tick();
  assert.equal(history.loadAlertFeed().conditions.find(c => c.key === incident.key).incidentId, incident.incidentId);
  machine.disk = 50; await monitor.tick();
  assert.equal(history.loadAlertFeed().conditions.find(c => c.key === incident.key).state, "resolved");
  machine.disk = 96; await monitor.tick(); await monitor.tick();
  assert.notEqual(history.loadAlertFeed().conditions.find(c => c.key === incident.key).incidentId, incident.incidentId);
});

test("notification outage followed by resolution retains ordered durable retry intent across restart", async () => {
  const { machine, monitor } = build({ notifier: async () => { throw new Error("offline fixture"); } });
  machine.service = "down"; await monitor.tick(); await monitor.tick();
  const first = history.loadAlertFeed();
  machine.service = "up"; machine.at += 300000; await monitor.tick();
  assert.deepEqual(history.pendingNotifications().map(n => n.payload.kind), ["opened", "resolved"]);
  assert.equal(history.loadAlertFeed().evaluatedAt, new Date(machine.at).toISOString());
  assert.equal(history.loadAlertFeed().conditions.find(c => c.key === "service:homecloud").state, "resolved");
  const sent = [];
  const restart = createMonitor({ config: loadConfig({}), collector: pretendMachine().collector,
    history, notifier: async items => sent.push(...items), now: () => BASE });
  await restart.tick();
  assert.deepEqual(sent.map(n => n.kind), ["opened", "resolved"]);
  assert.equal(history.pendingNotifications().length, 0);
  assert.equal(history.loadAlertFeed().instanceId, first.instanceId);
});

test("evaluation failure rolls back state, freshness and notification intent together", async () => {
  const { machine, monitor } = build();
  await monitor.tick(); machine.service = "down"; await monitor.tick();
  const before = history.loadAlertFeed();
  const state = history.loadAlertState();
  db.exec("CREATE TEMP TRIGGER refuse_notification BEFORE INSERT ON notification_outbox BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
  try {
    machine.at += 300000;
    await assert.rejects(monitor.tick());
    assert.deepEqual(history.loadAlertState(), state);
    assert.deepEqual(history.loadAlertFeed(), before);
    assert.equal(history.pendingNotifications().length, 0);
  } finally { db.exec("DROP TRIGGER refuse_notification"); }
});

test("with alerts switched off, nothing is sent but the alert still shows on screen", async () => {
  const { machine, monitor, sent } = build({ env: { ALERTS_ENABLED: "false" } });
  machine.service = "down";
  await monitor.tick();
  await monitor.tick();
  assert.equal(sent.length, 0);
  const status = await monitor.getStatus();
  assert.equal(status.alertsEnabled, false);
  assert.equal(status.alerts.length, 1);
});

test("a full notification queue fails evaluation closed but still drains and recovers next tick", async () => {
  const { machine, monitor, sent } = build();
  machine.service = "down"; await monitor.tick();
  const before = history.loadAlertFeed();
  const insert = db.prepare("INSERT INTO notification_outbox (payload_json) VALUES (?)");
  db.transaction(() => {
    for (let i = 0; i < 1000; i++) insert.run(JSON.stringify({ key: `fixture:${i}`, kind: "opened", severity: "warning", title: "Queued", body: "" }));
  })();
  machine.at += 1000;
  await assert.rejects(monitor.tick(), /queue is full/);
  assert.deepEqual(history.loadAlertFeed(), before);
  assert.equal(sent.length, 100);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 900);
  await monitor.tick();
  assert.equal(history.loadAlertFeed().conditions.find(c => c.key === "service:homecloud").state, "active");
  assert.equal(history.loadAlertFeed().evaluatedAt, new Date(machine.at).toISOString());
});

test("history is saved every few minutes, not on every tick", async () => {
  const { machine, monitor } = build();
  for (const offsetSeconds of [0, 30, 60, 299, 300, 330]) {
    machine.at = BASE + offsetSeconds * 1000;
    await monitor.tick();
  }
  const rows = history.getSamples(Math.floor((BASE + 400_000) / 1000), 1);
  assert.deepEqual(rows.map((r) => r.t - BASE / 1000), [0, 300]);
});

test("getStatus takes a first reading itself if the timer hasn't ticked yet", async () => {
  const { monitor } = build();
  const status = await monitor.getStatus();
  assert.equal(status.disks[0].label, "data");
  assert.ok(Array.isArray(status.alerts));
});

test("overlapping ticks don't pile up: a second call while one is running is a no-op", async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let collectCalls = 0;
  const collector = {
    collect: async () => {
      collectCalls += 1;
      await gate;
      return pretendMachine().collector.collect();
    }
  };
  const monitor = createMonitor({
    config: loadConfig({}),
    collector,
    history,
    notifier: async () => {},
    now: () => BASE
  });
  const first = monitor.tick();
  await monitor.tick(); // returns immediately: one is already running
  assert.equal(collectCalls, 1);
  release();
  await first;
});
