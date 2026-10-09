// Integration tests for the project routes: real HomeCore, real HomeTasks,
// real HTTP requests. Each test registers its own user so tests can't
// interfere with each other.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerHomeTasksUser } = require("./helpers/client");

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

test("health needs no login, everything else does", async () => {
  const anon = makeClient(baseUrl);
  assert.equal((await anon.get("/api/hometasks/health")).status, 200);
  assert.equal((await anon.get("/api/hometasks/projects")).status, 401);
  assert.equal((await anon.get("/api/hometasks/tasks")).status, 401);
});

test("create, list and rename a project", async () => {
  const { client } = await register("proj_basic_user");

  const created = await client.post("/api/hometasks/projects", { name: "  House move  " });
  assert.equal(created.status, 201);
  assert.equal(created.body.project.name, "House move"); // trimmed

  const list = await client.get("/api/hometasks/projects");
  assert.equal(list.body.projects.length, 1);
  assert.equal(list.body.projects[0].openCount, 0);

  const renamed = await client.patch(`/api/hometasks/projects/${created.body.project.id}`, { name: "Moving house" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.project.name, "Moving house");
});

test("project names are validated and unique per person, ignoring case", async () => {
  const { client } = await register("proj_names_user");
  assert.equal((await client.post("/api/hometasks/projects", {})).status, 400);
  assert.equal((await client.post("/api/hometasks/projects", { name: "   " })).status, 400);
  assert.equal((await client.post("/api/hometasks/projects", { name: "x".repeat(61) })).status, 400);

  assert.equal((await client.post("/api/hometasks/projects", { name: "Garden" })).status, 201);
  assert.equal((await client.post("/api/hometasks/projects", { name: "garden" })).status, 409);

  // Renaming a project to its own name is not a collision with itself.
  const other = await client.post("/api/hometasks/projects", { name: "Kitchen" });
  const same = await client.patch(`/api/hometasks/projects/${other.body.project.id}`, { name: "Kitchen" });
  assert.equal(same.status, 200);
});

test("two different people can use the same project name", async () => {
  const a = await register("proj_same_name_a");
  const b = await register("proj_same_name_b");
  assert.equal((await a.client.post("/api/hometasks/projects", { name: "Shared name" })).status, 201);
  assert.equal((await b.client.post("/api/hometasks/projects", { name: "Shared name" })).status, 201);
});

test("people can't see, rename or delete each other's projects", async () => {
  const owner = await register("proj_owner_user");
  const stranger = await register("proj_stranger_user");
  const { body } = await owner.client.post("/api/hometasks/projects", { name: "Private" });
  const id = body.project.id;

  assert.equal((await stranger.client.get("/api/hometasks/projects")).body.projects.length, 0);
  assert.equal((await stranger.client.patch(`/api/hometasks/projects/${id}`, { name: "Hacked" })).status, 404);
  assert.equal((await stranger.client.delete(`/api/hometasks/projects/${id}`)).status, 404);

  // Still intact for the owner.
  assert.equal((await owner.client.get("/api/hometasks/projects")).body.projects[0].name, "Private");
});

test("deleting a project keeps its tasks, which become project-less", async () => {
  const { client } = await register("proj_delete_user");
  const project = (await client.post("/api/hometasks/projects", { name: "Temp" })).body.project;
  const task = (await client.post("/api/hometasks/tasks", { title: "Survivor", projectId: project.id })).body.task;
  assert.equal(task.projectId, project.id);

  assert.equal((await client.delete(`/api/hometasks/projects/${project.id}`)).status, 200);

  const after = await client.get(`/api/hometasks/tasks/${task.id}`);
  assert.equal(after.status, 200);
  assert.equal(after.body.task.projectId, null);
});

test("a project's openCount counts only unfinished tasks", async () => {
  const { client } = await register("proj_count_user");
  const project = (await client.post("/api/hometasks/projects", { name: "Counting" })).body.project;
  const first = (await client.post("/api/hometasks/tasks", { title: "One", projectId: project.id })).body.task;
  await client.post("/api/hometasks/tasks", { title: "Two", projectId: project.id });
  await client.post(`/api/hometasks/tasks/${first.id}/complete`);

  const list = await client.get("/api/hometasks/projects");
  assert.equal(list.body.projects[0].openCount, 1);
});

test("a bad project id is a clean 404, not a crash", async () => {
  const { client } = await register("proj_badid_user");
  assert.equal((await client.patch("/api/hometasks/projects/abc", { name: "X" })).status, 404);
  assert.equal((await client.delete("/api/hometasks/projects/999999")).status, 404);
});
