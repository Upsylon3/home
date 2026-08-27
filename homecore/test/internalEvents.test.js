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

test("POST /internal/events rejects a missing or wrong secret", async () => {
  const { user } = await registerUser(baseUrl, { username: "internal_events_secret_user" });
  const body = { userId: user.id, applicationSlug: "homecloud", action: "upload", targetName: "photo.jpg" };

  const noHeader = await makeClient(baseUrl).post("/internal/events", body);
  assert.equal(noHeader.status, 401);

  const wrongHeader = await makeClient(baseUrl).post("/internal/events", body, {
    headers: { "X-Internal-Secret": "definitely_wrong" }
  });
  assert.equal(wrongHeader.status, 401);
});

test("POST /internal/events validates its body", async () => {
  const { user } = await registerUser(baseUrl, { username: "internal_events_validation_user" });
  const client = makeClient(baseUrl);
  const headers = { "X-Internal-Secret": internalSecret };

  const noUserId = await client.post("/internal/events", { applicationSlug: "homecloud", action: "upload" }, { headers });
  assert.equal(noUserId.status, 400);

  const noAppSlug = await client.post("/internal/events", { userId: user.id, action: "upload" }, { headers });
  assert.equal(noAppSlug.status, 400);

  const noAction = await client.post("/internal/events", { userId: user.id, applicationSlug: "homecloud" }, { headers });
  assert.equal(noAction.status, 400);

  const unknownApp = await client.post(
    "/internal/events",
    { userId: user.id, applicationSlug: "not_a_real_app", action: "upload" },
    { headers }
  );
  assert.equal(unknownApp.status, 400);
});

test("POST /internal/events, with a valid secret, emits a real hc_activity_events row via the same path apps/homecloud-backend uses", async () => {
  const { client, user } = await registerUser(baseUrl, { username: "internal_events_valid_user" });

  const emit = await makeClient(baseUrl).post(
    "/internal/events",
    { userId: user.id, applicationSlug: "homecloud", action: "upload", targetName: "vacation.jpg" },
    { headers: { "X-Internal-Secret": internalSecret } }
  );
  assert.equal(emit.status, 202);

  const mine = await client.get("/api/core/activity/me");
  assert.equal(mine.status, 200);
  assert.ok(
    mine.body.events.some((e) => e.eventType === "homecloud.file.uploaded" && e.targetId === "vacation.jpg"),
    "expected the emitted event to show up in the acting user's own HomeCore activity feed"
  );
});
