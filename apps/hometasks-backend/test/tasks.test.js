// Integration tests for the task routes (real HomeCore + real HomeTasks).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { registerHomeTasksUser } = require("./helpers/client");

let baseUrl, homecore;

before(async () => {
  const started = await startTestApp();
  baseUrl = started.baseUrl;
  homecore = started.homecore;
});

after(async () => {
  await stopTestApp();
});

const register = (username) => registerHomeTasksUser(homecore, baseUrl, { username });

// A fixed "today" for the date filters, so these tests never depend on the
// real date they happen to run on.
const TODAY = "2026-10-09";

test("create a task with only a title: sensible defaults", async () => {
  const { client } = await register("task_defaults_user");
  const res = await client.post("/api/hometasks/tasks", { title: "  Buy milk " });
  assert.equal(res.status, 201);
  const { task } = res.body;
  assert.equal(task.title, "Buy milk");
  assert.equal(task.notes, "");
  assert.equal(task.priority, "none");
  assert.equal(task.dueDate, null);
  assert.equal(task.projectId, null);
  assert.equal(task.isDone, false);
  assert.equal(task.completedAt, null);
});

test("create rejects bad input with a 400 and a readable message", async () => {
  const { client } = await register("task_invalid_user");
  const bad = [
    {},
    { title: "   " },
    { title: "x".repeat(201) },
    { title: "ok", priority: "urgent" },
    { title: "ok", dueDate: "2026-02-31" },
    { title: "ok", dueDate: "tomorrow" },
    { title: "ok", notes: 5 },
    { title: "ok", projectId: "7" }
  ];
  for (const body of bad) {
    const res = await client.post("/api/hometasks/tasks", body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok(res.body.error);
  }
});

test("create rejects a project that doesn't exist or belongs to someone else", async () => {
  const owner = await register("task_proj_owner");
  const other = await register("task_proj_other");
  const project = (await owner.client.post("/api/hometasks/projects", { name: "Mine" })).body.project;

  assert.equal((await owner.client.post("/api/hometasks/tasks", { title: "X", projectId: 999999 })).status, 404);
  assert.equal((await other.client.post("/api/hometasks/tasks", { title: "X", projectId: project.id })).status, 404);
});

test("malformed JSON gets a 400, not a 500", async () => {
  const { client, token } = await register("task_badjson_user");
  void client;
  const res = await fetch(`${baseUrl}/api/hometasks/tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{ not json"
  });
  assert.equal(res.status, 400);
});

test("PATCH only changes the fields it is given", async () => {
  const { client } = await register("task_patch_user");
  const { task } = (
    await client.post("/api/hometasks/tasks", { title: "Original", notes: "keep me", priority: "high", dueDate: "2026-10-20" })
  ).body;

  const renamed = await client.patch(`/api/hometasks/tasks/${task.id}`, { title: "Renamed" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.task.title, "Renamed");
  assert.equal(renamed.body.task.notes, "keep me");
  assert.equal(renamed.body.task.priority, "high");
  assert.equal(renamed.body.task.dueDate, "2026-10-20");
});

test("PATCH with null clears the due date and the project; leaving a key out does not", async () => {
  const { client } = await register("task_clear_user");
  const project = (await client.post("/api/hometasks/projects", { name: "P" })).body.project;
  const { task } = (await client.post("/api/hometasks/tasks", { title: "T", dueDate: "2026-10-20", projectId: project.id })).body;

  const untouched = await client.patch(`/api/hometasks/tasks/${task.id}`, { notes: "just notes" });
  assert.equal(untouched.body.task.dueDate, "2026-10-20");
  assert.equal(untouched.body.task.projectId, project.id);

  const cleared = await client.patch(`/api/hometasks/tasks/${task.id}`, { dueDate: null, projectId: null });
  assert.equal(cleared.body.task.dueDate, null);
  assert.equal(cleared.body.task.projectId, null);
});

test("PATCH validates what it is given, and a failed PATCH changes nothing", async () => {
  const { client } = await register("task_patch_invalid_user");
  const { task } = (await client.post("/api/hometasks/tasks", { title: "Stable", priority: "low" })).body;

  // The title is valid but the priority is not: the whole request must fail.
  const res = await client.patch(`/api/hometasks/tasks/${task.id}`, { title: "Changed", priority: "urgent" });
  assert.equal(res.status, 400);

  const after = await client.get(`/api/hometasks/tasks/${task.id}`);
  assert.equal(after.body.task.title, "Stable");
  assert.equal(after.body.task.priority, "low");
});

test("complete and reopen work, and are safe to repeat", async () => {
  const { client } = await register("task_complete_user");
  const { task } = (await client.post("/api/hometasks/tasks", { title: "Finish me" })).body;

  const done = await client.post(`/api/hometasks/tasks/${task.id}/complete`);
  assert.equal(done.body.task.isDone, true);
  assert.ok(done.body.task.completedAt);

  // Ticking again changes nothing, including the original completion time.
  const again = await client.post(`/api/hometasks/tasks/${task.id}/complete`);
  assert.equal(again.status, 200);
  assert.equal(again.body.task.completedAt, done.body.task.completedAt);

  const reopened = await client.post(`/api/hometasks/tasks/${task.id}/reopen`);
  assert.equal(reopened.body.task.isDone, false);
  assert.equal(reopened.body.task.completedAt, null);
  assert.equal((await client.post(`/api/hometasks/tasks/${task.id}/reopen`)).status, 200);
});

test("delete removes a task permanently", async () => {
  const { client } = await register("task_delete_user");
  const { task } = (await client.post("/api/hometasks/tasks", { title: "Bye" })).body;
  assert.equal((await client.delete(`/api/hometasks/tasks/${task.id}`)).status, 200);
  assert.equal((await client.get(`/api/hometasks/tasks/${task.id}`)).status, 404);
  assert.equal((await client.delete(`/api/hometasks/tasks/${task.id}`)).status, 404);
});

test("people can't read, edit, complete or delete each other's tasks", async () => {
  const owner = await register("task_owner_user");
  const stranger = await register("task_stranger_user");
  const { task } = (await owner.client.post("/api/hometasks/tasks", { title: "Private" })).body;
  const base = `/api/hometasks/tasks/${task.id}`;

  assert.equal((await stranger.client.get(base)).status, 404);
  assert.equal((await stranger.client.patch(base, { title: "Hacked" })).status, 404);
  assert.equal((await stranger.client.post(`${base}/complete`)).status, 404);
  assert.equal((await stranger.client.post(`${base}/reopen`)).status, 404);
  assert.equal((await stranger.client.delete(base)).status, 404);
  assert.equal((await stranger.client.get("/api/hometasks/tasks")).body.tasks.length, 0);

  const intact = await owner.client.get(base);
  assert.equal(intact.body.task.title, "Private");
  assert.equal(intact.body.task.isDone, false);
});

test("the list shows open tasks by default, sorted by due date, then priority", async () => {
  const { client } = await register("task_sort_user");
  const mk = (body) => client.post("/api/hometasks/tasks", body);
  await mk({ title: "no date" });
  await mk({ title: "late low", dueDate: "2026-10-30", priority: "low" });
  await mk({ title: "soon low", dueDate: "2026-10-10", priority: "low" });
  await mk({ title: "soon high", dueDate: "2026-10-10", priority: "high" });
  const finished = (await mk({ title: "already done", dueDate: "2026-10-01" })).body.task;
  await client.post(`/api/hometasks/tasks/${finished.id}/complete`);

  const list = await client.get("/api/hometasks/tasks");
  assert.deepEqual(
    list.body.tasks.map((t) => t.title),
    ["soon high", "soon low", "late low", "no date"] // done task hidden, undated last
  );
});

test("status filter: done lists finished tasks, newest completion first; all lists both", async () => {
  const { client } = await register("task_status_user");
  const a = (await client.post("/api/hometasks/tasks", { title: "A" })).body.task;
  const b = (await client.post("/api/hometasks/tasks", { title: "B" })).body.task;
  await client.post("/api/hometasks/tasks", { title: "C (open)" });
  await client.post(`/api/hometasks/tasks/${a.id}/complete`);
  await client.post(`/api/hometasks/tasks/${b.id}/complete`);

  const done = await client.get("/api/hometasks/tasks?status=done");
  assert.equal(done.body.tasks.length, 2);
  assert.ok(done.body.tasks.every((t) => t.isDone));

  assert.equal((await client.get("/api/hometasks/tasks?status=all")).body.tasks.length, 3);
  assert.equal((await client.get("/api/hometasks/tasks?status=bogus")).status, 400);
});

test("due filters: overdue, today, upcoming, none (relative to the browser's date)", async () => {
  const { client } = await register("task_due_user");
  const mk = (title, dueDate) => client.post("/api/hometasks/tasks", { title, dueDate });
  await mk("yesterday", "2026-10-08");
  await mk("today", TODAY);
  await mk("tomorrow", "2026-10-10");
  await mk("someday");

  const titles = async (due) =>
    (await client.get(`/api/hometasks/tasks?due=${due}&today=${TODAY}`)).body.tasks.map((t) => t.title);

  assert.deepEqual(await titles("overdue"), ["yesterday"]);
  assert.deepEqual(await titles("today"), ["today"]);
  assert.deepEqual(await titles("upcoming"), ["tomorrow"]);
  assert.deepEqual(await titles("none"), ["someday"]);
  assert.equal((await client.get(`/api/hometasks/tasks?due=nonsense&today=${TODAY}`)).status, 400);
});

test("project filter only returns that project's tasks, and rejects someone else's project", async () => {
  const a = await register("task_pf_a");
  const b = await register("task_pf_b");
  const project = (await a.client.post("/api/hometasks/projects", { name: "Filter me" })).body.project;
  await a.client.post("/api/hometasks/tasks", { title: "inside", projectId: project.id });
  await a.client.post("/api/hometasks/tasks", { title: "outside" });

  const res = await a.client.get(`/api/hometasks/tasks?projectId=${project.id}`);
  assert.deepEqual(res.body.tasks.map((t) => t.title), ["inside"]);
  assert.equal((await b.client.get(`/api/hometasks/tasks?projectId=${project.id}`)).status, 404);
});

test("search matches title or notes, case-insensitively, and treats % and _ literally", async () => {
  const { client } = await register("task_search_user");
  await client.post("/api/hometasks/tasks", { title: "Call the Plumber" });
  await client.post("/api/hometasks/tasks", { title: "Other", notes: "ask about the PLUMBER's fee" });
  await client.post("/api/hometasks/tasks", { title: "Pay 50% deposit" });
  await client.post("/api/hometasks/tasks", { title: "Unrelated" });

  const titles = async (q) =>
    (await client.get(`/api/hometasks/tasks?search=${encodeURIComponent(q)}`)).body.tasks.map((t) => t.title).sort();

  assert.deepEqual(await titles("plumber"), ["Call the Plumber", "Other"]);
  assert.deepEqual(await titles("50%"), ["Pay 50% deposit"]);
  assert.deepEqual(await titles("%"), ["Pay 50% deposit"]); // a bare % must not match everything
});

test("summary counts open, overdue and due-today tasks (done tasks never count)", async () => {
  const { client } = await register("task_summary_user");
  const mk = (title, dueDate) => client.post("/api/hometasks/tasks", { title, dueDate });
  await mk("late", "2026-10-01");
  await mk("late 2", "2026-10-08");
  await mk("today", TODAY);
  await mk("later", "2026-11-01");
  const doneLate = (await mk("done and late", "2026-09-01")).body.task;
  await client.post(`/api/hometasks/tasks/${doneLate.id}/complete`);

  const res = await client.get(`/api/hometasks/summary?today=${TODAY}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { open: 4, overdue: 2, dueToday: 1 });

  const empty = await (await register("task_summary_empty")).client.get(`/api/hometasks/summary?today=${TODAY}`);
  assert.deepEqual(empty.body, { open: 0, overdue: 0, dueToday: 0 });
});

test("a non-numeric task id is a clean 404", async () => {
  const { client } = await register("task_badid_user");
  assert.equal((await client.get("/api/hometasks/tasks/abc")).status, 404);
  assert.equal((await client.patch("/api/hometasks/tasks/abc", { title: "x" })).status, 404);
});
