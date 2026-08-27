const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerUser } = require("./helpers/client");

let baseUrl;

before(async () => {
  ({ baseUrl } = await startTestApp());
});

after(async () => {
  await stopTestApp();
});

test("GET /api/activity requires auth", async () => {
  const res = await makeClient(baseUrl).get("/api/activity");
  assert.equal(res.status, 401);
});

test("GET /api/activity keeps its original {action, targetName, createdAt} shape, now sourced from hc_activity_events", async () => {
  const { client } = await registerUser(baseUrl, { username: "legacy_activity_user" });

  const folder = await client.post("/api/folders", { name: "Legacy Feed Test" });
  assert.equal(folder.status, 201);

  const res = await client.get("/api/activity");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.activity));

  const entry = res.body.activity.find((a) => a.targetName === "Legacy Feed Test");
  assert.ok(entry, "expected the folder-creation action to appear in the per-user activity feed");
  // "folder_create" is the original activity_log-era action string
  // (see ACTION_EVENT_MAP in homecore/src/homecore/events.js) — the
  // frontend's ACTION_LABELS/describeActivity() key off this exact string,
  // not the namespaced "homecloud.folder.created" eventType.
  assert.equal(entry.action, "folder_create");
  assert.ok(typeof entry.createdAt === "string" && entry.createdAt.length > 0);
});

test("GET /api/activity only shows the signed-in user's own actions", async () => {
  const a = await registerUser(baseUrl, { username: "legacy_activity_user_a" });
  const b = await registerUser(baseUrl, { username: "legacy_activity_user_b" });

  await a.client.post("/api/folders", { name: "Only A Should See This" });

  const bFeed = await b.client.get("/api/activity");
  assert.equal(bFeed.status, 200);
  assert.ok(!bFeed.body.activity.some((entry) => entry.targetName === "Only A Should See This"));

  const aFeed = await a.client.get("/api/activity");
  assert.ok(aFeed.body.activity.some((entry) => entry.targetName === "Only A Should See This"));
});
