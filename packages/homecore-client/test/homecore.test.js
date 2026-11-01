const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("../../../homecore/test/helpers/app");
const { createVerifier } = require("../src/verify");

test("real HomeCore identities, logout and account disabling remain authoritative", async (t) => {
  const homecore = await startTestApp();
  t.after(stopTestApp);
  let clock = 0;
  const verify = createVerifier({ homecoreUrl: homecore.baseUrl, now: () => clock });
  async function post(path, body, token) {
    const response = await fetch(`${homecore.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body)
    });
    assert.ok(response.ok, `${path}: ${response.status}`);
    return response.json();
  }
  const admin = await post("/api/auth/register", { username: "verify-admin", password: "disposable-test-password" });
  const member = await post("/api/auth/register", { username: "verify-member", password: "disposable-test-password" });
  assert.equal((await verify(admin.token)).role, "admin");
  assert.equal((await verify(member.token)).id, member.user.id);
  assert.equal(await verify("invalid-test-token"), null);

  await post(`/api/admin/users/${member.user.id}/disabled`, { disabled: true }, admin.token);
  clock += 5000;
  assert.equal(await verify(member.token), null, "disabled users must be refused after the cache window");

  await verify(admin.token);
  await post("/api/auth/logout-everywhere", {}, admin.token);
  clock += 5000;
  assert.equal(await verify(admin.token), null, "revoked sessions must be refused after the cache window");
});
