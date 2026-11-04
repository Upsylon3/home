const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient } = require("./helpers/client");
let instance, client;
before(async () => {
  process.env.HOME_SETUP_REQUIRED = "true";
  instance = await startTestApp();
  client = makeClient(instance.baseUrl);
});
after(stopTestApp);
function issue({ issuedAt = Date.now(), expiresAt = issuedAt + 900_000 } = {}) {
  const code = crypto.randomBytes(16).toString("hex");
  fs.writeFileSync(path.join(instance.dataDir, "registration-code.json"), JSON.stringify({
    hash: crypto.createHash("sha256").update(code).digest("hex"), issuedAt, expiresAt
  }));
  return code;
}
const register = (username, setupCode, password = "CorrectHorseBattery1", prefix = "/api/auth") =>
  client.post(prefix + "/register", { username, password, setupCode });

test("managed registration fails closed without valid setup state on both API aliases", async () => {
  const status = await client.get("/api/core/auth/registration");
  assert.deepEqual(status.body, { requiresSetupCode: true, ownerCreated: false });
  assert.equal(status.headers.get("cache-control"), "no-store");
  assert.equal((await register("missing_code")).status, 403);
  assert.equal((await register("fake_code", "a".repeat(32), undefined, "/api/core/auth")).status, 403);
  assert.equal(instance.db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 0);
  fs.writeFileSync(path.join(instance.dataDir, "registration-code.json"), "invalid json");
  assert.equal((await register("bad_state", "a".repeat(32))).status, 403);
});

test("expired, future and excessive-lifetime codes cannot claim ownership", async () => {
  for (const dates of [
    { issuedAt: Date.now() - 100_000, expiresAt: Date.now() - 1 },
    { issuedAt: Date.now() + 60_000, expiresAt: Date.now() + 120_000 },
    { issuedAt: Date.now(), expiresAt: Date.now() + 3_600_000 }
  ]) assert.equal((await register("expired_code", issue(dates))).status, 403);
});

test("valid code creates exactly one owner under concurrent claims; replay is refused", async () => {
  const code = issue();
  const results = await Promise.all([
    register("claim_one", code.match(/.{4}/g).join("-")),
    register("claim_two", code, undefined, "/api/core/auth")
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 403]);
  assert.equal(results.find(r => r.status === 201).body.user.role, "admin");
  assert.equal((await register("replay_claim", code)).status, 403);
  assert.equal((await client.get("/api/auth/registration")).body.ownerCreated, true);
});

test("a new code admits a household member without granting administrator rights", async () => {
  const code = issue();
  assert.equal((await register("new_member", code, "short")).status, 400);
  const result = await register("new_member", code);
  assert.equal(result.status, 201);
  assert.equal(result.body.user.role, "user");
  assert.equal((await register("uninvited_member")).status, 403);
});

test("development installs retain existing registration behavior", async () => {
  delete process.env.HOME_SETUP_REQUIRED;
  assert.equal((await register("legacy_member")).status, 201);
});
