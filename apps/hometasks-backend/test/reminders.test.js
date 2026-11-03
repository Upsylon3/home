const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, randomUUID } = require("node:crypto");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { registerHomeTasksUser, makeClient } = require("./helpers/client");
const { createReminderWorker } = require("../src/reminders");

let ctx, secret, keyFile;
before(async () => {
  ctx = await startTestApp();
  secret = randomBytes(32);
  keyFile = path.join(ctx.dataDir, "disposable-reminder-key");
  fs.writeFileSync(keyFile, secret);
  process.env.HOMETASKS_REMINDER_KEY_FILE = keyFile;
});
after(async () => { delete process.env.HOMETASKS_REMINDER_KEY_FILE; await stopTestApp(); });
const register = () => registerHomeTasksUser(ctx.homecore, ctx.baseUrl);
const future = () => new Date(Date.now() + 3600000).toISOString();
const route = id => `/api/hometasks/tasks/${id}`;
async function taskFor(owner, extra = {}) {
  return (await owner.client.post("/api/hometasks/tasks", { title: "Remember me", notes: "Private notes", ...extra })).body.task;
}
async function schedule(owner, task) {
  const response = await owner.client.patch(route(task.id), { reminderAt: future() });
  assert.equal(response.status, 200);
  return response.body.task;
}
function due(task) {
  ctx.db.prepare("UPDATE tasks SET reminder_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), task.id);
}
const worker = options => createReminderWorker({ db: ctx.db, coreUrl: ctx.homecore.baseUrl, ...options });
const notices = user => ctx.homecore.db.prepare("SELECT * FROM hc_notifications WHERE user_id = ?").all(user.id);
async function produce(body, headers = { "X-Task-Reminder-Key": secret.toString("hex") }) {
  return makeClient(ctx.homecore.baseUrl).post("/internal/hometasks/reminders", body, { headers });
}

test("reminder edits are atomic, owner-scoped and validate explicit future UTC instants", async () => {
  const owner = await register(), other = await register();
  const task = await taskFor(owner);
  assert.equal(task.reminderAt, null);
  assert.equal((await makeClient(ctx.baseUrl).get("/api/hometasks/reminders/status")).status, 401);
  assert.equal((await owner.client.get("/api/hometasks/reminders/status")).body.available, true);
  assert.equal((await other.client.patch(route(task.id), { reminderAt: future() })).status, 404);
  for (const value of ["tomorrow", "2027-02-30T12:00:00.000Z", "2027-01-01T12:00", "2027-01-01T12:00:00+01:00", 123, {}, new Date(0).toISOString(), new Date(Date.now() + 367 * 86400000).toISOString()]) {
    assert.equal((await owner.client.patch(route(task.id), { title: "Must not save", reminderAt: value })).status, 400);
  }
  assert.equal((await owner.client.get(route(task.id))).body.task.title, "Remember me");
  const scheduled = await schedule(owner, task);
  assert.equal(scheduled.reminderState, "scheduled");
  const generation = ctx.db.prepare("SELECT reminder_key FROM tasks WHERE id = ?").get(task.id).reminder_key;
  await owner.client.patch(route(task.id), { reminderAt: scheduled.reminderAt, title: "Edited" });
  assert.equal(ctx.db.prepare("SELECT reminder_key FROM tasks WHERE id = ?").get(task.id).reminder_key, generation);
  delete process.env.HOMETASKS_REMINDER_KEY_FILE;
  try {
    assert.equal((await owner.client.get("/api/hometasks/reminders/status")).body.available, false);
    assert.equal((await owner.client.patch(route(task.id), { reminderAt: new Date(Date.now() + 7200000).toISOString() })).status, 503);
    assert.equal((await owner.client.patch(route(task.id), { reminderAt: null })).status, 200);
  } finally { process.env.HOMETASKS_REMINDER_KEY_FILE = keyFile; }
});

test("real delivery sends only the title to the owner; independent workers and replays deduplicate", async () => {
  const owner = await register(), other = await register();
  const task = await taskFor(owner);
  await schedule(owner, task);
  assert.equal((await worker().tick()).delivered, 0);
  due(task);
  await Promise.all([worker().tick(), worker().tick()]);
  assert.equal(notices(owner.user).length, 1);
  const notice = notices(owner.user)[0];
  assert.equal(notice.title, "Task reminder");
  assert.equal(notice.body, task.title);
  assert.deepEqual(JSON.parse(notice.data_json), { taskId: task.id });
  assert.equal((await owner.client.get(route(task.id))).body.task.reminderState, "sent");
  const otherCore = makeClient(ctx.homecore.baseUrl); otherCore.setToken(other.token);
  assert.equal((await otherCore.get("/api/core/notifications")).body.notifications.length, 0);
  assert.equal((await otherCore.patch(`/api/core/notifications/${notice.id}/read`, {})).status, 404);
  assert.equal((await other.client.get(route(task.id))).status, 404);
});

test("lost response retries after restart without duplicating or replacing the accepted title", async () => {
  const owner = await register(), task = await taskFor(owner);
  await schedule(owner, task); due(task);
  let time = Date.now();
  const lost = worker({ now: () => time, fetchImpl: async (...args) => { const response = await fetch(...args); await response.text(); throw new Error("response lost"); } });
  assert.equal((await lost.tick()).retried, 1);
  await owner.client.patch(route(task.id), { title: "Changed after delivery" });
  assert.equal((await worker({ now: () => time }).tick()).delivered, 0);
  time += 61000;
  assert.equal((await worker({ now: () => time }).tick()).delivered, 1);
  assert.equal(notices(owner.user).length, 1);
  assert.equal(notices(owner.user)[0].body, task.title);
});

test("cancellation, completion, deletion and repeat/reopen do not deliver or inherit reminders", async () => {
  const owner = await register();
  for (const action of ["clear", "complete", "delete"]) {
    const task = await taskFor(owner); await schedule(owner, task); due(task);
    if (action === "clear") await owner.client.patch(route(task.id), { reminderAt: null });
    if (action === "complete") {
      await owner.client.post(`${route(task.id)}/complete`, {});
      assert.equal((await owner.client.patch(route(task.id), { reminderAt: future() })).status, 409);
      assert.equal((await owner.client.post(`${route(task.id)}/reopen`, {})).body.task.reminderAt, null);
    }
    if (action === "delete") await owner.client.delete(route(task.id));
  }
  const repeat = await taskFor(owner, { repeat: "daily", dueDate: "2026-11-03" });
  await schedule(owner, repeat); due(repeat);
  const completed = await owner.client.post(`${route(repeat.id)}/complete?today=2026-11-02`, {});
  assert.equal(completed.body.task.reminderAt, null);
  assert.equal(completed.body.next.reminderAt, null);
  await worker().tick();
  assert.equal(notices(owner.user).length, 0);
});

test("in-flight acknowledgements cannot mark an edited generation as sent", async () => {
  const owner = await register(), task = await taskFor(owner);
  await schedule(owner, task); due(task);
  const sending = worker({ fetchImpl: async (...args) => {
    const response = await fetch(...args);
    await owner.client.patch(route(task.id), { reminderAt: future() });
    return response;
  } });
  await sending.tick();
  const edited = (await owner.client.get(route(task.id))).body.task;
  assert.equal(edited.reminderState, "scheduled");
  assert.equal(edited.reminderSentAt, null);
  assert.equal(notices(owner.user).length, 1); // Already in flight is explicitly not retractable.
  await owner.client.patch(route(task.id), { reminderAt: null });
});

test("credential failures back off; disabled users and disabled app are suppressed", async () => {
  const owner = await register(), task = await taskFor(owner);
  await schedule(owner, task); due(task);
  let time = Date.now();
  assert.equal((await worker({ key: () => randomBytes(32), now: () => time }).tick()).retried, 1);
  assert.equal(notices(owner.user).length, 0);
  ctx.homecore.db.prepare("UPDATE users SET disabled = 1 WHERE id = ?").run(owner.user.id);
  time += 61000;
  assert.equal((await worker({ now: () => time }).tick()).suppressed, 1);
  assert.equal(ctx.db.prepare("SELECT reminder_error FROM tasks WHERE id = ?").get(task.id).reminder_error, "suppressed");
  ctx.homecore.db.prepare("UPDATE users SET disabled = 0 WHERE id = ?").run(owner.user.id);
  assert.equal((await worker().tick()).delivered, 0);
  const second = await taskFor(owner); await schedule(owner, second); due(second);
  ctx.homecore.db.prepare("UPDATE hc_applications SET enabled = 0 WHERE slug = 'hometasks'").run();
  try { assert.equal((await worker().tick()).suppressed, 1); }
  finally { ctx.homecore.db.prepare("UPDATE hc_applications SET enabled = 1 WHERE slug = 'hometasks'").run(); }
});

test("a startup Core outage persists backoff across worker restart and delivers on a later tick", async () => {
  const http = require("node:http");
  const closed = http.createServer();
  await new Promise(resolve => closed.listen(0, "127.0.0.1", resolve));
  const port = closed.address().port;
  await new Promise(resolve => closed.close(resolve));
  const owner = await register(), task = await taskFor(owner);
  await schedule(owner, task); due(task);
  const now = Date.now();
  assert.equal((await worker({ coreUrl: `http://127.0.0.1:${port}`, now: () => now + 100 }).tick()).retried, 1);
  // On real interval boundaries, the retry can fall just after the 60s tick.
  assert.equal((await worker({ now: () => now + 30000 }).tick()).delivered, 0);
  assert.equal((await worker({ now: () => now + 60000 }).tick()).delivered, 0);
  assert.equal((await worker({ now: () => now + 90000 }).tick()).delivered, 1);
  assert.equal(notices(owner.user).length, 1);
});

test("Core producer credential is isolated, payload fixed, replay binding retained and quota enforced", async () => {
  const owner = await register();
  const payload = { deliveryId: randomUUID(), userId: owner.user.id, taskId: 123456, taskTitle: "Fixed notice" };
  assert.equal((await produce(payload, { "X-Internal-Secret": process.env.HOMECORE_INTERNAL_SECRET })).status, 401);
  assert.equal((await produce(payload, { Authorization: `Bearer ${owner.token}` })).status, 401);
  assert.equal((await produce(payload, { "X-Task-Reminder-Key": process.env.HOMECORE_INTERNAL_SECRET })).status, 401);
  assert.equal((await makeClient(ctx.homecore.baseUrl).post("/internal/notifications", {}, { headers: { "X-Task-Reminder-Key": secret.toString("hex") } })).status, 401);
  assert.equal((await makeClient(ctx.homecore.baseUrl).post("/internal/notifications", {}, { headers: { "X-Internal-Secret": secret.toString("hex") } })).status, 401);
  for (const patch of [{ title: "Spoof" }, { userId: "1" }, { taskId: -1 }, { taskTitle: "x".repeat(201) }, { deliveryId: "invalid" }, { taskTitle: "" }]) {
    assert.equal((await produce({ ...payload, ...patch })).status, 400);
  }
  assert.equal((await produce(payload)).status, 201);
  assert.equal((await produce({ ...payload, taskTitle: "Replay" })).status, 200);
  assert.equal((await produce({ ...payload, taskId: 123457 })).status, 409);
  assert.equal(notices(owner.user).length, 1);
  const insert = ctx.homecore.db.prepare("INSERT INTO hc_task_reminder_deliveries VALUES (?, ?, ?, ?, ?)");
  ctx.homecore.db.transaction(() => { for (let i = 0; i < 99; i++) insert.run(randomUUID(), owner.user.id, 100000 + i, 0, Date.now()); })();
  assert.equal((await produce({ ...payload, deliveryId: randomUUID() })).status, 429);
  assert.equal((await produce(payload)).status, 200); // A lost response can still be acknowledged at the limit.
  assert.equal(notices(owner.user).length, 1);
  fs.writeFileSync(keyFile, Buffer.alloc(31));
  try { assert.equal((await produce({ ...payload, deliveryId: randomUUID() })).status, 503); }
  finally { fs.writeFileSync(keyFile, secret); }
});

test("worker bounds a batch, coalesces overlapping ticks and quota failures retry later", async () => {
  const owner = await register();
  const insert = ctx.db.prepare("INSERT INTO tasks (user_id, title, reminder_at, reminder_key) VALUES (?, 'Batch reminder', ?, ?)");
  ctx.db.transaction(() => { for (let i = 0; i < 21; i++) insert.run(owner.user.id, new Date(Date.now() - 1000).toISOString(), randomUUID()); })();
  const sending = worker();
  const first = sending.tick();
  assert.equal(sending.tick(), first);
  assert.equal((await first).delivered, 20);
  assert.equal((await sending.tick()).delivered, 1);
  assert.equal(notices(owner.user).length, 21);
  // Global quota is independent of this recipient's own quota.
  const receipt = ctx.homecore.db.prepare("INSERT INTO hc_task_reminder_deliveries VALUES (?, ?, ?, 0, ?)");
  const total = ctx.homecore.db.prepare("SELECT COUNT(*) AS n FROM hc_task_reminder_deliveries").get().n;
  ctx.homecore.db.transaction(() => { for (let i = total; i < 1000; i++) receipt.run(randomUUID(), 999999, i + 1, Date.now()); })();
  const task = await taskFor(owner); await schedule(owner, task); due(task);
  const now = Date.now();
  assert.equal((await worker({ now: () => now }).tick()).retried, 1);
  const pending = ctx.db.prepare("SELECT reminder_retry_at, reminder_sent_at FROM tasks WHERE id = ?").get(task.id);
  assert.equal(pending.reminder_sent_at, null);
  assert.equal(pending.reminder_retry_at, new Date(now + 3600000).toISOString());
  assert.equal((await worker({ now: () => now + 60000 }).tick()).retried, 0);
  await owner.client.patch(route(task.id), { reminderAt: null });
});
