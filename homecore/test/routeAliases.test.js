const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { TOTP, Secret } = require("otpauth");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerUser } = require("./helpers/client");
let ctx, admin;
before(async () => { ctx = await startTestApp(); admin = await registerUser(ctx.baseUrl); });
after(stopTestApp);
const canonical = "/api/core/auth", legacy = "/api/auth";
function client(token) { const api = makeClient(ctx.baseUrl); if (token) api.setToken(token); return api; }

test("canonical registration and legacy login share accounts, sessions and token authority without redirects", async () => {
  const username = "canonical_route_user", password = "DisposableAliasPassword123!";
  const registered = await client().post(`${canonical}/register`, { username, password });
  assert.equal(registered.status, 201); assert.equal(registered.headers.get("location"), null);
  assert.equal(registered.body.user.role, "user");
  const login = await client().post(`${legacy}/login`, { username, password });
  assert.equal(login.status, 200); assert.equal(login.body.user.id, registered.body.user.id);
  for (const token of [registered.body.token, login.body.token]) {
    const api = client(token);
    const a = await api.get(`${canonical}/me`), b = await api.get(`${legacy}/me`);
    assert.equal(a.status, 200); assert.deepEqual(a.body, b.body);
  }
  assert.equal((await client().post(`${legacy}/register`, { username, password })).status, 409);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n, 1);
});
test("both auth prefixes preserve credential refusal, validation errors and pending-2FA boundaries", async () => {
  const pending = jwt.sign({ sub: admin.user.id, pending2fa: true }, process.env.JWT_SECRET, { expiresIn: "5m" });
  for (const prefix of [canonical, legacy]) {
    assert.equal((await client().get(`${prefix}/me`)).status, 401);
    assert.equal((await client(pending).get(`${prefix}/me`)).status, 401);
    assert.equal((await client().post(`${prefix}/login`, {})).status, 400);
    const rejected = await client().post(`${prefix}/login`, { username: "does_not_exist", password: "wrong" });
    assert.equal(rejected.status, 401); assert.equal(typeof rejected.body.error, "string");
  }
});
test("2FA can start through one prefix and complete through the other with the same challenge", async () => {
  const owner = await registerUser(ctx.baseUrl);
  const api = client(owner.token);
  const setup = await api.post(`${canonical}/2fa/setup`, {});
  assert.equal(setup.status, 200);
  const totp = new TOTP({ issuer: "homecloud", label: owner.username, algorithm: "SHA1", digits: 6, period: 30,
    secret: Secret.fromBase32(setup.body.secret) });
  assert.equal((await api.post(`${legacy}/2fa/confirm`, { code: totp.generate() })).status, 200);
  const login = await client().post(`${canonical}/login`, { username: owner.username, password: owner.password });
  assert.equal(login.status, 200); assert.equal(login.body.requires2fa, true);
  const completed = await client().post(`${legacy}/2fa/verify`, { pendingToken: login.body.pendingToken, code: totp.generate() });
  assert.equal(completed.status, 200);
  assert.equal((await client(completed.body.token).get(`${canonical}/me`)).body.id, owner.user.id);
});
test("canonical password change and compatibility sign-out invalidate sessions across both prefixes", async () => {
  const owner = await registerUser(ctx.baseUrl);
  const changed = await owner.client.post(`${canonical}/change-password`, { currentPassword: owner.password, newPassword: "ChangedDisposable123!" });
  assert.equal(changed.status, 200);
  for (const prefix of [canonical, legacy]) assert.equal((await owner.client.get(`${prefix}/me`)).status, 401);
  const api = client(changed.body.token);
  assert.equal((await api.get(`${legacy}/me`)).status, 200);
  assert.equal((await api.post(`${legacy}/logout-everywhere`, {})).status, 200);
  assert.equal((await api.get(`${canonical}/me`)).status, 401);
});
test("admin aliases enforce current role and account invalidation while preserving mutations", async () => {
  const owner = await registerUser(ctx.baseUrl);
  for (const prefix of ["/api/admin", "/api/core/admin"]) {
    assert.equal((await client().get(`${prefix}/activity`)).status, 401);
    assert.equal((await owner.client.get(`${prefix}/activity`)).status, 403);
  }
  assert.equal((await admin.client.post(`/api/core/admin/users/${owner.user.id}/quota`, { quotaBytes: 123456 })).status, 200);
  assert.equal((await owner.client.get(`${legacy}/me`)).body.quotaOverride, 123456);
  assert.equal((await admin.client.post(`/api/core/admin/users/${owner.user.id}/role`, { role: "admin" })).status, 200);
  assert.equal((await owner.client.get(`${canonical}/me`)).status, 401);
  const promoted = await client().post(`${legacy}/login`, { username: owner.username, password: owner.password });
  const elevated = client(promoted.body.token);
  assert.equal((await elevated.get("/api/core/admin/activity")).status, 200);
  assert.equal((await admin.client.post(`/api/admin/users/${owner.user.id}/role`, { role: "user" })).status, 200);
  assert.equal((await elevated.get(`${canonical}/me`)).status, 401);
  const signedIn = await client().post(`${canonical}/login`, { username: owner.username, password: owner.password });
  const ordinary = client(signedIn.body.token);
  assert.equal((await ordinary.get("/api/core/admin/activity")).status, 403);
  assert.equal((await admin.client.post(`/api/core/admin/users/${owner.user.id}/disabled`, { disabled: true })).status, 200);
  for (const prefix of [canonical, legacy]) assert.equal((await ordinary.get(`${prefix}/me`)).status, 403);
});
test("explicit HomeCloud activity view preserves own scope and does not replace cross-app or admin feeds", async () => {
  const a = await registerUser(ctx.baseUrl), b = await registerUser(ctx.baseUrl);
  const appId = slug => ctx.db.prepare("SELECT id FROM hc_applications WHERE slug = ?").get(slug).id;
  const insert = ctx.db.prepare("INSERT INTO hc_activity_events (actor_user_id, application_id, event_type, target_type, target_id) VALUES (?, ?, ?, 'file', ?)");
  insert.run(a.user.id, appId("homecloud"), "homecloud.file.uploaded", "own-cloud-fixture");
  insert.run(b.user.id, appId("homecloud"), "homecloud.file.uploaded", "other-cloud-fixture");
  insert.run(a.user.id, appId("homenotes"), "homenotes.note.created", "own-note-fixture");
  const old = await a.client.get("/api/activity"), explicit = await a.client.get("/api/core/activity/homecloud");
  assert.equal(explicit.status, 200); assert.deepEqual(explicit.body, old.body);
  assert.ok(explicit.body.activity.some(e => e.targetName === "own-cloud-fixture"));
  assert.ok(!JSON.stringify(explicit.body).includes("other-cloud-fixture"));
  assert.ok(!JSON.stringify(explicit.body).includes("own-note-fixture"));
  const personal = await a.client.get("/api/core/activity/me");
  assert.ok(personal.body.events.some(e => e.targetId === "own-note-fixture"));
  assert.equal((await a.client.get("/api/core/activity")).status, 403);
  assert.deepEqual((await admin.client.get("/api/core/admin/activity")).body, (await admin.client.get("/api/admin/activity")).body);
  assert.ok((await admin.client.get("/api/core/activity")).body.events.some(e => e.targetId === "own-note-fixture"));
});
test("new aliases reject capabilities and cannot expose private issuance through another prefix", async () => {
  const issued = await admin.client.post("/internal/delegations", { integrationId: "monitor-followup-v1", consent: true });
  const cap = client(issued.body.capabilities[0].token);
  for (const route of ["/api/core/auth/me", "/api/core/admin/activity", "/api/core/activity/homecloud"]) {
    assert.equal((await cap.get(route)).status, 401);
  }
  const before = ctx.db.prepare("SELECT COUNT(*) AS n FROM hc_delegation_grants").get().n;
  for (const route of ["/api/core/auth/delegations", "/api/core/admin/delegations", "/api/core/internal/delegations"]) {
    assert.equal((await admin.client.post(route, { integrationId: "monitor-followup-v1", consent: true })).status, 404);
  }
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM hc_delegation_grants").get().n, before);
});
