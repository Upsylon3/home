// Auth delegation is already covered end-to-end by files.test.js,
// folders.test.js, and publicShare.test.js (real routes, real data).
// What's left here: the two things that were never about auth in the
// first place.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient } = require("./helpers/client");

let baseUrl;

before(async () => {
  ({ baseUrl } = await startTestApp());
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

test("an unknown /api route 404s cleanly", async () => {
  const client = makeClient(baseUrl);
  const res = await client.get("/api/does-not-exist");
  assert.equal(res.status, 404);
});
