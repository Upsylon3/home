const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerUser } = require("./helpers/client");

let baseUrl, db, internalSecret;
let admin; // first user registered in this file's isolated database

before(async () => {
  ({ baseUrl, db, internalSecret } = await startTestApp());
  admin = await registerUser(baseUrl, { username: "core_admin" });
  assert.equal(admin.user.role, "admin");
});

after(async () => {
  await stopTestApp();
});

test("GET /api/core/health is public and healthy", async () => {
  const res = await makeClient(baseUrl).get("/api/core/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "healthy");
  assert.equal(res.body.checks.database, "healthy");
  assert.equal(res.body.checks.storage, "healthy");
});

test("GET /api/core/system requires auth and reports basic runtime info", async () => {
  const noAuth = await makeClient(baseUrl).get("/api/core/system");
  assert.equal(noAuth.status, 401);

  const res = await admin.client.get("/api/core/system");
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.uptimeSeconds, "number");
  assert.ok(res.body.nodeVersion.startsWith("v"));
});

test("HomeCloud is auto-registered as an application on first boot", async () => {
  const res = await admin.client.get("/api/core/apps");
  assert.equal(res.status, 200);
  const homecloud = res.body.applications.find((a) => a.slug === "homecloud");
  assert.ok(homecloud, "expected the homecloud app to be seeded automatically");
  assert.equal(homecloud.enabled, true);
});

test("HomeMedia is also auto-registered on first boot, even though it's a separate service", async () => {
  const res = await admin.client.get("/api/core/apps");
  assert.equal(res.status, 200);
  const homemedia = res.body.applications.find((a) => a.slug === "homemedia");
  assert.ok(homemedia, "expected the homemedia app to be seeded automatically");
  assert.equal(homemedia.enabled, true);
  assert.ok(homemedia.baseUrl);
});

test("HomeSync is also auto-registered, with its info-page base_url rather than a real launchable frontend", async () => {
  const res = await admin.client.get("/api/core/apps");
  assert.equal(res.status, 200);
  const homesync = res.body.applications.find((a) => a.slug === "homesync");
  assert.ok(homesync, "expected the homesync app to be seeded automatically");
  assert.equal(homesync.enabled, true);
  assert.ok(homesync.baseUrl);
});

test("HomeNotes is also auto-registered on first boot", async () => {
  const res = await admin.client.get("/api/core/apps");
  assert.equal(res.status, 200);
  const homenotes = res.body.applications.find((a) => a.slug === "homenotes");
  assert.ok(homenotes, "expected the homenotes app to be seeded automatically");
  assert.equal(homenotes.enabled, true);
  assert.ok(homenotes.baseUrl);
});

test("GET /api/core/users/me matches the registered account, and displayName can be updated", async () => {
  const { client, username } = await registerUser(baseUrl, { username: "core_profile_user" });

  const me = await client.get("/api/core/users/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.user.username, username);
  assert.equal(me.body.user.displayName, null);

  const badName = await client.patch("/api/core/users/me", { displayName: "" });
  assert.equal(badName.status, 400);

  const tooLong = await client.patch("/api/core/users/me", { displayName: "x".repeat(65) });
  assert.equal(tooLong.status, 400);

  const update = await client.patch("/api/core/users/me", { displayName: "Casey" });
  assert.equal(update.status, 200);
  assert.equal(update.body.user.displayName, "Casey");
});

test("GET /api/core/users/me/sessions reflects logins for that account", async () => {
  const { client, username, password } = await registerUser(baseUrl, { username: "core_sessions_user" });
  await makeClient(baseUrl).post("/api/auth/login", { username, password });

  const res = await client.get("/api/core/users/me/sessions");
  assert.equal(res.status, 200);
  // The original register call plus the extra login above.
  assert.ok(res.body.sessions.length >= 2);
  assert.ok(res.body.sessions.every((s) => typeof s.lastSeenAt === "string"));
});

test("GET /api/core/permissions returns the seeded catalog", async () => {
  const res = await admin.client.get("/api/core/permissions");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.permissions));
  assert.ok(res.body.permissions.length > 0);
  assert.ok(res.body.permissions.every((p) => typeof p.key === "string"));
});

test("apps: listing is open to any signed-in user, but writes require admin", async () => {
  const { client } = await registerUser(baseUrl, { username: "core_apps_regular" });

  const list = await client.get("/api/core/apps");
  assert.equal(list.status, 200);

  const forbidden = await client.post("/api/core/apps", { slug: "photos", name: "Photos" });
  assert.equal(forbidden.status, 403);
});

test("apps: admin can register, fetch by slug, update, and delete a non-core app", async () => {
  const badSlug = await admin.client.post("/api/core/apps", { slug: "Not_Valid", name: "Bad" });
  assert.equal(badSlug.status, 400);

  const create = await admin.client.post("/api/core/apps", {
    slug: "photos",
    name: "Photos",
    description: "Photo gallery app"
  });
  assert.equal(create.status, 201);
  assert.equal(create.body.application.slug, "photos");

  const dupe = await admin.client.post("/api/core/apps", { slug: "photos", name: "Photos Again" });
  assert.equal(dupe.status, 409);

  const bySlug = await admin.client.get("/api/core/apps/photos");
  assert.equal(bySlug.status, 200);
  assert.equal(bySlug.body.application.name, "Photos");

  const update = await admin.client.patch("/api/core/apps/photos", { enabled: false, version: "0.2.0" });
  assert.equal(update.status, 200);
  assert.equal(update.body.application.enabled, false);
  assert.equal(update.body.application.version, "0.2.0");

  const remove = await admin.client.delete("/api/core/apps/photos");
  assert.equal(remove.status, 200);

  const goneNow = await admin.client.get("/api/core/apps/photos");
  assert.equal(goneNow.status, 404);
});

test("apps: the homecloud application itself can never be removed", async () => {
  const res = await admin.client.delete("/api/core/apps/homecloud");
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "CANNOT_REMOVE_CORE_APP");

  const stillThere = await admin.client.get("/api/core/apps/homecloud");
  assert.equal(stillThere.status, 200);
});

test("activity bridge: a HomeCloud action shows up as a namespaced HomeCore event", async () => {
  const { client, user } = await registerUser(baseUrl, { username: "core_activity_user" });

  // Simulates exactly what apps/homecloud-backend's real logActivity()
  // sends over HTTP (see homecore/src/internalEvents.js) — the old
  // /api/folders route this test used to create a real folder through no
  // longer exists here at all as of MIGRATION_PLAN.md's Phase 5.
  const emit = await fetch(`${baseUrl}/internal/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Secret": internalSecret },
    body: JSON.stringify({ userId: user.id, applicationSlug: "homecloud", action: "folder_create", targetName: "Bridged" })
  });
  assert.equal(emit.status, 202);

  const mine = await client.get("/api/core/activity/me");
  assert.equal(mine.status, 200);
  assert.ok(mine.body.events.some((e) => e.eventType === "homecloud.folder.created" && e.targetId === "Bridged"));

  // Cross-user admin view sees it too; a non-admin is refused.
  const adminView = await admin.client.get("/api/core/activity");
  assert.equal(adminView.status, 200);
  assert.ok(adminView.body.events.some((e) => e.eventType === "homecloud.folder.created"));

  const forbidden = await client.get("/api/core/activity");
  assert.equal(forbidden.status, 403);
});

test("notifications: empty by default, 404 marking an unknown one read, and marking a real one read works", async () => {
  const { client, user } = await registerUser(baseUrl, { username: "core_notifications_user" });

  const empty = await client.get("/api/core/notifications");
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.notifications, []);

  const unknownRead = await client.patch("/api/core/notifications/999999/read");
  assert.equal(unknownRead.status, 404);

  // Nothing in v0 produces notifications yet (by design — see
  // homecore/notifications.js), so insert one directly to exercise the
  // read path itself.
  const info = db
    .prepare(
      `INSERT INTO hc_notifications (user_id, type, title, body) VALUES (?, 'test.notification', 'Hello', 'A test notification')`
    )
    .run(user.id);

  const list = await client.get("/api/core/notifications");
  assert.equal(list.body.notifications.length, 1);
  assert.equal(list.body.notifications[0].readAt, null);

  const markRead = await client.patch(`/api/core/notifications/${info.lastInsertRowid}/read`);
  assert.equal(markRead.status, 200);

  const listAfter = await client.get("/api/core/notifications");
  assert.ok(listAfter.body.notifications[0].readAt);
});
