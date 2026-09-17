import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_KDF_PARAMS,
  VERIFIER_PLAINTEXT,
  bytesToBase64,
  base64ToBytes,
  bytesToBase32,
  base32ToBytes,
  formatRecoveryKey,
  parseRecoveryKey,
  generateSalt,
  generateRecoveryKeyBytes,
  deriveMasterKeyBits,
  importAesKeyRaw,
  generateVaultKey,
  exportKeyRaw,
  encryptString,
  decryptString,
  encryptJSON,
  decryptJSON,
  wrapVaultKey,
  unwrapVaultKey
} from "../src/crypto.js";

// Small params for fast tests — real memory-hardness only needs to be
// verified once, not on every one of these round-trips. See the
// dedicated "uses the real default params" test below for that.
const FAST_PARAMS = { m: 8, t: 1, p: 1 };

test("base64 round-trips arbitrary bytes", () => {
  const original = crypto.getRandomValues(new Uint8Array(37));
  const decoded = base64ToBytes(bytesToBase64(original));
  assert.deepEqual([...decoded], [...original]);
});

test("base32 round-trips arbitrary bytes", () => {
  const original = crypto.getRandomValues(new Uint8Array(32));
  const decoded = base32ToBytes(bytesToBase32(original));
  assert.deepEqual([...decoded], [...original]);
});

test("recovery key formatting round-trips through its human-readable form", () => {
  const original = generateRecoveryKeyBytes();
  const formatted = formatRecoveryKey(original);
  assert.match(formatted, /^[A-Z2-7]{1,5}(-[A-Z2-7]{1,5})*$/, "should be dash-grouped base32");
  const parsed = parseRecoveryKey(formatted);
  assert.deepEqual([...parsed], [...original]);
});

test("recovery key parsing tolerates lowercase and stray whitespace", () => {
  const original = generateRecoveryKeyBytes();
  const formatted = formatRecoveryKey(original);
  const messy = "  " + formatted.toLowerCase().replace(/-/g, " ") + "  ";
  const parsed = parseRecoveryKey(messy);
  assert.deepEqual([...parsed], [...original]);
});

// The trailing base32 character in a formatted recovery key is a
// checksum, not key material — see crypto.js's formatRecoveryKey
// comment for why. These two tests are the reason it exists: catching
// a transcription error immediately, with a message that says so,
// rather than silently producing a different 32-byte key that only
// fails much later when it doesn't unwrap the vault.
test("parseRecoveryKey rejects a single mistyped character with a clear, distinct error", () => {
  const original = generateRecoveryKeyBytes();
  const formatted = formatRecoveryKey(original);
  // Flip one character in the middle of the key portion (not the
  // trailing checksum character itself) to a different valid base32
  // character — simulating a real, easy-to-make single-character typo.
  const flipIndex = 10;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const originalChar = formatted[flipIndex];
  const replacement = alphabet[(alphabet.indexOf(originalChar) + 1) % alphabet.length];
  const typoed = formatted.slice(0, flipIndex) + replacement + formatted.slice(flipIndex + 1);

  assert.throws(() => parseRecoveryKey(typoed), /typo/i);
});

test("parseRecoveryKey accepts a correctly-transcribed key including its checksum character", () => {
  const original = generateRecoveryKeyBytes();
  const formatted = formatRecoveryKey(original);
  // Sanity check the test fixture itself: the checksum character is a
  // real, meaningful part of the string, not a no-op appended
  // separator — formatted output should be longer than a plain,
  // checksum-less base32 encoding of the same 32 bytes would be.
  assert.ok(formatted.replace(/-/g, "").length > bytesToBase32(original).length);
  assert.deepEqual([...parseRecoveryKey(formatted)], [...original]);
});

test("Argon2id derivation is deterministic for the same password+salt+params", async () => {
  const salt = generateSalt();
  const a = await deriveMasterKeyBits("correct horse battery staple", salt, FAST_PARAMS);
  const b = await deriveMasterKeyBits("correct horse battery staple", salt, FAST_PARAMS);
  assert.deepEqual([...a], [...b]);
  assert.equal(a.length, 32);
});

test("Argon2id derivation differs for a different password", async () => {
  const salt = generateSalt();
  const a = await deriveMasterKeyBits("correct horse battery staple", salt, FAST_PARAMS);
  const b = await deriveMasterKeyBits("wrong password entirely", salt, FAST_PARAMS);
  assert.notDeepEqual([...a], [...b]);
});

test("Argon2id derivation differs for a different salt (same password)", async () => {
  const a = await deriveMasterKeyBits("same password", generateSalt(), FAST_PARAMS);
  const b = await deriveMasterKeyBits("same password", generateSalt(), FAST_PARAMS);
  assert.notDeepEqual([...a], [...b]);
});

test("encrypt/decrypt string round-trips under the same key", async () => {
  const key = await generateVaultKey();
  const { ciphertext, iv } = await encryptString("hello, vault", key);
  const plaintext = await decryptString(ciphertext, iv, key);
  assert.equal(plaintext, "hello, vault");
});

test("encrypt/decrypt JSON round-trips a realistic item payload", async () => {
  const key = await generateVaultKey();
  const item = { username: "jane", password: "sup3r-secret!", url: "https://example.com", notes: "shared with family" };
  const { ciphertext, iv } = await encryptJSON(item, key);
  const decrypted = await decryptJSON(ciphertext, iv, key);
  assert.deepEqual(decrypted, item);
});

test("two encryptions of the same plaintext use different IVs and produce different ciphertext", async () => {
  const key = await generateVaultKey();
  const a = await encryptString("same plaintext", key);
  const b = await encryptString("same plaintext", key);
  assert.notEqual(a.iv, b.iv, "IV must be fresh every call");
  assert.notEqual(a.ciphertext, b.ciphertext);
});

test("decrypting with the wrong key throws rather than returning garbage (AEAD authentication)", async () => {
  const key = await generateVaultKey();
  const wrongKey = await generateVaultKey();
  const { ciphertext, iv } = await encryptString("sensitive", key);
  await assert.rejects(() => decryptString(ciphertext, iv, wrongKey));
});

test("decrypting tampered ciphertext throws rather than returning corrupted plaintext", async () => {
  const key = await generateVaultKey();
  const { ciphertext, iv } = await encryptString("sensitive", key);
  const tampered = base64ToBytes(ciphertext);
  tampered[0] ^= 0xff;
  await assert.rejects(() => decryptString(bytesToBase64(tampered), iv, key));
});

test("vault key wrap/unwrap round-trips and the unwrapped key decrypts data encrypted by the original", async () => {
  const vaultKey = await generateVaultKey();
  const wrappingKeyBits = crypto.getRandomValues(new Uint8Array(32));
  const wrappingKey = await importAesKeyRaw(wrappingKeyBits);

  const { ciphertext, iv } = await wrapVaultKey(vaultKey, wrappingKey);
  const unwrapped = await unwrapVaultKey(ciphertext, iv, wrappingKey);

  const encrypted = await encryptString("proof this is really the same key", vaultKey);
  const decrypted = await decryptString(encrypted.ciphertext, encrypted.iv, unwrapped);
  assert.equal(decrypted, "proof this is really the same key");
});

test("unwrapping with the wrong wrapping key throws, never silently returns a usable key", async () => {
  const vaultKey = await generateVaultKey();
  const rightWrappingKey = await importAesKeyRaw(crypto.getRandomValues(new Uint8Array(32)));
  const wrongWrappingKey = await importAesKeyRaw(crypto.getRandomValues(new Uint8Array(32)));

  const { ciphertext, iv } = await wrapVaultKey(vaultKey, rightWrappingKey);
  await assert.rejects(() => unwrapVaultKey(ciphertext, iv, wrongWrappingKey));
});

test("the two independent unwrap paths (master password and recovery key) both reach the same vault key", async () => {
  // Mirrors exactly what apps/homevault/src/pages/Setup.jsx does at
  // vault creation: one vault key, wrapped twice, two unrelated ways in.
  const vaultKey = await generateVaultKey();

  const salt = generateSalt();
  const masterBits = await deriveMasterKeyBits("my real master password", salt, FAST_PARAMS);
  const masterWrappingKey = await importAesKeyRaw(masterBits);
  const masterWrap = await wrapVaultKey(vaultKey, masterWrappingKey);

  const recoveryBytes = generateRecoveryKeyBytes();
  const recoveryWrappingKey = await importAesKeyRaw(recoveryBytes);
  const recoveryWrap = await wrapVaultKey(vaultKey, recoveryWrappingKey);

  const unwrappedViaPassword = await unwrapVaultKey(masterWrap.ciphertext, masterWrap.iv, masterWrappingKey);
  const unwrappedViaRecovery = await unwrapVaultKey(recoveryWrap.ciphertext, recoveryWrap.iv, recoveryWrappingKey);

  const probe = await encryptString("same underlying vault key", vaultKey);
  assert.equal(await decryptString(probe.ciphertext, probe.iv, unwrappedViaPassword), "same underlying vault key");
  assert.equal(await decryptString(probe.ciphertext, probe.iv, unwrappedViaRecovery), "same underlying vault key");
});

test("verifier plaintext round-trips — the fast wrong-password check the UI relies on", async () => {
  const key = await generateVaultKey();
  const { ciphertext, iv } = await encryptString(VERIFIER_PLAINTEXT, key);
  assert.equal(await decryptString(ciphertext, iv, key), VERIFIER_PLAINTEXT);

  const wrongKey = await generateVaultKey();
  await assert.rejects(() => decryptString(ciphertext, iv, wrongKey), "a wrong key must fail the verifier, not silently pass");
});

test("exportKeyRaw/importAesKeyRaw round-trips a generated key", async () => {
  const key = await generateVaultKey();
  const raw = await exportKeyRaw(key);
  assert.equal(raw.length, 32, "AES-256 key must export to exactly 32 bytes");
  const reimported = await importAesKeyRaw(raw);
  const probe = await encryptString("round trip", key);
  assert.equal(await decryptString(probe.ciphertext, probe.iv, reimported), "round trip");
});

// Slower, real-parameter test kept separate and last: confirms the actual
// shipped default (docs/SECURITY.md's "concrete Argon2id parameters,
// benchmarked against realistic minimum self-hosting hardware") produces
// a usable key and completes in a bounded time on ordinary hardware —
// not just that the fast test-only params above work.
test("DEFAULT_KDF_PARAMS derives a usable 32-byte key in bounded time", async () => {
  const start = Date.now();
  const bits = await deriveMasterKeyBits("a real master password", generateSalt(), DEFAULT_KDF_PARAMS);
  const elapsedMs = Date.now() - start;
  assert.equal(bits.length, 32);
  // Generous ceiling — this environment's CPU is an unknown quantity and
  // the point is "not hung/misconfigured," not a tight performance
  // budget. A real UX latency budget belongs in manual testing on
  // target hardware (docs/SECURITY.md's own stated prerequisite),
  // not asserted here as if this sandbox were representative of it.
  assert.ok(elapsedMs < 10_000, `Argon2id with DEFAULT_KDF_PARAMS took ${elapsedMs}ms — investigate before shipping`);
});
