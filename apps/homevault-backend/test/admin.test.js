const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { registerHomevaultUser, makeClient } = require("./helpers/client");
let ctx, admin;
const envelope = { kdfSalt: "salt", kdfParams: { m: 19456, t: 2, p: 1 },
  wrappedKeyMaster: "master", wrappedKeyMasterIv: "iv", wrappedKeyRecovery: "recovery",
  wrappedKeyRecoveryIv: "iv", verifier: "verifier", verifierIv: "iv" };
const pathFor = id => `/api/homevault/admin/users/${id}/vault`;
before(async () => { ctx = await startTestApp(); admin = await registerHomevaultUser(ctx.homecore, ctx.baseUrl); });
after(stopTestApp);
async function owner() {
  const user = await registerHomevaultUser(ctx.homecore, ctx.baseUrl);
  const created = await user.client.post("/api/homevault/vault", envelope);
  assert.equal(created.status, 201);
  return { ...user, vaultId: ctx.db.prepare("SELECT id FROM vaults WHERE user_id = ?").get(user.user.id).id };
}
const confirmation = u => ({ vaultId: u.vaultId, confirmation: `DELETE ${u.user.id}` });

test("admin status exposes only existence and vault id; missing vault is explicit", async () => {
  const u = await owner();
  const status = await admin.client.get(pathFor(u.user.id));
  assert.equal(status.status, 200);
  assert.equal(status.headers.get("cache-control"), "no-store");
  assert.deepEqual(status.body, { exists: true, vaultId: u.vaultId });
  const empty = await registerHomevaultUser(ctx.homecore, ctx.baseUrl);
  assert.deepEqual((await admin.client.get(pathFor(empty.user.id))).body, { exists: false });
});

test("anonymous, ordinary user and owner cannot use administrator routes", async () => {
  const u = await owner(), other = await owner();
  for (const [client, code] of [[makeClient(ctx.baseUrl), 401], [u.client, 403], [other.client, 403]]) {
    assert.equal((await client.get(pathFor(u.user.id))).status, code);
    assert.equal((await client.delete(pathFor(u.user.id), confirmation(u))).status, code);
  }
  assert.equal((await u.client.get("/api/homevault/vault")).body.exists, true);
});

test("reset validates ids, explicit confirmation and exact vault generation", async () => {
  const u = await owner();
  for (const id of ["0", "-1", "1x", "1.5", "9007199254740992"]) {
    assert.equal((await admin.client.get(pathFor(id))).status, 400);
  }
  for (const body of [{}, { ...confirmation(u), confirmation: "yes" },
    { ...confirmation(u), vaultId: String(u.vaultId) }, { ...confirmation(u), vaultId: 0 }]) {
    assert.equal((await admin.client.delete(pathFor(u.user.id), body)).status, 400);
  }
  assert.equal((await admin.client.delete(pathFor(u.user.id), { ...confirmation(u), vaultId: u.vaultId + 1 })).status, 409);
  assert.equal((await u.client.get("/api/homevault/vault")).body.exists, true);
});

test("reset deletes active items and Trash, audits actor/target, preserves others and permits recreation", async () => {
  const u = await owner(), other = await owner();
  const item = { type: "note", encryptedTitle: "title", encryptedTitleIv: "iv", encryptedData: "data", encryptedDataIv: "iv" };
  const first = await u.client.post("/api/homevault/vault/items", item);
  await u.client.post("/api/homevault/vault/items", item);
  assert.equal((await u.client.delete(`/api/homevault/vault/items/${first.body.item.id}`)).status, 204);
  assert.equal((await admin.client.delete(pathFor(u.user.id), confirmation(u))).status, 204);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM vault_items WHERE vault_id = ?").get(u.vaultId).n, 0);
  const record = ctx.db.prepare("SELECT * FROM vault_admin_resets WHERE vault_id = ?").get(u.vaultId);
  assert.equal(record.actor_user_id, admin.user.id);
  assert.equal(record.target_user_id, u.user.id);
  assert.ok(record.created_at);
  assert.equal((await other.client.get("/api/homevault/vault")).body.exists, true);
  assert.equal((await u.client.get("/api/homevault/vault")).body.exists, false);
  const recreated = await u.client.post("/api/homevault/vault", envelope);
  assert.equal(recreated.status, 201);
  assert.notEqual(ctx.db.prepare("SELECT id FROM vaults WHERE user_id = ?").get(u.user.id).id, u.vaultId);
  assert.equal((await admin.client.delete(pathFor(u.user.id), confirmation(u))).status, 409);
  assert.equal((await u.client.get("/api/homevault/vault")).body.exists, true);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM vault_admin_resets WHERE vault_id = ?").get(u.vaultId).n, 1);
});

test("absent vault reset returns 404 without an audit record", async () => {
  const u = await registerHomevaultUser(ctx.homecore, ctx.baseUrl);
  assert.equal((await admin.client.delete(pathFor(u.user.id), { vaultId: 1, confirmation: `DELETE ${u.user.id}` })).status, 404);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM vault_admin_resets WHERE target_user_id = ?").get(u.user.id).n, 0);
});

test("failed audit rolls back vault deletion", async () => {
  const u = await owner();
  const item = await u.client.post("/api/homevault/vault/items", { type: "note", encryptedTitle: "title",
    encryptedTitleIv: "iv", encryptedData: "data", encryptedDataIv: "iv" });
  ctx.db.exec("CREATE TRIGGER fail_reset_audit BEFORE INSERT ON vault_admin_resets BEGIN SELECT RAISE(ABORT, 'test audit failure'); END");
  try {
    assert.equal((await admin.client.delete(pathFor(u.user.id), confirmation(u))).status, 500);
    assert.equal((await u.client.get("/api/homevault/vault")).body.exists, true);
    assert.ok(ctx.db.prepare("SELECT id FROM vault_items WHERE id = ?").get(item.body.item.id));
  } finally { ctx.db.exec("DROP TRIGGER fail_reset_audit"); }
});

test("Core outage fails closed even for a previously verified administrator", async () => {
  const u = await owner();
  assert.equal((await admin.client.get(pathFor(u.user.id))).status, 200);
  const address = ctx.homecore.server.address();
  ctx.homecore.server.closeAllConnections();
  await new Promise(resolve => ctx.homecore.server.close(resolve));
  try {
    assert.equal((await admin.client.get(pathFor(u.user.id))).status, 502);
    assert.equal((await admin.client.delete(pathFor(u.user.id), confirmation(u))).status, 502);
    assert.ok(ctx.db.prepare("SELECT id FROM vaults WHERE user_id = ?").get(u.user.id));
  } finally { await new Promise(resolve => ctx.homecore.server.listen(address.port, address.address, resolve)); }
});

test("admin authorization observes live Core demotion and revocation even after a cached owner request", async () => {
  const u = await owner(), actor = await registerHomevaultUser(ctx.homecore, ctx.baseUrl);
  ctx.homecore.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(actor.user.id);
  assert.equal((await actor.client.get("/api/homevault/vault")).status, 200);
  assert.equal((await actor.client.get(pathFor(u.user.id))).status, 200);
  ctx.homecore.db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(actor.user.id);
  assert.equal((await actor.client.delete(pathFor(u.user.id), confirmation(u))).status, 403);
  ctx.homecore.db.prepare("UPDATE users SET role = 'admin', disabled = 1 WHERE id = ?").run(actor.user.id);
  assert.equal((await actor.client.delete(pathFor(u.user.id), confirmation(u))).status, 401);
  ctx.homecore.db.prepare("UPDATE users SET disabled = 0 WHERE id = ?").run(actor.user.id);
  ctx.homecore.db.prepare("UPDATE users SET role = 'admin', token_version = token_version + 1 WHERE id = ?").run(actor.user.id);
  assert.equal((await actor.client.delete(pathFor(u.user.id), confirmation(u))).status, 401);
  assert.equal((await u.client.get("/api/homevault/vault")).body.exists, true);
});
