const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { registerHomevaultUser } = require("./helpers/client");
let ctx, crypt;
before(async () => { ctx = await startTestApp(); crypt = await import("../../homevault/src/crypto.js"); });
after(stopTestApp);

test("real encrypted API lifecycle survives reload, password rewrap and recovery-key regeneration", async () => {
  const { client } = await registerHomevaultUser(ctx.homecore, ctx.baseUrl);
  const originalKey = await crypt.generateVaultKey();
  const salt = crypt.generateSalt(), params = crypt.DEFAULT_KDF_PARAMS;
  const master = await crypt.importAesKeyRaw(await crypt.deriveMasterKeyBits("disposable original master", salt, params));
  const recovery = await crypt.importAesKeyRaw(crypt.generateRecoveryKeyBytes());
  const masterWrap = await crypt.wrapVaultKey(originalKey, master), recoveryWrap = await crypt.wrapVaultKey(originalKey, recovery);
  const verifier = await crypt.encryptString(crypt.VERIFIER_PLAINTEXT, originalKey);
  const envelope = { kdfSalt: crypt.bytesToBase64(salt), kdfParams: params,
    wrappedKeyMaster: masterWrap.ciphertext, wrappedKeyMasterIv: masterWrap.iv,
    wrappedKeyRecovery: recoveryWrap.ciphertext, wrappedKeyRecoveryIv: recoveryWrap.iv,
    verifier: verifier.ciphertext, verifierIv: verifier.iv };
  assert.equal((await client.post("/api/homevault/vault", envelope)).status, 201);
  const title = await crypt.encryptString("disposable title", originalKey);
  const data = await crypt.encryptJSON({ password: "disposable item value" }, originalKey);
  const created = await client.post("/api/homevault/vault/items", { type: "login", encryptedTitle: title.ciphertext,
    encryptedTitleIv: title.iv, encryptedData: data.ciphertext, encryptedDataIv: data.iv });
  assert.equal(created.status, 201);
  const id = created.body.item.id;
  const stored = ctx.db.prepare("SELECT * FROM vault_items WHERE id = ?").get(id);
  // Rebuild the unlock state from the API envelope, as after a fresh page load.
  const loaded = (await client.get("/api/homevault/vault")).body.vault;
  const unlocked = await crypt.unwrapVaultKey(loaded.wrappedKeyMaster, loaded.wrappedKeyMasterIv, master);
  const nextSalt = crypt.generateSalt();
  const nextMaster = await crypt.importAesKeyRaw(await crypt.deriveMasterKeyBits("disposable replacement master", nextSalt, params));
  const nextWrap = await crypt.wrapVaultKey(unlocked, nextMaster);
  assert.equal((await client.patch("/api/homevault/vault/rewrap", { ...envelope, kdfSalt: crypt.bytesToBase64(nextSalt),
    wrappedKeyMaster: nextWrap.ciphertext, wrappedKeyMasterIv: nextWrap.iv })).status, 200);
  const reopened = (await client.get("/api/homevault/vault")).body.vault;
  const nextKey = await crypt.unwrapVaultKey(reopened.wrappedKeyMaster, reopened.wrappedKeyMasterIv, nextMaster);
  await assert.rejects(() => crypt.unwrapVaultKey(reopened.wrappedKeyMaster, reopened.wrappedKeyMasterIv, master));
  const regeneratedRecovery = await crypt.importAesKeyRaw(crypt.generateRecoveryKeyBytes());
  const regeneratedWrap = await crypt.wrapVaultKey(nextKey, regeneratedRecovery);
  assert.equal((await client.post("/api/homevault/vault/regenerate-recovery", {
    wrappedKeyRecovery: regeneratedWrap.ciphertext, wrappedKeyRecoveryIv: regeneratedWrap.iv })).status, 200);
  const recoveredEnvelope = (await client.get("/api/homevault/vault")).body.vault;
  await assert.rejects(() => crypt.unwrapVaultKey(recoveredEnvelope.wrappedKeyRecovery, recoveredEnvelope.wrappedKeyRecoveryIv, recovery));
  const recovered = await crypt.unwrapVaultKey(recoveredEnvelope.wrappedKeyRecovery, recoveredEnvelope.wrappedKeyRecoveryIv, regeneratedRecovery);
  const recoveredWrap = await crypt.wrapVaultKey(recovered, nextMaster);
  assert.equal((await client.patch("/api/homevault/vault/rewrap", { ...recoveredEnvelope,
    wrappedKeyMaster: recoveredWrap.ciphertext, wrappedKeyMasterIv: recoveredWrap.iv })).status, 200);
  const item = (await client.get(`/api/homevault/vault/items/${id}`)).body.item;
  assert.equal(await crypt.decryptString(item.encryptedTitle, item.encryptedTitleIv, recovered), "disposable title");
  assert.deepEqual(await crypt.decryptJSON(item.encryptedData, item.encryptedDataIv, recovered), { password: "disposable item value" });
  assert.deepEqual(ctx.db.prepare("SELECT * FROM vault_items WHERE id = ?").get(id), stored);
});
