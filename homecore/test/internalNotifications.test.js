// Tests for the two machine-to-machine endpoints added for HomeMonitor:
// POST /internal/notifications and GET /internal/apps.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerUser } = require("./helpers/client");

let baseUrl, internalSecret;

before(async () => {
  ({ baseUrl, internalSecret } = await startTestApp());
});

after(async () => {
  await stopTestApp();
});

const asService = () => ({ headers: { "X-Internal-Secret": internalSecret } });

test("both endpoints reject a missing or wrong secret", async () => {
  const client = makeClient(baseUrl);
  assert.equal((await client.get("/internal/apps")).status, 401);
  assert.equal((await client.get("/internal/apps", { headers: { "X-Internal-Secret": "wrong" } })).status, 401);
  const body = { applicationSlug: "homecloud", type: "alert", title: "Hi", audience: "admins" };
  assert.equal((await client.post("/internal/notifications", body)).status, 401);
  assert.equal((await client.post("/internal/notifications", body, { headers: { "X-Internal-Secret": "x" } })).status, 401);
});

test("GET /internal/apps lists the registry with health URLs", async () => {
  const res = await makeClient(baseUrl).get("/internal/apps", asService());
  assert.equal(res.status, 200);
  const homecloud = res.body.apps.find((a) => a.slug === "homecloud");
  assert.equal(homecloud.healthUrl, "/api/homecloud/health");
  assert.equal(homecloud.enabled, true);
  assert.deepEqual(Object.keys(homecloud).sort(), ["enabled", "healthUrl", "name", "slug"]); // nothing extra leaks
});

test("POST /internal/notifications validates its body", async () => {
  const client = makeClient(baseUrl);
  const good = { applicationSlug: "homecloud", type: "alert", title: "Disk is 85% full", audience: "admins" };
  const cases = [
    { ...good, applicationSlug: "nope" },
    { ...good, applicationSlug: undefined },
    { ...good, type: "" },
    { ...good, type: "x".repeat(41) },
    { ...good, title: "  " },
    { ...good, title: "x".repeat(121) },
    { ...good, body: 5 },
    { ...good, body: "x".repeat(1001) },
    { ...good, data: [1, 2] },
    { ...good, audience: "everyone" },
    { ...good, audience: undefined }
  ];
  for (const body of cases) {
    const res = await client.post("/internal/notifications", body, asService());
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
  }
});

test("a notification reaches every enabled admin, and nobody else", async () => {
  const admin = await registerUser(baseUrl, { username: "notif_first_admin" });
  const regular = await registerUser(baseUrl, { username: "notif_regular_user" });

  const res = await makeClient(baseUrl).post(
    "/internal/notifications",
    { applicationSlug: "homecloud", type: "alert", title: "Disk is 85% full", body: "data: 85%", data: { disk: "data" }, audience: "admins" },
    asService()
  );
  assert.equal(res.status, 201);
  assert.ok(res.body.delivered >= 1);

  const regularClient = makeClient(baseUrl);
  regularClient.setToken(regular.token);
  const regularList = await regularClient.get("/api/core/notifications");
  assert.equal(regularList.body.notifications.filter((n) => n.title === "Disk is 85% full").length, 0);

  // Each test file gets a fresh database, and the first account registered in
  // it becomes the admin, so this account must be the admin.
  const me = makeClient(baseUrl);
  me.setToken(admin.token);
  assert.equal((await me.get("/api/auth/me")).body.role, "admin");

  const list = (await me.get("/api/core/notifications")).body.notifications;
  const mine = list.find((n) => n.title === "Disk is 85% full");
  assert.equal(mine.applicationSlug, "homecloud");
  assert.equal(mine.type, "alert");
  assert.equal(mine.body, "data: 85%");
  assert.deepEqual(mine.data, { disk: "data" });
  assert.equal(mine.readAt, null);
});
