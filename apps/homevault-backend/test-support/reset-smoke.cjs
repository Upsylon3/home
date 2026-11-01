// CI's disposable stack only: accepts its administrator token over stdin,
// never prints it, and refuses non-loopback destinations.
const assert = require("node:assert/strict");
async function main() {
  const base = process.env.VAULT_SMOKE_BASE || "http://127.0.0.1:8080";
  if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname)) throw new Error("Loopback CI stack required.");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const { adminToken } = JSON.parse(input);
  assert.equal(typeof adminToken, "string");
  async function call(path, method = "GET", token = adminToken, body, expected = 200) {
    const response = await fetch(`${base}/api${path}`, { method, redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, expected, `${method} ${path}: unexpected status`);
    return response.status === 204 ? null : response.json();
  }
  const owner = await call("/auth/register", "POST", "", {
    username: "ci-vault-owner", password: "DisposableVaultAccount123!"
  }, 201);
  const envelope = { kdfSalt: "salt", kdfParams: { m: 19456, t: 2, p: 1 },
    wrappedKeyMaster: "master", wrappedKeyMasterIv: "iv", wrappedKeyRecovery: "recovery",
    wrappedKeyRecoveryIv: "iv", verifier: "verifier", verifierIv: "iv" };
  await call("/homevault/vault", "POST", owner.token, envelope, 201);
  const item = await call("/homevault/vault/items", "POST", owner.token, {
    type: "note", encryptedTitle: "title", encryptedTitleIv: "iv", encryptedData: "data", encryptedDataIv: "iv"
  }, 201);
  await call(`/homevault/vault/items/${item.item.id}`, "DELETE", owner.token, undefined, 204);
  const path = `/homevault/admin/users/${owner.user.id}/vault`;
  await call(path, "GET", owner.token, undefined, 403);
  const status = await call(path);
  assert.deepEqual(Object.keys(status).sort(), ["exists", "vaultId"]);
  const body = { vaultId: status.vaultId, confirmation: `DELETE ${owner.user.id}` };
  await call(path, "DELETE", adminToken, body, 204);
  assert.deepEqual(await call("/homevault/vault", "GET", owner.token), { exists: false });
  await call("/homevault/vault", "POST", owner.token, envelope, 201);
  await call(path, "DELETE", adminToken, body, 409);
  assert.equal((await call("/homevault/vault/items", "GET", owner.token)).items.length, 0);
  await call("/homevault/vault", "DELETE", owner.token, undefined, 204);
  console.log("ok Vault administrator reset, owner isolation, Trash cascade and replacement guard through gateway");
}
main().catch(() => { console.error("Vault reset smoke failed."); process.exitCode = 1; });
