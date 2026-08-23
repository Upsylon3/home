const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { TOTP, Secret } = require("otpauth");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerUser } = require("./helpers/client");

let baseUrl;

before(async () => {
  ({ baseUrl } = await startTestApp());
});

after(async () => {
  await stopTestApp();
});

function totpCodeFor(secretBase32) {
  const totp = new TOTP({
    issuer: "homecloud",
    label: "test",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32)
  });
  return totp.generate();
}

// This must be the very first test to run in this file (the isolated app's
// database starts empty) since "the first account is admin" is only true
// for the actual first-ever registration.
test("the first registered account becomes admin, the second does not", async () => {
  const client = makeClient(baseUrl);

  const first = await client.post("/api/auth/register", { username: "first_admin", password: "CorrectHorse1" });
  assert.equal(first.status, 201);
  assert.equal(first.body.user.role, "admin");

  const second = await client.post("/api/auth/register", { username: "second_user", password: "CorrectHorse2" });
  assert.equal(second.status, 201);
  assert.equal(second.body.user.role, "user");
});

test("register rejects missing fields, bad usernames, and short passwords", async () => {
  const client = makeClient(baseUrl);

  const missing = await client.post("/api/auth/register", { username: "onlyuser" });
  assert.equal(missing.status, 400);

  const badChars = await client.post("/api/auth/register", { username: "no spaces!", password: "longenough1" });
  assert.equal(badChars.status, 400);

  const tooShortName = await client.post("/api/auth/register", { username: "ab", password: "longenough1" });
  assert.equal(tooShortName.status, 400);

  const shortPassword = await client.post("/api/auth/register", { username: "validname1", password: "short" });
  assert.equal(shortPassword.status, 400);
});

test("register rejects a duplicate username", async () => {
  const client = makeClient(baseUrl);
  const username = "dupe_check_user";

  const first = await client.post("/api/auth/register", { username, password: "CorrectHorse1" });
  assert.equal(first.status, 201);

  const second = await client.post("/api/auth/register", { username, password: "DifferentPass1" });
  assert.equal(second.status, 409);
});

test("login rejects a wrong password and accepts the right one", async () => {
  const client = makeClient(baseUrl);
  const { username, password } = await registerUser(baseUrl);

  const wrong = await client.post("/api/auth/login", { username, password: "TotallyWrongPassword1" });
  assert.equal(wrong.status, 401);

  const right = await client.post("/api/auth/login", { username, password });
  assert.equal(right.status, 200);
  assert.ok(right.body.token);
  assert.equal(right.body.user.username, username);
});

test("a disabled account cannot log in", async () => {
  // Only the very first account ever registered in this file's isolated
  // database is admin (see the first test above) — log in as that account
  // rather than registering a fresh one, which would just get "user".
  const adminClient = makeClient(baseUrl);
  const adminLogin = await adminClient.post("/api/auth/login", { username: "first_admin", password: "CorrectHorse1" });
  assert.equal(adminLogin.status, 200);
  adminClient.setToken(adminLogin.body.token);

  const target = await registerUser(baseUrl, { username: "disable_flow_target" });

  const disableRes = await adminClient.post(`/api/admin/users/${target.user.id}/disabled`, { disabled: true });
  assert.equal(disableRes.status, 200);

  const loginRes = await makeClient(baseUrl).post("/api/auth/login", {
    username: target.username,
    password: target.password
  });
  assert.equal(loginRes.status, 403);
});

test("GET /api/auth/me requires a valid token and returns quota/usage", async () => {
  const noToken = await makeClient(baseUrl).get("/api/auth/me");
  assert.equal(noToken.status, 401);

  const { client, username } = await registerUser(baseUrl);
  const me = await client.get("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.username, username);
  assert.equal(typeof me.body.quotaBytes, "number");
  assert.equal(me.body.usedBytes, 0);
  assert.equal(me.body.totpEnabled, false);
});

test("change-password rejects a wrong current password, and on success invalidates the old token", async () => {
  const { client, password } = await registerUser(baseUrl);

  const wrong = await client.post("/api/auth/change-password", {
    currentPassword: "NotTheRealPassword1",
    newPassword: "BrandNewPassword1"
  });
  assert.equal(wrong.status, 401);

  const oldTokenStillWorks = await client.get("/api/auth/me");
  assert.equal(oldTokenStillWorks.status, 200);

  const changed = await client.post("/api/auth/change-password", {
    currentPassword: password,
    newPassword: "BrandNewPassword1"
  });
  assert.equal(changed.status, 200);
  assert.ok(changed.body.token);

  // The client helper is still holding the *old* token at this point.
  const oldTokenNowRejected = await client.get("/api/auth/me");
  assert.equal(oldTokenNowRejected.status, 401);

  client.setToken(changed.body.token);
  const newTokenWorks = await client.get("/api/auth/me");
  assert.equal(newTokenWorks.status, 200);
});

test("logout-everywhere invalidates the very token used to call it", async () => {
  const { client } = await registerUser(baseUrl);

  const before1 = await client.get("/api/auth/me");
  assert.equal(before1.status, 200);

  const out = await client.post("/api/auth/logout-everywhere");
  assert.equal(out.status, 200);

  const after1 = await client.get("/api/auth/me");
  assert.equal(after1.status, 401);
});

test("full 2FA lifecycle: setup, confirm, login requires code, recovery code works once", async () => {
  const { client, username, password } = await registerUser(baseUrl, { username: "twofactor_user" });

  const setup = await client.post("/api/auth/2fa/setup");
  assert.equal(setup.status, 200);
  assert.ok(setup.body.secret);

  const confirm = await client.post("/api/auth/2fa/confirm", { code: totpCodeFor(setup.body.secret) });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.ok, true);
  assert.ok(Array.isArray(confirm.body.recoveryCodes) && confirm.body.recoveryCodes.length === 8);
  const recoveryCode = confirm.body.recoveryCodes[0];

  // Plain login now stops short and asks for a 2FA code instead of a token.
  const anonClient = makeClient(baseUrl);
  const loginAttempt = await anonClient.post("/api/auth/login", { username, password });
  assert.equal(loginAttempt.status, 200);
  assert.equal(loginAttempt.body.requires2fa, true);
  assert.ok(loginAttempt.body.pendingToken);

  // A pending token must never work as a real session token.
  anonClient.setToken(loginAttempt.body.pendingToken);
  const rejectedAsSession = await anonClient.get("/api/auth/me");
  assert.equal(rejectedAsSession.status, 401);

  // A wrong code is rejected.
  const wrongCode = await makeClient(baseUrl).post("/api/auth/2fa/verify", {
    pendingToken: loginAttempt.body.pendingToken,
    code: "000000"
  });
  assert.equal(wrongCode.status, 401);

  // The correct recovery code completes login (consuming it in the process).
  const viaRecovery = await makeClient(baseUrl).post("/api/auth/2fa/verify", {
    pendingToken: loginAttempt.body.pendingToken,
    code: recoveryCode
  });
  assert.equal(viaRecovery.status, 200);
  assert.ok(viaRecovery.body.token);

  // The same recovery code cannot be used a second time — need a fresh
  // pending token first since the old one may still be within its 5-minute
  // window, but the code itself should now be consumed.
  const secondLoginAttempt = await makeClient(baseUrl).post("/api/auth/login", { username, password });
  const reuseAttempt = await makeClient(baseUrl).post("/api/auth/2fa/verify", {
    pendingToken: secondLoginAttempt.body.pendingToken,
    code: recoveryCode
  });
  assert.equal(reuseAttempt.status, 401);
});

test("2fa/disable requires the current password", async () => {
  const { client, password } = await registerUser(baseUrl, { username: "twofactor_disable_user" });

  const setup = await client.post("/api/auth/2fa/setup");
  await client.post("/api/auth/2fa/confirm", { code: totpCodeFor(setup.body.secret) });

  const wrongPassword = await client.post("/api/auth/2fa/disable", { password: "NotItPassword1" });
  assert.equal(wrongPassword.status, 401);

  const rightPassword = await client.post("/api/auth/2fa/disable", { password });
  assert.equal(rightPassword.status, 200);

  const me = await client.get("/api/auth/me");
  assert.equal(me.body.totpEnabled, false);
});
