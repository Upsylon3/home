// GET /internal/users/usage — see src/internalUsage.js's header comment
// for why it's authenticated differently from every other route in this
// service.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { registerHomecloudBackendUser } = require("./helpers/client");

let baseUrl, homecore, internalSecret;

before(async () => {
  ({ baseUrl, homecore } = await startTestApp());
  // homecore's own test harness (booted just above, as a dependency)
  // already generates a random HOMECORE_INTERNAL_SECRET for its own
  // /internal/events tests — reusing that exact value here, rather than
  // setting a second one, is what actually proves the two services agree
  // on one shared secret, same as they'll need to in a real deployment.
  internalSecret = homecore.internalSecret;
});

after(async () => {
  await stopTestApp();
});

async function registerUser(overrides) {
  return registerHomecloudBackendUser(homecore, baseUrl, overrides);
}

async function uploadBytes(client, name, sizeBytes) {
  const form = new FormData();
  form.append("file", new Blob(["a".repeat(sizeBytes)], { type: "text/plain" }), name);
  const res = await client.post("/api/homecloud/files/upload", form, { raw: true });
  assert.equal(res.status, 201);
  return res.body.file;
}

test("rejects a request with no secret header at all", async () => {
  const res = await fetch(`${baseUrl}/internal/users/usage`);
  assert.equal(res.status, 401);
});

test("rejects a request with the wrong secret", async () => {
  const res = await fetch(`${baseUrl}/internal/users/usage`, {
    headers: { "X-Internal-Secret": "not-the-real-secret" }
  });
  assert.equal(res.status, 401);
});

test("fails closed when the server's own secret is unset, even with a header provided", async () => {
  const original = process.env.HOMECORE_INTERNAL_SECRET;
  delete process.env.HOMECORE_INTERNAL_SECRET;
  try {
    const res = await fetch(`${baseUrl}/internal/users/usage`, {
      headers: { "X-Internal-Secret": internalSecret }
    });
    assert.equal(res.status, 401);
  } finally {
    process.env.HOMECORE_INTERNAL_SECRET = original;
  }
});

test("with the correct secret, returns usage only for users who actually have files", async () => {
  const withFiles = await registerUser();
  await registerUser(); // a second, real account with zero files — must NOT appear below

  await uploadBytes(withFiles.client, "a.txt", 100);
  await uploadBytes(withFiles.client, "b.txt", 250);

  const res = await fetch(`${baseUrl}/internal/users/usage`, {
    headers: { "X-Internal-Secret": internalSecret }
  });
  assert.equal(res.status, 200);
  const body = await res.json();

  const entry = body.usage.find((u) => u.userId === withFiles.user.id);
  assert.ok(entry, "expected an entry for the user who uploaded files");
  assert.equal(entry.usedBytes, 350);

  // The zero-file account correctly has no row — admin.js is the one that
  // defaults a missing entry to 0, not this endpoint padding the list.
  assert.equal(body.usage.length, 1);
});
