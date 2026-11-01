// Disposable CI only. Real Core/Monitor/Tasks APIs and encrypted Bridge
// storage; a scripted condition/clock avoids a fifteen-minute CI wait.
const assert = require("node:assert/strict");
const fs = require("node:fs"), crypto = require("node:crypto");
const { createAutomationStore } = require("../src/automationStore");
const { createAutomation } = require("../src/automation");
const { getJSON } = require("../src/upstream");
async function main() {
  let input = ""; for await (const part of process.stdin) input += part;
  const { ownerToken } = JSON.parse(input), core = "http://homecore:4000", monitor = "http://homemonitor-backend:4800", tasks = "http://hometasks-backend:4700";
  const user = await getJSON(`${core}/api/auth/me`, ownerToken);
  const base = Date.now(); let at = base;
  const enrolled = await getJSON("http://homebridge:4900/api/homebridge/automation/enroll", ownerToken, { method: "POST", body: { consent: true } });
  assert.equal(enrolled.rule.enabled, true);
  assert.ok(!JSON.stringify(enrolled).includes("hc_dg_"));
  const store = createAutomationStore({ directory: process.env.HOMEBRIDGE_DATA_DIR, key: fs.readFileSync(process.env.HOMEBRIDGE_KEY_FILE) });
  const incidentId = crypto.randomUUID();
  const automation = createAutomation({ store, homecoreUrl: core, monitorUrl: monitor, tasksUrl: tasks, now: () => at,
    request: async (url, token, options) => {
      const result = await getJSON(url, token, options);
      if (url.endsWith("/automation/alerts")) return { ...result, evaluatedAt: new Date(at).toISOString(), conditions: [{
        key: "fixture:docker", incidentId, state: "active", severity: "critical", title: "Docker worker proof", openedAt: new Date(base).toISOString()
      }] };
      return result;
    } });
  try {
    const subject = user.id;
    for (let i = 0; i < 4; i++) { at = base + i * 300000; await automation.tick(); }
    const list = await getJSON(`${tasks}/api/hometasks/tasks?status=all`, ownerToken);
    assert.equal(list.tasks.filter(task => task.title === "Review HomeMonitor alert: Docker worker proof").length, 1);
    assert.equal(store.db.prepare("SELECT state FROM bridge_intents WHERE subject = ?").get(subject).state, "delivered");
    const disabled = await getJSON("http://homebridge:4900/api/homebridge/automation/disable", ownerToken, { method: "POST", body: {} });
    assert.equal(disabled.rule.enabled, false); assert.equal(disabled.rule.revocationPending, false);
    assert.equal((await getJSON(`${core}/api/core/delegations`, ownerToken)).grants[0].status, "revoked");
    console.log("ok encrypted Docker worker qualification, single owned task and disable/surrender");
  } finally { automation.stop(); store.close(); }
}
main().catch(() => { console.error("Docker worker smoke test failed."); process.exitCode = 1; });
