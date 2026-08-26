// The temporary /whoami route this file used to exercise (Phase 1) is
// gone — replaced by real files/folders/shares routes in Phase 2 (see
// files.test.js/folders.test.js/publicShare.test.js), which now cover
// the same "auth delegation actually works end-to-end" ground more
// thoroughly (real routes, real data, not a diagnostic stand-in). What's
// left here: the two things that were never about auth in the first
// place.
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
