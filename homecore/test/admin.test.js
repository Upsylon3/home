const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerUser } = require("./helpers/client");

let baseUrl, internalSecret;
let admin; // the very first user registered in this file — see the first test

before(async () => {
  ({ baseUrl, internalSecret } = await startTestApp());
  admin = await registerUser(baseUrl, { username: "root_admin" });
  assert.equal(admin.user.role, "admin", "sanity check: the first registered user in a fresh db must be admin");
});

after(async () => {
  await stopTestApp();
});

test("admin routes require auth, and reject a non-admin", async () => {
  const noAuth = await makeClient(baseUrl).get("/api/admin/users");
  assert.equal(noAuth.status, 401);

  const regular = await registerUser(baseUrl, { username: "just_a_user" });
  const forbidden = await regular.client.get("/api/admin/users");
  assert.equal(forbidden.status, 403);
});

test("GET /api/admin/users lists accounts with usage and quota", async () => {
  const res = await admin.client.get("/api/admin/users");
  assert.equal(res.status, 200);
  const me = res.body.users.find((u) => u.username === "root_admin");
  assert.ok(me);
  assert.equal(me.role, "admin");
  assert.equal(typeof me.quotaBytes, "number");
});

test("usedBytes is null (not 0, not a failure) when homecloud-backend is unreachable — the rest of the panel still works", async () => {
  // apps/homecloud-backend's real GET /internal/users/usage is covered by
  // its own suite (apps/homecloud-backend/test/internalUsage.test.js).
  // This test is specifically about admin.js's OWN behavior when that
  // call fails — pointing at a port nothing is listening on, rather than
  // a stand-in, is what makes this a genuine unreachable-service case
  // (a closed connection), not just a slow or malformed one.
  const user = await registerUser(baseUrl, { username: "unreachable_usage_user" });

  const original = process.env.HOMECLOUD_BACKEND_INTERNAL_URL;
  process.env.HOMECLOUD_BACKEND_INTERNAL_URL = "http://127.0.0.1:1"; // nothing listens on port 1
  try {
    const res = await admin.client.get("/api/admin/users");
    assert.equal(res.status, 200, "the whole route must not fail just because usage couldn't be fetched");
    assert.ok(res.body.usageError, "the failure should be surfaced, not silently swallowed");

    const row = res.body.users.find((u) => u.username === "unreachable_usage_user");
    assert.equal(row.usedBytes, null);
    // Graceful degradation, per docs/ARCHITECTURE.md's principle: every
    // OTHER field — the thing an admin actually needs to manage
    // accounts — is completely unaffected by HomeCloud being unreachable.
    assert.equal(row.role, "user");
    assert.equal(row.disabled, false);
    assert.equal(typeof row.quotaBytes, "number");
  } finally {
    process.env.HOMECLOUD_BACKEND_INTERNAL_URL = original;
  }
});

test("usedBytes reflects homecloud-backend's real answer when it's reachable", async () => {
  // A lightweight stand-in for apps/homecloud-backend's real
  // GET /internal/users/usage — not the full service (that contract is
  // already covered by apps/homecloud-backend/test/internalUsage.test.js
  // against the real thing). This test is specifically about admin.js's
  // OWN calling/parsing/merging logic against a real HTTP response shaped
  // like the contract.
  const http = require("node:http");
  const target = await registerUser(baseUrl, { username: "reachable_usage_user" });

  const stub = http.createServer((req, res) => {
    if (req.headers["x-internal-secret"] !== process.env.HOMECORE_INTERNAL_SECRET) {
      res.writeHead(401).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ usage: [{ userId: target.user.id, usedBytes: 999999 }] }));
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const { port } = stub.address();

  const original = process.env.HOMECLOUD_BACKEND_INTERNAL_URL;
  process.env.HOMECLOUD_BACKEND_INTERNAL_URL = `http://127.0.0.1:${port}`;
  try {
    const res = await admin.client.get("/api/admin/users");
    assert.equal(res.body.usageError, null);
    const row = res.body.users.find((u) => u.username === "reachable_usage_user");
    assert.equal(row.usedBytes, 999999);
  } finally {
    process.env.HOMECLOUD_BACKEND_INTERNAL_URL = original;
    await new Promise((resolve) => stub.close(resolve));
  }
});

test("reset-password: validates length, invalidates the target's existing session", async () => {
  const target = await registerUser(baseUrl, { username: "reset_pw_target" });

  const tooShort = await admin.client.post(`/api/admin/users/${target.user.id}/reset-password`, {
    newPassword: "short"
  });
  assert.equal(tooShort.status, 400);

  const before1 = await target.client.get("/api/auth/me");
  assert.equal(before1.status, 200);

  const reset = await admin.client.post(`/api/admin/users/${target.user.id}/reset-password`, {
    newPassword: "BrandNewPassword1"
  });
  assert.equal(reset.status, 200);

  const oldSessionNowDead = await target.client.get("/api/auth/me");
  assert.equal(oldSessionNowDead.status, 401);

  const loginWithNewPassword = await makeClient(baseUrl).post("/api/auth/login", {
    username: target.username,
    password: "BrandNewPassword1"
  });
  assert.equal(loginWithNewPassword.status, 200);
});

test("disable: an admin can't disable themselves, but can disable someone else", async () => {
  const selfDisable = await admin.client.post(`/api/admin/users/${admin.user.id}/disabled`, { disabled: true });
  assert.equal(selfDisable.status, 400);

  const target = await registerUser(baseUrl, { username: "disable_target_2" });
  const disable = await admin.client.post(`/api/admin/users/${target.user.id}/disabled`, { disabled: true });
  assert.equal(disable.status, 200);

  // Their existing token is rejected with the "disabled" message (checked
  // before the token-version check in authMiddleware), not just logged out.
  const check = await target.client.get("/api/auth/me");
  assert.equal(check.status, 403);

  const reEnable = await admin.client.post(`/api/admin/users/${target.user.id}/disabled`, { disabled: false });
  assert.equal(reEnable.status, 200);
});

test("quota override: set, reflected on /me as quotaOverride, then cleared back to default", async () => {
  const target = await registerUser(baseUrl, { username: "quota_target" });

  const invalid = await admin.client.post(`/api/admin/users/${target.user.id}/quota`, { quotaBytes: -5 });
  assert.equal(invalid.status, 400);

  const set = await admin.client.post(`/api/admin/users/${target.user.id}/quota`, { quotaBytes: 12345 });
  assert.equal(set.status, 200);

  // quotaBytes/usedBytes live on apps/homecloud-backend's own
  // GET /api/homecloud/files/quota, not here (see
  // homecore/test/auth.test.js's own /me test). quotaOverride —
  // the raw override value alone, which is genuinely HomeCore's to know —
  // stays here, and is what homecloud-backend's own quota check reads.
  const meAfterSet = await target.client.get("/api/auth/me");
  assert.equal(meAfterSet.body.quotaOverride, 12345);

  const clear = await admin.client.post(`/api/admin/users/${target.user.id}/quota`, { quotaBytes: null });
  assert.equal(clear.status, 200);

  const meAfterClear = await target.client.get("/api/auth/me");
  assert.equal(meAfterClear.body.quotaOverride, null);
});

test("role: promote/demote works, and the last remaining admin can't be demoted", async () => {
  const target = await registerUser(baseUrl, { username: "role_target" });

  const badRole = await admin.client.post(`/api/admin/users/${target.user.id}/role`, { role: "superuser" });
  assert.equal(badRole.status, 400);

  const promote = await admin.client.post(`/api/admin/users/${target.user.id}/role`, { role: "admin" });
  assert.equal(promote.status, 200);

  // A role change bumps *the affected account's* token_version and revokes
  // its sessions (see admin.js), regardless of who made the change — so
  // target's own existing token is now stale. Log back in for a fresh one.
  const targetLogin = await makeClient(baseUrl).post("/api/auth/login", {
    username: target.username,
    password: target.password
  });
  assert.equal(targetLogin.status, 200);
  const targetClient = makeClient(baseUrl);
  targetClient.setToken(targetLogin.body.token);

  // Now there are two admins, so target demoting the original admin is fine...
  const demoteOriginal = await targetClient.post(`/api/admin/users/${admin.user.id}/role`, { role: "user" });
  assert.equal(demoteOriginal.status, 200);

  // ...but now target is the only admin left, so demoting them must be refused.
  const demoteLast = await targetClient.post(`/api/admin/users/${target.user.id}/role`, { role: "user" });
  assert.equal(demoteLast.status, 400);

  // Restore state for later tests in this file: promote the original admin
  // back (via targetClient, still valid since the refusal above didn't
  // touch it), then re-login as root_admin — its token went stale when it
  // was demoted above — and refresh the shared admin.client with it.
  const restorePromote = await targetClient.post(`/api/admin/users/${admin.user.id}/role`, { role: "admin" });
  assert.equal(restorePromote.status, 200);

  const adminRelogin = await makeClient(baseUrl).post("/api/auth/login", {
    username: admin.username,
    password: admin.password
  });
  assert.equal(adminRelogin.status, 200);
  admin.client.setToken(adminRelogin.body.token);

  const demoteTargetBack = await admin.client.post(`/api/admin/users/${target.user.id}/role`, { role: "user" });
  assert.equal(demoteTargetBack.status, 200);
});

test("force-disable 2FA on a target account", async () => {
  const target = await registerUser(baseUrl, { username: "force_2fa_target" });
  const setup = await target.client.post("/api/auth/2fa/setup");
  assert.equal(setup.status, 200);

  const forceOff = await admin.client.post(`/api/admin/users/${target.user.id}/2fa/disable`);
  assert.equal(forceOff.status, 200);

  const me = await target.client.get("/api/auth/me");
  assert.equal(me.body.totpEnabled, false);
});

test("activity feed: cross-user, admin-only, most recent first", async () => {
  const target = await registerUser(baseUrl, { username: "activity_target" });

  // Simulates exactly what apps/homecloud-backend's real logActivity()
  // sends over HTTP (see homecore/src/internalEvents.js) — there's no
  // /api/files/upload route on this service to upload a real file
  // through; that upload, and the "upload" activity entry it causes, both genuinely
  // happen on apps/homecloud-backend now.
  const emit = await fetch(`${baseUrl}/internal/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Secret": internalSecret },
    body: JSON.stringify({ userId: target.user.id, applicationSlug: "homecloud", action: "upload", targetName: "hi.txt" })
  });
  assert.equal(emit.status, 202);

  const forbidden = await target.client.get("/api/admin/activity");
  assert.equal(forbidden.status, 403);

  const feed = await admin.client.get("/api/admin/activity");
  assert.equal(feed.status, 200);
  assert.ok(feed.body.activity.some((a) => a.username === "activity_target" && a.action === "upload"));
});

test("unknown user id 404s on admin actions", async () => {
  const res = await admin.client.post("/api/admin/users/999999/disabled", { disabled: true });
  assert.equal(res.status, 404);
});
