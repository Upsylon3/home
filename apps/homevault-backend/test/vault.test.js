// The server never validates that a "wrapped key" or "verifier" is
// actually correct ciphertext — it can't, it has no key to check
// against (see src/vault.js's header comment). So these tests use
// simple fake base64-looking strings as stand-ins wherever real
// ciphertext would go; what's under test is ownership, shape
// validation, and CRUD behavior, not cryptographic correctness — that's
// apps/homevault/test/crypto.test.js's job, tested in complete isolation
// from this server for exactly that reason.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerHomevaultUser } = require("./helpers/client");

let homecore;
let homevaultBaseUrl;

before(async () => {
  const started = await startTestApp();
  homecore = started.homecore;
  homevaultBaseUrl = started.baseUrl;
});

after(async () => {
  await stopTestApp();
});

function fakeEnvelope(overrides = {}) {
  return {
    kdfSalt: "c2FsdGJ5dGVz",
    kdfParams: { m: 19456, t: 2, p: 1 },
    wrappedKeyMaster: "d3JhcHBlZC1tYXN0ZXI=",
    wrappedKeyMasterIv: "aXYtbWFzdGVy",
    wrappedKeyRecovery: "d3JhcHBlZC1yZWNvdmVyeQ==",
    wrappedKeyRecoveryIv: "aXYtcmVjb3Zlcnk=",
    verifier: "dmVyaWZpZXI=",
    verifierIv: "aXYtdmVyaWZpZXI=",
    ...overrides
  };
}

test("GET /vault returns exists:false when no vault has been created yet", async () => {
  const { client } = await registerHomevaultUser(homecore, homevaultBaseUrl);
  const res = await client.get("/api/homevault/vault");
  assert.equal(res.status, 200);
  assert.equal(res.body.exists, false);
});

test("requires auth", async () => {
  const anon = makeClient(homevaultBaseUrl);
  const res = await anon.get("/api/homevault/vault");
  assert.equal(res.status, 401);
});

test("POST /vault creates a vault and GET /vault then returns it", async () => {
  const { client } = await registerHomevaultUser(homecore, homevaultBaseUrl);

  const created = await client.post("/api/homevault/vault", fakeEnvelope());
  assert.equal(created.status, 201);
  assert.equal(created.body.vault.kdfSalt, "c2FsdGJ5dGVz");
  assert.deepEqual(created.body.vault.kdfParams, { m: 19456, t: 2, p: 1 });

  const fetched = await client.get("/api/homevault/vault");
  assert.equal(fetched.body.exists, true);
  assert.equal(fetched.body.vault.wrappedKeyMaster, "d3JhcHBlZC1tYXN0ZXI=");
  assert.equal(fetched.body.vault.wrappedKeyRecovery, "d3JhcHBlZC1yZWNvdmVyeQ==");
});

test("POST /vault refuses a second vault for the same user (409)", async () => {
  const { client } = await registerHomevaultUser(homecore, homevaultBaseUrl);
  await client.post("/api/homevault/vault", fakeEnvelope());
  const res = await client.post("/api/homevault/vault", fakeEnvelope());
  assert.equal(res.status, 409);
});

test("POST /vault rejects a missing field with 400, not a 500", async () => {
  const { client } = await registerHomevaultUser(homecore, homevaultBaseUrl);
  const envelope = fakeEnvelope();
  delete envelope.wrappedKeyRecovery;
  const res = await client.post("/api/homevault/vault", envelope);
  assert.equal(res.status, 400);
});

test("POST /vault rejects malformed kdfParams", async () => {
  const { client } = await registerHomevaultUser(homecore, homevaultBaseUrl);
  const res = await client.post("/api/homevault/vault", fakeEnvelope({ kdfParams: { m: "not a number" } }));
  assert.equal(res.status, 400);
});

test("two different users each get their own independent vault", async () => {
  const { client: alice } = await registerHomevaultUser(homecore, homevaultBaseUrl);
  const { client: bob } = await registerHomevaultUser(homecore, homevaultBaseUrl);

  await alice.post("/api/homevault/vault", fakeEnvelope({ kdfSalt: "YWxpY2Utc2FsdA==" }));
  await bob.post("/api/homevault/vault", fakeEnvelope({ kdfSalt: "Ym9iLXNhbHQ=" }));

  const aliceVault = await alice.get("/api/homevault/vault");
  const bobVault = await bob.get("/api/homevault/vault");
  assert.equal(aliceVault.body.vault.kdfSalt, "YWxpY2Utc2FsdA==");
  assert.equal(bobVault.body.vault.kdfSalt, "Ym9iLXNhbHQ=");
});

test("PATCH /vault/rewrap replaces only the master-password wrap path", async () => {
  const { client } = await registerHomevaultUser(homecore, homevaultBaseUrl);
  await client.post("/api/homevault/vault", fakeEnvelope());

  const res = await client.patch("/api/homevault/vault/rewrap", {
    kdfSalt: "bmV3LXNhbHQ=",
    kdfParams: { m: 19456, t: 2, p: 1 },
    wrappedKeyMaster: "bmV3LXdyYXA=",
    wrappedKeyMasterIv: "bmV3LWl2",
    verifier: "bmV3LXZlcmlmaWVy",
    verifierIv: "bmV3LXZlcmlmaWVyLWl2"
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.vault.kdfSalt, "bmV3LXNhbHQ=");
  assert.equal(res.body.vault.wrappedKeyMaster, "bmV3LXdyYXA=");
  // Recovery wrap must be untouched by a master-password-only rewrap.
  assert.equal(res.body.vault.wrappedKeyRecovery, "d3JhcHBlZC1yZWNvdmVyeQ==");
});

test("PATCH /vault/rewrap on a nonexistent vault returns 404", async () => {
  const { client } = await registerHomevaultUser(homecore, homevaultBaseUrl);
  const res = await client.patch("/api/homevault/vault/rewrap", fakeEnvelope());
  assert.equal(res.status, 404);
});

test("POST /vault/regenerate-recovery replaces only the recovery wrap path", async () => {
  const { client } = await registerHomevaultUser(homecore, homevaultBaseUrl);
  await client.post("/api/homevault/vault", fakeEnvelope());

  const res = await client.post("/api/homevault/vault/regenerate-recovery", {
    wrappedKeyRecovery: "cmVnZW5lcmF0ZWQ=",
    wrappedKeyRecoveryIv: "cmVnZW5lcmF0ZWQtaXY="
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.vault.wrappedKeyRecovery, "cmVnZW5lcmF0ZWQ=");
  // Master-password wrap must be untouched.
  assert.equal(res.body.vault.wrappedKeyMaster, "d3JhcHBlZC1tYXN0ZXI=");
});

test("DELETE /vault destroys the vault; a subsequent GET reports exists:false", async () => {
  const { client } = await registerHomevaultUser(homecore, homevaultBaseUrl);
  await client.post("/api/homevault/vault", fakeEnvelope());

  const deleteRes = await client.delete("/api/homevault/vault");
  assert.equal(deleteRes.status, 204);

  const res = await client.get("/api/homevault/vault");
  assert.equal(res.body.exists, false);
});

test("DELETE /vault on a nonexistent vault returns 404", async () => {
  const { client } = await registerHomevaultUser(homecore, homevaultBaseUrl);
  const res = await client.delete("/api/homevault/vault");
  assert.equal(res.status, 404);
});

test("deleting a vault cascades to its items", async () => {
  const { client } = await registerHomevaultUser(homecore, homevaultBaseUrl);
  await client.post("/api/homevault/vault", fakeEnvelope());
  const item = await client.post("/api/homevault/vault/items", {
    type: "note",
    encryptedTitle: "dGl0bGU=",
    encryptedTitleIv: "aXY=",
    encryptedData: "ZGF0YQ==",
    encryptedDataIv: "aXYy"
  });

  await client.delete("/api/homevault/vault");
  await client.post("/api/homevault/vault", fakeEnvelope()); // recreate — fresh, empty vault
  const res = await client.get(`/api/homevault/vault/items/${item.body.item.id}`);
  assert.equal(res.status, 404, "an item from a destroyed vault must not resurface under the new one");
});
