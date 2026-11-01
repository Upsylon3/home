// CI only: real Docker-network actions with disposable credentials supplied
// on stdin. No .env, persisted credentials, scheduler or deployment changes.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
async function request(origin, route, token, body, method = body ? "POST" : "GET") {
  const response = await fetch(`${origin}${route}`, { method, redirect: "error", signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const { ownerToken } = JSON.parse(input);
  const core = "http://homecore:4000", monitor = "http://homemonitor-backend:4800", tasks = "http://hometasks-backend:4700";
  const issued = await request(core, "/internal/delegations", ownerToken, { integrationId: "monitor-followup-v1", consent: true });
  assert.equal(issued.status, 201);
  const monitorToken = issued.body.capabilities.find(c => c.audience === "homemonitor").token;
  const tasksToken = issued.body.capabilities.find(c => c.audience === "hometasks").token;
  const taskRoute = "/api/hometasks/automation/tasks";
  try {
    const feed = await request(monitor, "/api/homemonitor/automation/alerts", monitorToken);
    assert.equal(feed.status, 200); assert.ok(feed.body.instanceId); assert.ok(feed.body.evaluatedAt); assert.ok(Array.isArray(feed.body.conditions));
    assert.equal((await request(monitor, "/api/homemonitor/status", monitorToken)).status, 401);
    const payload = { title: "Disposable delegated smoke task", notes: "Source: HomeMonitor\n/monitor/",
      idempotencyKey: createHash("sha256").update("docker-delegated-smoke").digest("hex") };
    assert.equal((await request(tasks, taskRoute, monitorToken, payload)).status, 403);
    const first = await request(tasks, taskRoute, tasksToken, payload); assert.equal(first.status, 201);
    const second = await request(tasks, taskRoute, tasksToken, payload); assert.equal(second.status, 200);
    assert.equal(second.body.receipt.id, first.body.receipt.id);
    const deleted = await request(tasks, `/api/hometasks/tasks/${first.body.receipt.taskId}`, ownerToken, null, "DELETE");
    assert.equal(deleted.status, 200);
    const retired = await request(tasks, taskRoute, tasksToken, payload); assert.equal(retired.status, 200);
    assert.equal(retired.body.receipt.state, "retired");
  } finally {
    assert.equal((await request(core, `/api/core/delegations/${issued.body.grant.id}`, ownerToken, null, "DELETE")).status, 204);
  }
  assert.equal((await request(monitor, "/api/homemonitor/automation/alerts", monitorToken)).status, 403);
  console.log("ok delegated Docker actions, audience isolation, replay, deletion and live revocation");
}
main().catch(() => { console.error("Delegated action smoke test failed."); process.exitCode = 1; });
