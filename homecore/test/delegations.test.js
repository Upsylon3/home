const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");
const { ensureSchema, createDelegationStore, LIFETIME_MS } = require("../src/homecore/delegationStore");
const { createDelegationVerifier } = require("../../packages/homecore-client/src/delegation");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerUser } = require("./helpers/client");

let baseUrl, db;
before(async () => { ({ baseUrl, db } = await startTestApp()); });
after(stopTestApp);
async function administrator() {
  const owner = await registerUser(baseUrl);
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(owner.user.id);
  return owner;
}
async function issue(owner) {
  const res = await owner.client.post("/internal/delegations", { integrationId: "monitor-followup-v1", consent: true });
  assert.equal(res.status, 201);
  return res.body;
}
async function verify(capability, context = {}) {
  const client = makeClient(baseUrl); client.setToken(capability.token);
  return client.post("/api/core/delegations/verify", { audience: capability.audience, action: capability.action, ...context });
}

test("consented internal issuance creates two hash-only capabilities and safe owner metadata", async () => {
  const owner = await administrator();
  const issued = await issue(owner);
  assert.equal(issued.grant.subjectUserId, owner.user.id);
  assert.equal(issued.grant.status, "active");
  assert.equal(issued.capabilities.length, 2);
  assert.equal(Date.parse(issued.grant.expiresAt) - Date.parse(issued.grant.consentedAt), 30 * 86400000);
  for (const cap of issued.capabilities) {
    assert.match(cap.token, /^hc_dg_[A-Za-z0-9_-]{43}$/);
    const row = db.prepare("SELECT * FROM hc_delegation_credentials WHERE id = ?").get(cap.id);
    assert.equal(row.token_hash, crypto.createHash("sha256").update(cap.token).digest("hex"));
    assert.ok(!JSON.stringify(row).includes(cap.token));
    const checked = await verify(cap);
    assert.equal(checked.status, 200);
    assert.equal(checked.body.delegation.kind, "delegation");
    assert.equal(checked.body.delegation.subjectUserId, owner.user.id);
    assert.equal(checked.headers.get("cache-control"), "no-store");
  }
  const list = await owner.client.get("/api/core/delegations");
  assert.equal(list.body.grants.length, 1);
  for (const cap of issued.capabilities) {
    assert.ok(!JSON.stringify(list.body).includes(cap.token));
    assert.ok(!JSON.stringify(list.body).includes(db.prepare("SELECT token_hash FROM hc_delegation_credentials WHERE id = ?").get(cap.id).token_hash));
  }
  const audit = db.prepare("SELECT * FROM hc_activity_events WHERE target_id = ?").all(issued.grant.id);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].event_type, "homecore.delegation.created");
  assert.ok(issued.capabilities.every(cap => !JSON.stringify(audit).includes(cap.token)));
});

test("minting requires a full administrator session, fixed integration and explicit consent", async () => {
  const anon = makeClient(baseUrl);
  assert.equal((await anon.post("/internal/delegations", { integrationId: "monitor-followup-v1", consent: true })).status, 401);
  const plain = await registerUser(baseUrl);
  assert.equal((await plain.client.post("/internal/delegations", { integrationId: "monitor-followup-v1", consent: true })).status, 403);
  const owner = await administrator();
  for (const body of [{}, { integrationId: "monitor-followup-v1", consent: false },
    { integrationId: "other", consent: true }, { integrationId: "monitor-followup-v1", consent: true, userId: plain.user.id },
    { integrationId: "monitor-followup-v1", consent: true, scopes: ["*"] },
    { integrationId: "monitor-followup-v1", consent: true, expiresAt: "2099-01-01" }]) {
    assert.equal((await owner.client.post("/internal/delegations", body)).status, 400);
  }
  const pending = makeClient(baseUrl);
  pending.setToken(jwt.sign({ sub: owner.user.id, pending2fa: true }, process.env.JWT_SECRET, { expiresIn: "5m" }));
  assert.equal((await pending.post("/internal/delegations", { integrationId: "monitor-followup-v1", consent: true })).status, 401);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hc_delegation_grants WHERE user_id = ?").get(owner.user.id).n, 0);
});

test("browser-origin issuance and public mint/renew routes cannot return capabilities", async () => {
  const owner = await administrator();
  for (const headers of [{ Origin: "http://localhost" }, { "Sec-Fetch-Site": "same-origin" }, { "Sec-Fetch-Dest": "empty" }]) {
    const res = await owner.client.post("/internal/delegations", { integrationId: "monitor-followup-v1", consent: true }, { headers });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.ok(!JSON.stringify(res.body).includes("hc_dg_"));
  }
  assert.equal((await owner.client.post("/api/core/delegations", { integrationId: "monitor-followup-v1", consent: true })).status, 404);
  assert.equal((await owner.client.post("/api/core/delegations/example/renew", { consent: true })).status, 404);
});

test("audience/action isolation, unknown permissions and forged subject claims fail closed", async () => {
  const issued = await issue(await administrator());
  for (const cap of issued.capabilities) {
    assert.equal((await verify(cap, { audience: "homevault" })).status, 403);
    assert.equal((await verify(cap, { action: "*" })).status, 403);
    assert.equal((await verify(cap, { action: "tasks.delete" })).status, 403);
    assert.equal((await verify(cap, { subjectUserId: 999999 })).status, 400);
    const other = issued.capabilities.find(candidate => candidate.id !== cap.id);
    assert.equal((await verify(cap, { audience: other.audience, action: other.action })).status, 403);
    assert.equal((await verify({ ...cap, token: cap.token.slice(0, -1) + (cap.token.endsWith("A") ? "B" : "A") })).status, 403);
  }
});

test("capabilities and browser sessions remain separate principal types", async () => {
  const owner = await administrator();
  const { capabilities } = await issue(owner);
  for (const cap of capabilities) {
    const client = makeClient(baseUrl); client.setToken(cap.token);
    for (const route of ["/api/auth/me", "/api/core/users/me", "/api/core/delegations", "/api/admin/users"]) {
      assert.equal((await client.get(route)).status, 401, route);
    }
    assert.equal((await client.post("/internal/delegations", { integrationId: "monitor-followup-v1", consent: true })).status, 401);
  }
  assert.equal((await owner.client.post("/api/core/delegations/verify", { audience: "homemonitor", action: "monitor.alerts.read" })).status, 403);
});

test("metadata, revoke and renewal are owner-only, including after role loss", async () => {
  const alice = await administrator();
  const bob = await administrator();
  const issued = await issue(alice);
  assert.deepEqual((await bob.client.get("/api/core/delegations")).body.grants, []);
  assert.equal((await bob.client.delete(`/api/core/delegations/${issued.grant.id}`)).status, 404);
  assert.equal((await bob.client.post(`/internal/delegations/${issued.grant.id}/renew`, { consent: true })).status, 404);
  db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(alice.user.id);
  assert.equal((await alice.client.get("/api/core/delegations")).status, 200);
  assert.equal((await verify(issued.capabilities[0])).status, 403);
  assert.equal((await alice.client.delete(`/api/core/delegations/${issued.grant.id}`)).status, 204);
});

test("revocation is immediate, idempotent and invalidates both audiences", async () => {
  const owner = await administrator();
  const issued = await issue(owner);
  assert.equal((await verify(issued.capabilities[0])).status, 200);
  assert.equal((await owner.client.delete(`/api/core/delegations/${issued.grant.id}`)).status, 204);
  assert.equal((await owner.client.delete(`/api/core/delegations/${issued.grant.id}`)).status, 204);
  for (const cap of issued.capabilities) assert.equal((await verify(cap)).status, 403);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hc_activity_events WHERE target_id = ? AND event_type = 'homecore.delegation.revoked'").get(issued.grant.id).n, 1);
});

test("renewal rotates both capabilities atomically, requires consent and keeps the grant identity", async () => {
  const owner = await administrator();
  const issued = await issue(owner);
  assert.equal((await owner.client.post("/internal/delegations", { integrationId: "monitor-followup-v1", consent: true })).status, 409);
  assert.equal((await owner.client.post(`/internal/delegations/${issued.grant.id}/renew`, {})).status, 400);
  const renewed = await owner.client.post(`/internal/delegations/${issued.grant.id}/renew`, { consent: true });
  assert.equal(renewed.status, 200);
  assert.equal(renewed.body.grant.id, issued.grant.id);
  for (const cap of issued.capabilities) assert.equal((await verify(cap)).status, 403);
  for (const cap of renewed.body.capabilities) assert.equal((await verify(cap)).status, 200);
  const rows = db.prepare("SELECT COUNT(*) AS n FROM hc_delegation_credentials WHERE grant_id = ?").get(issued.grant.id);
  assert.equal(rows.n, 2);
});

test("expiry, disabled accounts, role loss and token-version changes reject live checks", async () => {
  for (const sql of ["UPDATE hc_delegation_grants SET expires_at = 0 WHERE user_id = ?",
    "UPDATE users SET disabled = 1 WHERE id = ?", "UPDATE users SET role = 'user' WHERE id = ?",
    "UPDATE users SET token_version = token_version + 1 WHERE id = ?"]) {
    const owner = await administrator();
    const issued = await issue(owner);
    assert.equal((await verify(issued.capabilities[0])).status, 200);
    db.prepare(sql).run(owner.user.id);
    for (const cap of issued.capabilities) assert.equal((await verify(cap)).status, 403, sql);
  }
});

test("sign out everywhere and password changes invalidate existing capabilities", async () => {
  for (const changePassword of [false, true]) {
    const owner = await administrator();
    const issued = await issue(owner);
    const res = changePassword
      ? await owner.client.post("/api/auth/change-password", { currentPassword: owner.password, newPassword: "NewDisposablePassword123!" })
      : await owner.client.post("/api/auth/logout-everywhere");
    assert.equal(res.status, 200);
    for (const cap of issued.capabilities) assert.equal((await verify(cap)).status, 403);
  }
});

test("registry disable pauses verification and prevents issuance", async () => {
  for (const source of ["homemonitor", "hometasks"]) {
    const owner = await administrator();
    const issued = await issue(owner);
    db.prepare("UPDATE hc_applications SET enabled = 0 WHERE slug = ?").run(source);
    try {
      assert.equal((await verify(issued.capabilities[0])).status, 403);
      const next = await administrator();
      assert.equal((await next.client.post("/internal/delegations", { integrationId: "monitor-followup-v1", consent: true })).status, 409);
    } finally { db.prepare("UPDATE hc_applications SET enabled = 1 WHERE slug = ?").run(source); }
    assert.equal((await verify(issued.capabilities[0])).status, 200);
  }
});

test("failed auditing rolls back grants and credentials without returning secrets", async () => {
  const owner = await administrator();
  const existingOwner = await administrator();
  const existing = await issue(existingOwner);
  db.exec("CREATE TEMP TRIGGER refuse_delegation_audit BEFORE INSERT ON hc_activity_events WHEN NEW.event_type LIKE 'homecore.delegation.%' BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END");
  try {
    const res = await owner.client.post("/internal/delegations", { integrationId: "monitor-followup-v1", consent: true });
    assert.equal(res.status, 500);
    assert.ok(!JSON.stringify(res.body).includes("hc_dg_"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hc_delegation_grants WHERE user_id = ?").get(owner.user.id).n, 0);
    const renewed = await existingOwner.client.post(`/internal/delegations/${existing.grant.id}/renew`, { consent: true });
    assert.equal(renewed.status, 500);
    for (const cap of existing.capabilities) assert.equal((await verify(cap)).status, 200);
  } finally { db.exec("DROP TRIGGER refuse_delegation_audit"); }
});

test("shared verifier uses real Core and sees renewal and revocation without cached authority", async () => {
  const owner = await administrator();
  const issued = await issue(owner);
  const check = createDelegationVerifier({ homecoreUrl: baseUrl });
  for (const cap of issued.capabilities) {
    assert.equal((await check(cap.token, cap)).subjectUserId, owner.user.id);
    assert.equal(await check(owner.token, cap), null);
  }
  const renewed = await owner.client.post(`/internal/delegations/${issued.grant.id}/renew`, { consent: true });
  for (const cap of issued.capabilities) assert.equal(await check(cap.token, cap), null);
  const cap = renewed.body.capabilities[0];
  assert.equal((await check(cap.token, cap)).grantId, issued.grant.id);
  await owner.client.delete(`/api/core/delegations/${issued.grant.id}`);
  assert.equal(await check(cap.token, cap), null);
});

test("additive schema and reopened database preserve grants; exact expiry and stale session epochs fail closed", async () => {
  const owner = await administrator();
  const issued = await issue(owner);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "home-delegation-reopen-"));
  const file = path.join(dir, "core.db");
  let copy;
  try {
    await db.backup(file);
    copy = new Database(file); copy.pragma("foreign_keys = ON");
    const usersBefore = copy.prepare("SELECT * FROM users").all();
    ensureSchema(copy); ensureSchema(copy);
    assert.deepEqual(copy.prepare("SELECT * FROM users").all(), usersBefore);
    const cap = issued.capabilities[0];
    assert.ok(createDelegationStore(copy).verify(cap.token, cap.audience, cap.action));
    const expires = Date.parse(issued.grant.expiresAt);
    assert.ok(createDelegationStore(copy, { now: () => expires - 1 }).verify(cap.token, cap.audience, cap.action));
    assert.equal(createDelegationStore(copy, { now: () => expires }).verify(cap.token, cap.audience, cap.action), null);
    assert.equal(expires - Date.parse(issued.grant.consentedAt), LIFETIME_MS);
    assert.throws(() => createDelegationStore(copy).issue(owner.user.id, -1, issued.grant.id), { status: 403 });
    copy.prepare("DELETE FROM hc_applications WHERE slug = 'homemonitor'").run();
    assert.equal(createDelegationStore(copy).verify(cap.token, cap.audience, cap.action), null);
  } finally { copy?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("offline restore maintenance invalidates resurrected capabilities and preserves account data", async () => {
  const owner = await administrator();
  const issued = await issue(owner);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "home-delegation-restore-"));
  const file = path.join(dir, "core.db");
  const script = path.resolve(__dirname, "../scripts/revoke-restored-delegations.js");
  const run = args => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 10000 });
  let copy;
  try {
    await db.backup(file);
    await owner.client.delete(`/api/core/delegations/${issued.grant.id}`);
    const cap = issued.capabilities[0];
    copy = new Database(file);
    const usersBefore = copy.prepare("SELECT * FROM users").all();
    assert.ok(createDelegationStore(copy).verify(cap.token, cap.audience, cap.action));
    copy.close(); copy = null;
    const result = run(["--database", file, "--confirm-offline-restore"]);
    assert.equal(result.status, 0, result.stderr); assert.ok(JSON.parse(result.stdout).revoked > 0);
    assert.ok(!result.stdout.includes(cap.token));
    copy = new Database(file);
    assert.equal(createDelegationStore(copy).verify(cap.token, cap.audience, cap.action), null);
    assert.deepEqual(copy.prepare("SELECT * FROM users").all(), usersBefore);
    const audit = copy.prepare("SELECT * FROM hc_activity_events WHERE target_id = ? AND event_type = 'homecore.delegation.restore_revoked'").get(issued.grant.id);
    assert.equal(audit.actor_user_id, null);
    assert.ok(!JSON.stringify(audit).includes(cap.token));
    copy.close(); copy = null;
    assert.deepEqual(JSON.parse(run(["--database", file, "--confirm-offline-restore"]).stdout), { revoked: 0 });
    copy = new Database(file);
    copy.exec("DROP TABLE hc_delegation_credentials; DROP TABLE hc_delegation_grants"); copy.close(); copy = null;
    assert.deepEqual(JSON.parse(run(["--database", file, "--confirm-offline-restore"]).stdout), { revoked: 0 });
    assert.equal(run(["--database", file]).status, 1);
    const absent = path.join(dir, "absent.db");
    assert.equal(run(["--database", absent, "--confirm-offline-restore"]).status, 1);
    assert.equal(fs.existsSync(absent), false);
  } finally { copy?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
