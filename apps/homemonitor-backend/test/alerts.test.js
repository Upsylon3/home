const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildConditions, evaluateAlerts } = require("../src/alerts");
const { loadConfig } = require("../src/config");

const config = loadConfig({ DISK_ALERT_PERCENT: "80", SERVICE_DOWN_CHECKS: "2", BACKUP_ALERT_CHECKS: "3" });
const T = "2026-10-09T12:00:00.000Z";

function snapshot({ disk = 50, service = "up", backups = "ok" } = {}) {
  return {
    disks: [{ label: "data", usedPercent: disk, usedBytes: disk * 1e9, totalBytes: 100e9 }],
    services: [{ slug: "homecloud", name: "HomeCloud", status: service, detail: service === "down" ? "HTTP 500" : null }],
    backups: { status: backups, detail: backups === "ok" ? null : "Out of date." }
  };
}
const conditionsFor = (opts) => buildConditions(snapshot(opts), config);
const byKey = (list, key) => list.find((c) => c.key === key);

test("buildConditions: disk failing at the threshold, with a margin before it clears", () => {
  const at80 = byKey(conditionsFor({ disk: 80 }), "disk:data");
  assert.equal(at80.failing, true);
  assert.equal(at80.clear, false);
  assert.match(at80.title, /80% full/);

  const at78 = byKey(conditionsFor({ disk: 78 }), "disk:data");
  assert.equal(at78.failing, false);
  assert.equal(at78.clear, false); // below 80 but not below 77: still "active" if it was an alert

  assert.equal(byKey(conditionsFor({ disk: 76 }), "disk:data").clear, true);
  assert.equal(byKey(conditionsFor({ disk: 96 }), "disk:data").severity, "critical");
  assert.equal(byKey(conditionsFor({ disk: 85 }), "disk:data").severity, "warning");
});

test("buildConditions: only 'down' services alert, not 'degraded' or 'unknown'", () => {
  assert.equal(byKey(conditionsFor({ service: "down" }), "service:homecloud").failing, true);
  assert.equal(byKey(conditionsFor({ service: "degraded" }), "service:homecloud").failing, false);
  assert.equal(byKey(conditionsFor({ service: "unknown" }), "service:homecloud").failing, false);
});

test("buildConditions: backups alert when stale or missing, never when unknown", () => {
  assert.equal(byKey(conditionsFor({ backups: "stale" }), "backup").failing, true);
  assert.equal(byKey(conditionsFor({ backups: "none" }), "backup").title, "No backups found");
  assert.equal(byKey(conditionsFor({ backups: "unknown" }), "backup").failing, false);
});

test("buildConditions: an unreadable disk is its own condition", () => {
  const snap = snapshot();
  snap.disks = [{ label: "backups", path: "/backups", error: "ENOENT" }];
  const c = byKey(buildConditions(snap, config), "disk-read:backups");
  assert.equal(c.failing, true);
  assert.equal(c.body, "ENOENT");
});

// Runs a series of snapshots through the state machine, like successive ticks.
function run(opts) {
  let state = {};
  const sent = [];
  for (const o of opts) {
    const { next, notify } = evaluateAlerts(conditionsFor(o), state, T);
    state = next;
    sent.push(notify.map((n) => `${n.kind}:${n.key}`));
  }
  return { state, sent };
}

test("a service must fail twice in a row before it alerts; one blip is ignored", () => {
  const blip = run([{ service: "down" }, { service: "up" }, { service: "down" }, { service: "up" }]);
  assert.deepEqual(blip.sent, [[], [], [], []]); // never two in a row

  const real = run([{ service: "down" }, { service: "down" }, { service: "down" }]);
  assert.deepEqual(real.sent, [[], ["opened:service:homecloud"], []]); // alerts once, not every tick
  assert.equal(real.state["service:homecloud"].active, true);
});

test("an alert resolves once, and a resolved notice names the original problem", () => {
  let state = {};
  for (const o of [{ service: "down" }, { service: "down" }]) state = evaluateAlerts(conditionsFor(o), state, T).next;
  const { next, notify } = evaluateAlerts(conditionsFor({ service: "up" }), state, T);
  assert.equal(notify.length, 1);
  assert.equal(notify[0].kind, "resolved");
  assert.equal(notify[0].title, "Resolved: HomeCloud is not responding");
  assert.deepEqual(next, {});
});

test("a disk hovering around the threshold doesn't flap", () => {
  const { sent } = run([{ disk: 82 }, { disk: 82 }, { disk: 79 }, { disk: 81 }, { disk: 79 }, { disk: 76 }]);
  // opens on the 2nd reading; stays open through 79 and 81 (above the 77 margin); resolves only at 76.
  assert.deepEqual(sent, [[], ["opened:disk:data"], [], [], [], ["resolved:disk:data"]]);
});

test("backup alerts wait for their (longer) grace period", () => {
  const { sent } = run([{ backups: "none" }, { backups: "none" }, { backups: "none" }]);
  assert.deepEqual(sent, [[], [], ["opened:backup"]]); // BACKUP_ALERT_CHECKS = 3
});

test("active alerts keep fresh wording while they last", () => {
  let state = {};
  for (const o of [{ disk: 82 }, { disk: 82 }]) state = evaluateAlerts(conditionsFor(o), state, T).next;
  state = evaluateAlerts(conditionsFor({ disk: 90 }), state, "later").next;
  assert.match(state["disk:data"].title, /90% full/);
  assert.equal(state["disk:data"].since, T); // but "since" stays at when it opened
});

test("state for something that no longer exists is dropped quietly", () => {
  const previous = { "service:gone": { active: true, checks: 5, since: T, severity: "critical", title: "Gone is down", body: "" } };
  const { next, notify } = evaluateAlerts(conditionsFor({}), previous, T);
  assert.equal(next["service:gone"], undefined);
  assert.deepEqual(notify, []);
});
