// Only CI's disposable loopback stack; no deployment credentials or key needed here.
const assert = require("node:assert/strict");
const base = "http://127.0.0.1:8080";
async function call(path, token, method = "GET", body, status = 200) {
  const response = await fetch(`${base}${path}`, { method, redirect: "error", signal: AbortSignal.timeout(5000),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.status, status, `${method} ${path}`);
  return response.json();
}
async function main() {
  const credentials = { username: "ci-reminder-owner", password: "DisposableReminder123!" };
  const verify = process.argv.includes("--verify-restart");
  // nginx may retain a restarted container's old address for up to 10 seconds.
  for (let attempt = 0; attempt < 30; attempt++) {
    const responses = await Promise.all(["/api/health", "/api/hometasks/health"].map(p => fetch(`${base}${p}`)));
    const ready = responses.every(r => r.ok);
    await Promise.all(responses.map(r => r.body.cancel()));
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const owner = await call(`/api/auth/${verify ? "login" : "register"}`, null, "POST", credentials, verify ? 200 : 201);
  let task;
  if (!verify) {
    assert.equal((await call("/api/hometasks/reminders/status", owner.token)).available, true);
    task = (await call("/api/hometasks/tasks", owner.token, "POST", { title: "CI personal reminder", notes: "Must never appear in Core" }, 201)).task;
    task = (await call(`/api/hometasks/tasks/${task.id}`, owner.token, "PATCH", { reminderAt: new Date(Date.now() + 2000).toISOString() })).task;
    const outsider = await call("/api/auth/register", null, "POST", { username: "ci-reminder-other", password: "DisposableOther123!" }, 201);
    await call(`/api/hometasks/tasks/${task.id}`, outsider.token, "PATCH", { reminderAt: null }, 404);
    const privateResponse = await fetch(`${base}/internal/hometasks/reminders`, { method: "POST" });
    assert.equal(privateResponse.status, 404);
    await privateResponse.body.cancel();
  } else {
    const list = await call("/api/hometasks/tasks", owner.token);
    task = list.tasks.find(t => t.title === "CI personal reminder");
    assert.ok(task, "task survives container restart");
  }
  // A simultaneous restart may briefly refuse delivery before Core listens.
  // Allow its persisted one-minute backoff plus the next 30-second tick.
  const deadlineSeconds = verify ? 120 : 45;
  for (let attempt = 0; attempt < deadlineSeconds; attempt++) {
    const current = (await call(`/api/hometasks/tasks/${task.id}`, owner.token)).task;
    const list = (await call("/api/core/notifications", owner.token)).notifications;
    if (current.reminderState === "sent") {
      const matches = list.filter(n => n.applicationSlug === "hometasks" && n.data?.taskId === task.id);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].body, task.title);
      assert.equal(matches[0].title, "Task reminder");
      console.log(verify ? "ok reminder re-acknowledged after Core/Tasks restart without duplicate" : "ok optional key mounts, real scheduled worker, private producer and gateway owner isolation");
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Reminder did not arrive within ${deadlineSeconds} seconds`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
