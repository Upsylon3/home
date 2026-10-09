// Integration tests for REPEATING tasks (real HomeCore + real HomeTasks).
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

// A fixed "today" (a Friday), so no test depends on the real date.
const TODAY = "2026-10-09";

test("a normal task has repeat 'none' and completing it creates nothing new", async () => {
  const { client } = await register("rep_normal_user");
  const { task } = (await client.post("/api/hometasks/tasks", { title: "One-off", dueDate: TODAY })).body;
  assert.equal(task.repeat, "none");

  const res = await client.post(`/api/hometasks/tasks/${task.id}/complete?today=${TODAY}`);
  assert.equal(res.body.next, null);
  assert.equal((await client.get("/api/hometasks/tasks?status=all")).body.tasks.length, 1);
});

test("create validates repeat, and a repeating task needs a due date", async () => {
  const { client } = await register("rep_validate_user");
  const bad = await client.post("/api/hometasks/tasks", { title: "X", dueDate: TODAY, repeat: "hourly" });
  assert.equal(bad.status, 400);

  const noDate = await client.post("/api/hometasks/tasks", { title: "X", repeat: "daily" });
  assert.equal(noDate.status, 400);
  assert.match(noDate.body.error, /due date/i);

  const ok = await client.post("/api/hometasks/tasks", { title: "X", dueDate: TODAY, repeat: "weekly" });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.task.repeat, "weekly");
});

test("completing a repeating task keeps it as Done and creates the next copy", async () => {
  const { client } = await register("rep_complete_user");
  const project = (await client.post("/api/hometasks/projects", { name: "Chores" })).body.project;
  const { task } = (
    await client.post("/api/hometasks/tasks", {
      title: "Water plants",
      notes: "the ferns too",
      priority: "high",
      dueDate: TODAY,
      repeat: "weekly",
      projectId: project.id
    })
  ).body;

  const res = await client.post(`/api/hometasks/tasks/${task.id}/complete?today=${TODAY}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.task.isDone, true);

  // The new copy carries everything over, with the next due date.
  const { next } = res.body;
  assert.notEqual(next.id, task.id);
  assert.equal(next.isDone, false);
  assert.equal(next.dueDate, "2026-10-16");
  assert.equal(next.title, "Water plants");
  assert.equal(next.notes, "the ferns too");
  assert.equal(next.priority, "high");
  assert.equal(next.repeat, "weekly");
  assert.equal(next.projectId, project.id);

  // One open, one done.
  assert.equal((await client.get("/api/hometasks/tasks")).body.tasks.length, 1);
  assert.equal((await client.get("/api/hometasks/tasks?status=done")).body.tasks.length, 1);
});

test("completing twice (a double click) creates only ONE next copy", async () => {
  const { client } = await register("rep_idempotent_user");
  const { task } = (await client.post("/api/hometasks/tasks", { title: "Daily", dueDate: TODAY, repeat: "daily" })).body;

  await client.post(`/api/hometasks/tasks/${task.id}/complete?today=${TODAY}`);
  const again = await client.post(`/api/hometasks/tasks/${task.id}/complete?today=${TODAY}`);
  assert.equal(again.status, 200);
  assert.equal(again.body.next, null);

  assert.equal((await client.get("/api/hometasks/tasks?status=all")).body.tasks.length, 2);
});

test("the next copy is always after today, even if the task was long overdue", async () => {
  const { client } = await register("rep_overdue_user");
  const { task } = (await client.post("/api/hometasks/tasks", { title: "Ignored", dueDate: "2026-10-01", repeat: "daily" })).body;
  const res = await client.post(`/api/hometasks/tasks/${task.id}/complete?today=${TODAY}`);
  assert.equal(res.body.next.dueDate, "2026-10-10"); // tomorrow, not Oct 2
});

test("weekdays skips the weekend; monthly keeps its day without drifting", async () => {
  const { client } = await register("rep_calendar_user");
  const friday = (await client.post("/api/hometasks/tasks", { title: "Standup", dueDate: TODAY, repeat: "weekdays" })).body.task;
  const afterFriday = await client.post(`/api/hometasks/tasks/${friday.id}/complete?today=${TODAY}`);
  assert.equal(afterFriday.body.next.dueDate, "2026-10-12"); // Monday

  const rent = (await client.post("/api/hometasks/tasks", { title: "Rent", dueDate: "2027-01-31", repeat: "monthly" })).body.task;
  const feb = (await client.post(`/api/hometasks/tasks/${rent.id}/complete?today=${TODAY}`)).body.next;
  assert.equal(feb.dueDate, "2027-02-28");
  const mar = (await client.post(`/api/hometasks/tasks/${feb.id}/complete?today=${TODAY}`)).body.next;
  assert.equal(mar.dueDate, "2027-03-31"); // back to the 31st, no drift
});

test("reopening removes the still-open next copy, so there is never a duplicate", async () => {
  const { client } = await register("rep_reopen_user");
  const { task } = (await client.post("/api/hometasks/tasks", { title: "Oops", dueDate: TODAY, repeat: "daily" })).body;
  const { next } = (await client.post(`/api/hometasks/tasks/${task.id}/complete?today=${TODAY}`)).body;

  const reopened = await client.post(`/api/hometasks/tasks/${task.id}/reopen`);
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.task.isDone, false);
  assert.equal((await client.get(`/api/hometasks/tasks/${next.id}`)).status, 404); // the copy is gone
  assert.equal((await client.get("/api/hometasks/tasks?status=all")).body.tasks.length, 1);

  // And it can be completed again, creating a fresh next copy.
  const second = await client.post(`/api/hometasks/tasks/${task.id}/complete?today=${TODAY}`);
  assert.ok(second.body.next);
});

test("reopening is refused once the next copy has itself been completed", async () => {
  const { client } = await register("rep_blocked_user");
  const { task } = (await client.post("/api/hometasks/tasks", { title: "Moved on", dueDate: TODAY, repeat: "daily" })).body;
  const { next } = (await client.post(`/api/hometasks/tasks/${task.id}/complete?today=${TODAY}`)).body;
  await client.post(`/api/hometasks/tasks/${next.id}/complete?today=${TODAY}`);

  const res = await client.post(`/api/hometasks/tasks/${task.id}/reopen`);
  assert.equal(res.status, 409);
  assert.equal((await client.get(`/api/hometasks/tasks/${task.id}`)).body.task.isDone, true); // unchanged
});

test("reopening still works if the next copy was deleted meanwhile", async () => {
  const { client } = await register("rep_deleted_next_user");
  const { task } = (await client.post("/api/hometasks/tasks", { title: "Gone", dueDate: TODAY, repeat: "daily" })).body;
  const { next } = (await client.post(`/api/hometasks/tasks/${task.id}/complete?today=${TODAY}`)).body;
  await client.delete(`/api/hometasks/tasks/${next.id}`);

  assert.equal((await client.post(`/api/hometasks/tasks/${task.id}/reopen`)).status, 200);
});

test("PATCH: turn repeating on and off, with the due-date rule enforced on the final values", async () => {
  const { client } = await register("rep_patch_user");
  const { task } = (await client.post("/api/hometasks/tasks", { title: "Plain", dueDate: TODAY })).body;

  const on = await client.patch(`/api/hometasks/tasks/${task.id}`, { repeat: "weekly" });
  assert.equal(on.body.task.repeat, "weekly");

  // Can't clear the due date while it repeats...
  assert.equal((await client.patch(`/api/hometasks/tasks/${task.id}`, { dueDate: null })).status, 400);
  // ...unless the same request also stops the repeating.
  const both = await client.patch(`/api/hometasks/tasks/${task.id}`, { dueDate: null, repeat: "none" });
  assert.equal(both.status, 200);
  assert.equal(both.body.task.dueDate, null);

  // Can't make an undated task repeat.
  assert.equal((await client.patch(`/api/hometasks/tasks/${task.id}`, { repeat: "daily" })).status, 400);
  assert.equal((await client.patch(`/api/hometasks/tasks/${task.id}`, { repeat: "bogus" })).status, 400);
});

test("changing the due date re-anchors a monthly series", async () => {
  const { client } = await register("rep_reanchor_user");
  const { task } = (await client.post("/api/hometasks/tasks", { title: "Bill", dueDate: "2027-01-31", repeat: "monthly" })).body;
  await client.patch(`/api/hometasks/tasks/${task.id}`, { dueDate: "2027-01-15" }); // now the 15th
  const res = await client.post(`/api/hometasks/tasks/${task.id}/complete?today=${TODAY}`);
  assert.equal(res.body.next.dueDate, "2027-02-15");
});

test("people can't complete or reopen each other's repeating tasks", async () => {
  const owner = await register("rep_owner_user");
  const stranger = await register("rep_stranger_user");
  const { task } = (await owner.client.post("/api/hometasks/tasks", { title: "Mine", dueDate: TODAY, repeat: "daily" })).body;

  assert.equal((await stranger.client.post(`/api/hometasks/tasks/${task.id}/complete?today=${TODAY}`)).status, 404);
  assert.equal((await owner.client.get("/api/hometasks/tasks?status=all")).body.tasks.length, 1); // no stray copy
});
