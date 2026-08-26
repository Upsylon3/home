// Phase 1 of MIGRATION_PLAN.md's test suite: deliberately small, since
// there's deliberately not much here yet. What it proves:
//   1. The service boots and its health endpoint responds.
//   2. Auth delegation to HomeCore actually works end to end — not just
//      "requireAuth is imported," but a real request without a token is
//      rejected, and a real token issued by HomeCore is accepted.
// Phase 2 replaces the temporary /whoami route this exercises with real
// files/folders/shares routes and their own, much larger test files.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerHomecloudBackendUser } = require("./helpers/client");

let baseUrl, homecore;

before(async () => {
  const started = await startTestApp();
  baseUrl = started.baseUrl;
  homecore = started.homecore;
});

after(async () => {
  await stopTestApp();
});

test("health endpoint responds without auth", async () => {
  const client = makeClient(baseUrl);
  const res = await client.get("/api/homecloud/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ok");
});

test("whoami rejects a request with no token", async () => {
  const client = makeClient(baseUrl);
  const res = await client.get("/api/homecloud/whoami");
  assert.equal(res.status, 401);
});

test("whoami rejects a garbage token", async () => {
  const client = makeClient(baseUrl);
  client.setToken("not-a-real-token");
  const res = await client.get("/api/homecloud/whoami");
  assert.equal(res.status, 401);
});

test("whoami accepts a real token issued by HomeCore, and returns that user", async () => {
  const { client, username } = await registerHomecloudBackendUser(homecore, baseUrl);
  const res = await client.get("/api/homecloud/whoami");
  assert.equal(res.status, 200);
  assert.equal(res.body.user.username, username);
});

test("an unknown /api route 404s cleanly", async () => {
  const client = makeClient(baseUrl);
  const res = await client.get("/api/does-not-exist");
  assert.equal(res.status, 404);
});
