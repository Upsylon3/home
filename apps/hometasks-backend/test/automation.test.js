const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { registerUser, makeClient } = require("../../../homecore/test/helpers/client");
let ctx;
before(async () => { ctx = await startTestApp(); });
after(stopTestApp);
const key = value => crypto.createHash("sha256").update(value).digest("hex");
const intent = value => ({ title: `Review alert ${value}`, notes: "Source: HomeMonitor\n/monitor/", idempotencyKey: key(value) });
async function owner() {
  const user = await registerUser(ctx.homecore.baseUrl);
  ctx.homecore.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.user.id);
  const issued = await user.client.post("/internal/delegations", { integrationId: "monitor-followup-v1", consent: true });
  assert.equal(issued.status, 201);
  const client = makeClient(ctx.baseUrl); client.setToken(issued.body.capabilities.find(c => c.audience === "hometasks").token);
  const browser = makeClient(ctx.baseUrl); browser.setToken(user.token);
  return { ...user, issued: issued.body, delegated: client, browser };
}
const route = "/api/hometasks/automation/tasks";

test("capability creates only its subject's plain inbox task and returns a minimal receipt", async () => {
  const user = await owner();
  const result = await user.delegated.post(route, intent("basic"));
  assert.equal(result.status, 201); assert.equal(result.headers.get("cache-control"), "no-store");
  const receipt = result.body.receipt;
  assert.equal(receipt.state, "active"); assert.equal(receipt.taskUrl, `/tasks/all?task=${receipt.taskId}`);
  assert.deepEqual(Object.keys(result.body), ["receipt"]);
  const row = ctx.db.prepare("SELECT * FROM tasks WHERE id = ?").get(receipt.taskId);
  assert.equal(row.user_id, user.user.id); assert.equal(row.title, intent("basic").title);
  assert.equal(row.project_id, null); assert.equal(row.due_date, null); assert.equal(row.priority, 0);
  assert.equal(row.repeat_rule, "none"); assert.equal(row.completed_at, null);
  const stored = ctx.db.prepare("SELECT * FROM task_automation_receipts WHERE task_id = ?").get(row.id);
  assert.ok(!JSON.stringify(stored).includes(row.notes)); assert.ok(!JSON.stringify(stored).includes(row.title));
});
test("replays return the same receipt without overwriting manually edited or completed tasks", async () => {
  const user = await owner(); const payload = intent("replay");
  const first = await user.delegated.post(route, payload);
  const id = first.body.receipt.taskId;
  assert.equal((await user.browser.patch(`/api/hometasks/tasks/${id}`, { title: "User's title" })).status, 200);
  assert.equal((await user.browser.post(`/api/hometasks/tasks/${id}/complete`, {})).status, 200);
  const second = await user.delegated.post(route, payload);
  assert.equal(second.status, 200); assert.deepEqual(second.body, first.body);
  const row = ctx.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  assert.equal(row.title, "User's title"); assert.ok(row.completed_at);
  assert.equal((await user.delegated.post(route, { ...payload, notes: "changed" })).status, 409);
});
test("manual deletion retires the receipt permanently and changed-payload replay still conflicts", async () => {
  const user = await owner(); const payload = intent("deleted");
  const first = await user.delegated.post(route, payload);
  const receipt = first.body.receipt;
  await user.browser.delete(`/api/hometasks/tasks/${receipt.taskId}`);
  const replay = await user.delegated.post(route, payload);
  assert.equal(replay.status, 200); assert.deepEqual(replay.body.receipt, { ...receipt, state: "retired", taskUrl: null });
  assert.equal(ctx.db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(receipt.taskId), undefined);
  assert.equal((await user.delegated.post(route, { ...payload, title: "changed" })).status, 409);
});
test("strict body validation rejects forged ownership, privilege and automation fields", async () => {
  const user = await owner(); const payload = intent("invalid");
  for (const extra of ["userId", "subjectUserId", "integrationId", "grantId", "projectId", "dueDate", "priority", "repeat", "completedAt"]) {
    assert.equal((await user.delegated.post(route, { ...payload, [extra]: 1 })).status, 400, extra);
  }
  for (const body of [{ ...payload, title: "" }, { ...payload, title: "x".repeat(201) }, { ...payload, title: "bad\u0000title" },
    { ...payload, notes: null }, { ...payload, notes: "x".repeat(5001) }, { ...payload, idempotencyKey: "short" }, {}, []]) {
    assert.equal((await user.delegated.post(route, body)).status, 400);
  }
  assert.equal((await user.delegated.post(`${route}?userId=2`, payload)).status, 400);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE user_id = ?").get(user.user.id).n, 0);
});
test("browser sessions and wrong-audience capabilities cannot use the action; capabilities cannot use ordinary task routes", async () => {
  const user = await owner();
  assert.equal((await user.browser.post(route, intent("jwt"))).status, 403);
  const wrong = makeClient(ctx.baseUrl); wrong.setToken(user.issued.capabilities.find(c => c.audience === "homemonitor").token);
  assert.equal((await wrong.post(route, intent("wrong"))).status, 403);
  for (const [method, path] of [["get", "/tasks"], ["get", "/summary"], ["post", "/tasks"],
    ["patch", "/tasks/1"], ["delete", "/tasks/1"], ["post", "/tasks/1/complete"], ["post", "/tasks/1/reopen"], ["get", "/projects"]]) {
    assert.equal((await user.delegated[method](`/api/hometasks${path}`, {})).status, 401, path);
  }
});
test("same key is isolated per subject and another owner's tasks remain inaccessible", async () => {
  const a = await owner(); const b = await owner(); const body = intent("same-key");
  const one = await a.delegated.post(route, body); const two = await b.delegated.post(route, body);
  assert.equal(one.status, 201); assert.equal(two.status, 201);
  assert.notEqual(one.body.receipt.taskId, two.body.receipt.taskId);
  assert.equal((await a.browser.get(`/api/hometasks/tasks/${two.body.receipt.taskId}`)).status, 404);
});
test("parallel HTTP replays create one task and one receipt", async () => {
  const user = await owner(); const body = intent("parallel");
  const replies = await Promise.all(Array.from({ length: 8 }, () => user.delegated.post(route, body)));
  assert.equal(replies.filter(r => r.status === 201).length, 1);
  assert.equal(replies.filter(r => r.status === 200).length, 7);
  assert.equal(new Set(replies.map(r => r.body.receipt.id)).size, 1);
});
test("daily cap counts deleted tasks, survives renewal and permits successful replays without spending capacity", async () => {
  const user = await owner();
  const replies = await Promise.all(Array.from({ length: 23 }, (_, i) => user.delegated.post(route, intent(`limit-${i}`))));
  assert.equal(replies.filter(r => r.status === 201).length, 20);
  assert.equal(replies.filter(r => r.status === 429).length, 3);
  const limited = replies.find(r => r.status === 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  const firstIndex = replies.findIndex(r => r.status === 201);
  await user.browser.delete(`/api/hometasks/tasks/${replies[firstIndex].body.receipt.taskId}`);
  assert.equal((await user.delegated.post(route, intent(`limit-${firstIndex}`))).status, 200);
  const renewed = await user.client.post(`/internal/delegations/${user.issued.grant.id}/renew`, { consent: true });
  user.delegated.setToken(renewed.body.capabilities.find(c => c.audience === "hometasks").token);
  assert.equal((await user.delegated.post(route, intent("after-renew"))).status, 429);
});
test("live revocation, account invalidation and registry disable refuse new writes and even receipt replays", async () => {
  for (const change of ["revoke", "epoch", "disabled", "role", "registry"]) {
    const user = await owner(); const body = intent(change);
    assert.equal((await user.delegated.post(route, body)).status, 201);
    if (change === "revoke") await user.client.delete(`/api/core/delegations/${user.issued.grant.id}`);
    if (change === "epoch") ctx.homecore.db.prepare("UPDATE users SET token_version = token_version + 1 WHERE id = ?").run(user.user.id);
    if (change === "disabled") ctx.homecore.db.prepare("UPDATE users SET disabled = 1 WHERE id = ?").run(user.user.id);
    if (change === "role") ctx.homecore.db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(user.user.id);
    if (change === "registry") ctx.homecore.db.prepare("UPDATE hc_applications SET enabled = 0 WHERE slug = 'homemonitor'").run();
    try {
      assert.equal((await user.delegated.post(route, body)).status, 403, change);
      assert.equal((await user.delegated.post(route, intent(`${change}-new`))).status, 403, change);
    } finally { ctx.homecore.db.prepare("UPDATE hc_applications SET enabled = 1 WHERE slug = 'homemonitor'").run(); }
  }
});
test("receipt insertion failure rolls back task creation", async () => {
  const user = await owner();
  ctx.db.exec("CREATE TEMP TRIGGER refuse_receipt BEFORE INSERT ON task_automation_receipts BEGIN SELECT RAISE(ABORT, 'fixture'); END");
  try {
    assert.equal((await user.delegated.post(route, intent("rollback"))).status, 500);
    assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE user_id = ?").get(user.user.id).n, 0);
  } finally { ctx.db.exec("DROP TRIGGER refuse_receipt"); }
});
test("Core outage fails closed without inserting a task", async () => {
  const user = await owner();
  const port = ctx.homecore.server.address().port;
  ctx.homecore.server.closeAllConnections();
  await new Promise(resolve => ctx.homecore.server.close(resolve));
  try {
    assert.equal((await user.delegated.post(route, intent("outage"))).status, 502);
    assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE user_id = ?").get(user.user.id).n, 0);
  } finally { await new Promise(resolve => ctx.homecore.server.listen(port, "127.0.0.1", resolve)); }
});
