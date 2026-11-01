const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");

let app;
before(async () => { app = await startTestApp(); });
after(stopTestApp);

async function register(username, prefix = "/api/auth") {
  const response = await fetch(`${app.baseUrl}${prefix}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "disposable-registration-password" })
  });
  return { status: response.status, body: await response.json() };
}

test("concurrent first registrations across both prefixes create exactly one administrator", async () => {
  const results = await Promise.all(["first-one", "first-two", "first-three"].map((name, i) => register(name, i % 2 ? "/api/core/auth" : "/api/auth")));
  assert.deepEqual(results.map((result) => result.status), [201, 201, 201]);
  assert.equal(results.filter((result) => result.body.user.role === "admin").length, 1);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n, 1);
  for (const result of results) {
    const response = await fetch(`${app.baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${result.body.token}` }
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).role, result.body.user.role);
  }
});

test("concurrent requests for the same username produce one account and a conflict", async () => {
  const results = await Promise.all([register("same-name"), register("same-name", "/api/core/auth")]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM users WHERE username = ?").get("same-name").n, 1);
  assert.equal(results.find((result) => result.status === 201).body.user.role, "user");
  assert.equal(results.find((result) => result.status === 409).body.error, "That username is already taken.");
});
