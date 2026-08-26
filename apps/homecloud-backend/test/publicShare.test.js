// Adapted from homecore/test/publicShare.test.js per MIGRATION_PLAN.md's
// Phase 2 — same assertions, same coverage. `db` here is this service's
// own database (started.db from the test harness), which now owns the
// `shares` table being backdated directly below — same technique as the
// original, just pointed at the new location that table actually lives.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerHomecloudBackendUser } = require("./helpers/client");

let baseUrl, homecore, db;

before(async () => {
  ({ baseUrl, homecore, db } = await startTestApp());
});

after(async () => {
  await stopTestApp();
});

async function registerUser(overrides) {
  return registerHomecloudBackendUser(homecore, baseUrl, overrides);
}

async function uploadAndShare(client, content = "public content") {
  const form = new FormData();
  form.append("file", new Blob([content], { type: "text/plain" }), "public.txt");
  const up = await client.post("/api/homecloud/files/upload", form, { raw: true });
  const share = await client.post(`/api/homecloud/files/${up.body.file.id}/share`);
  return { fileId: up.body.file.id, token: share.body.share.token, shareId: share.body.share.id };
}

test("a garbage/unknown token 404s", async () => {
  const res = await makeClient(baseUrl).get("/api/share/not-a-real-token");
  assert.equal(res.status, 404);
});

test("a valid token downloads the exact original bytes", async () => {
  const { client } = await registerUser();
  const content = "exact bytes check";
  const { token } = await uploadAndShare(client, content);

  const res = await makeClient(baseUrl).get(`/api/share/${token}`);
  assert.equal(res.status, 200);
  assert.equal(Buffer.from(res.body).toString("utf8"), content);
});

test("a revoked token 404s", async () => {
  const { client } = await registerUser();
  const { token, shareId } = await uploadAndShare(client);

  await client.delete(`/api/homecloud/files/shares/${shareId}`);

  const res = await makeClient(baseUrl).get(`/api/share/${token}`);
  assert.equal(res.status, 404);
});

test("an expired token 404s (backdated directly in the database to genuinely test the expiry check)", async () => {
  const { client } = await registerUser();
  const { token } = await uploadAndShare(client);

  // Set expires_at into the past — exercising the exact same
  // "expires_at <= datetime('now')" check publicShare.js runs, without
  // needing the test to actually wait for real time to pass.
  db.prepare("UPDATE shares SET expires_at = datetime('now', '-1 day') WHERE token = ?").run(token);

  const res = await makeClient(baseUrl).get(`/api/share/${token}`);
  assert.equal(res.status, 404);
});

test("a token with a future expiry still works", async () => {
  const { client } = await registerUser();
  const content = "not expired yet";
  const { token } = await uploadAndShare(client, content);

  db.prepare("UPDATE shares SET expires_at = datetime('now', '+1 day') WHERE token = ?").run(token);

  const res = await makeClient(baseUrl).get(`/api/share/${token}`);
  assert.equal(res.status, 200);
  assert.equal(Buffer.from(res.body).toString("utf8"), content);
});
