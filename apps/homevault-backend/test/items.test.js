const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { registerHomevaultUser } = require("./helpers/client");

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

function fakeVaultEnvelope() {
  return {
    kdfSalt: "c2FsdA==",
    kdfParams: { m: 19456, t: 2, p: 1 },
    wrappedKeyMaster: "bWFzdGVy",
    wrappedKeyMasterIv: "aXYx",
    wrappedKeyRecovery: "cmVjb3Zlcnk=",
    wrappedKeyRecoveryIv: "aXYy",
    verifier: "dmVyaWZpZXI=",
    verifierIv: "aXYz"
  };
}

function fakeItem(overrides = {}) {
  return {
    type: "login",
    encryptedTitle: "dGl0bGU=",
    encryptedTitleIv: "dGl2",
    encryptedData: "ZGF0YQ==",
    encryptedDataIv: "ZGl2",
    ...overrides
  };
}

async function clientWithVault() {
  const { client } = await registerHomevaultUser(homecore, homevaultBaseUrl);
  await client.post("/api/homevault/vault", fakeVaultEnvelope());
  return client;
}

test("items require a vault to exist first (404, not empty list)", async () => {
  const { client } = await registerHomevaultUser(homecore, homevaultBaseUrl);
  const res = await client.get("/api/homevault/vault/items");
  assert.equal(res.status, 404);
});

test("POST creates an item, returned in full including its encrypted data", async () => {
  const client = await clientWithVault();
  const res = await client.post("/api/homevault/vault/items", fakeItem());
  assert.equal(res.status, 201);
  assert.equal(res.body.item.type, "login");
  assert.equal(res.body.item.encryptedTitle, "dGl0bGU=");
  assert.equal(res.body.item.encryptedData, "ZGF0YQ==");
  assert.ok(res.body.item.id);
});

test("POST rejects an invalid type", async () => {
  const client = await clientWithVault();
  const res = await client.post("/api/homevault/vault/items", fakeItem({ type: "not-a-real-type" }));
  assert.equal(res.status, 400);
});

test("POST rejects a missing encrypted field", async () => {
  const client = await clientWithVault();
  const item = fakeItem();
  delete item.encryptedData;
  const res = await client.post("/api/homevault/vault/items", item);
  assert.equal(res.status, 400);
});

test("GET /vault/items lists summaries only — no encryptedData field", async () => {
  const client = await clientWithVault();
  await client.post("/api/homevault/vault/items", fakeItem());
  const res = await client.get("/api/homevault/vault/items");
  assert.equal(res.status, 200);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].encryptedTitle, "dGl0bGU=");
  assert.equal(res.body.items[0].encryptedData, undefined, "list view must not include the full secret payload");
});

test("GET /vault/items/:id returns the full item", async () => {
  const client = await clientWithVault();
  const created = await client.post("/api/homevault/vault/items", fakeItem());
  const res = await client.get(`/api/homevault/vault/items/${created.body.item.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.item.encryptedData, "ZGF0YQ==");
});

test("GET /vault/items/:id 404s for a nonexistent item", async () => {
  const client = await clientWithVault();
  const res = await client.get("/api/homevault/vault/items/999999");
  assert.equal(res.status, 404);
});

test("PATCH updates an item's encrypted fields", async () => {
  const client = await clientWithVault();
  const created = await client.post("/api/homevault/vault/items", fakeItem());
  const res = await client.patch(`/api/homevault/vault/items/${created.body.item.id}`, {
    encryptedTitle: "bmV3dGl0bGU=",
    encryptedTitleIv: "bnRpdg==",
    encryptedData: "bmV3ZGF0YQ==",
    encryptedDataIv: "bmRpdg=="
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.item.encryptedTitle, "bmV3dGl0bGU=");
  assert.equal(res.body.item.type, "login", "PATCH must not require/overwrite type");
});

test("DELETE removes an item; a second delete 404s", async () => {
  const client = await clientWithVault();
  const created = await client.post("/api/homevault/vault/items", fakeItem());
  const first = await client.delete(`/api/homevault/vault/items/${created.body.item.id}`);
  assert.equal(first.status, 204);
  const second = await client.delete(`/api/homevault/vault/items/${created.body.item.id}`);
  assert.equal(second.status, 404);
});

test("one user cannot read, edit, or delete another user's item", async () => {
  const alice = await clientWithVault();
  const bob = await clientWithVault();

  const aliceItem = await alice.post("/api/homevault/vault/items", fakeItem());
  const itemId = aliceItem.body.item.id;

  const readAsBob = await bob.get(`/api/homevault/vault/items/${itemId}`);
  assert.equal(readAsBob.status, 404);

  const editAsBob = await bob.patch(`/api/homevault/vault/items/${itemId}`, fakeItem({ encryptedTitle: "hacked" }));
  assert.equal(editAsBob.status, 404);

  const deleteAsBob = await bob.delete(`/api/homevault/vault/items/${itemId}`);
  assert.equal(deleteAsBob.status, 404);

  // Confirm Alice's item genuinely survived Bob's attempts.
  const stillThere = await alice.get(`/api/homevault/vault/items/${itemId}`);
  assert.equal(stillThere.status, 200);
});

test("items require auth", async () => {
  const { makeClient } = require("./helpers/client");
  const anon = makeClient(homevaultBaseUrl);
  const res = await anon.get("/api/homevault/vault/items");
  assert.equal(res.status, 401);
});

test("supports all three item types", async () => {
  const client = await clientWithVault();
  for (const type of ["login", "note", "card"]) {
    const res = await client.post("/api/homevault/vault/items", fakeItem({ type }));
    assert.equal(res.status, 201, `type "${type}" should be accepted`);
    assert.equal(res.body.item.type, type);
  }
});
