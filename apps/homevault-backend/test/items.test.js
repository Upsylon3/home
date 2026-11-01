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

test("deletion keeps ciphertext in Trash; restore returns the same item", async () => {
  const client = await clientWithVault();
  const created = await client.post("/api/homevault/vault/items", fakeItem());
  const original = created.body.item;
  const path = `/api/homevault/vault/items/${original.id}`;
  assert.equal((await client.delete(path)).status, 204);
  assert.deepEqual((await client.get("/api/homevault/vault/items")).body.items, []);
  assert.equal((await client.get(path)).status, 404);
  assert.equal((await client.patch(path, fakeItem())).status, 404);
  const trash = await client.get("/api/homevault/vault/items?trash=true");
  assert.equal(trash.status, 200);
  assert.equal(trash.body.items.length, 1);
  assert.equal(trash.body.items[0].id, original.id);
  assert.ok(trash.body.items[0].deletedAt);
  assert.equal(trash.body.items[0].encryptedData, undefined);
  assert.equal((await client.post(`${path}/restore`)).status, 204);
  assert.deepEqual((await client.get(path)).body.item, original);
  assert.deepEqual((await client.get("/api/homevault/vault/items?trash=true")).body.items, []);
  assert.equal((await client.post(`${path}/restore`)).status, 404);
});

test("permanent deletion requires Trash and removes the ciphertext row", async () => {
  const client = await clientWithVault();
  const created = await client.post("/api/homevault/vault/items", fakeItem());
  const id = created.body.item.id;
  const path = `/api/homevault/vault/items/${id}`;
  assert.equal((await client.delete(`${path}/permanent`)).status, 404);
  assert.equal((await client.get(path)).status, 200);
  await client.delete(path);
  assert.equal((await client.delete(`${path}/permanent`)).status, 204);
  const { db } = await startTestApp();
  assert.equal(db.prepare("SELECT * FROM vault_items WHERE id = ?").get(id), undefined);
  assert.equal((await client.post(`${path}/restore`)).status, 404);
  assert.equal((await client.delete(`${path}/permanent`)).status, 404);
});

test("Trash, restore, and purge preserve ownership and require authentication", async () => {
  const alice = await clientWithVault();
  const bob = await clientWithVault();
  const { makeClient } = require("./helpers/client");
  const anon = makeClient(homevaultBaseUrl);
  const created = await alice.post("/api/homevault/vault/items", fakeItem());
  const path = `/api/homevault/vault/items/${created.body.item.id}`;
  await alice.delete(path);
  assert.deepEqual((await bob.get("/api/homevault/vault/items?trash=true")).body.items, []);
  assert.equal((await bob.post(`${path}/restore`)).status, 404);
  assert.equal((await bob.delete(`${path}/permanent`)).status, 404);
  assert.equal((await anon.get("/api/homevault/vault/items?trash=true")).status, 401);
  assert.equal((await anon.post(`${path}/restore`)).status, 401);
  assert.equal((await anon.delete(`${path}/permanent`)).status, 401);
  assert.equal((await alice.get("/api/homevault/vault/items?trash=true")).body.items.length, 1);
  assert.equal((await alice.post(`${path}/restore`)).status, 204);
});

test("deleting the vault also removes trashed items", async () => {
  const client = await clientWithVault();
  const created = await client.post("/api/homevault/vault/items", fakeItem());
  await client.delete(`/api/homevault/vault/items/${created.body.item.id}`);
  await client.delete("/api/homevault/vault");
  const { db } = await startTestApp();
  assert.equal(db.prepare("SELECT * FROM vault_items WHERE id = ?").get(created.body.item.id), undefined);
});

test("Trash query rejects ambiguous filters", async () => {
  const client = await clientWithVault();
  for (const query of ["trash=1", "trash=", "trash=true&trash=false"]) {
    assert.equal((await client.get(`/api/homevault/vault/items?${query}`)).status, 400, query);
  }
  assert.equal((await client.get("/api/homevault/vault/items?trash=false")).status, 200);
});
