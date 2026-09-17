// Implements exactly the envelope described in docs/SECURITY.md:
//
//   master password --Argon2id--> master key --unwraps--> vault key
//   recovery key (raw, high-entropy) --unwraps (directly, no KDF)--> vault key
//   vault key --encrypts--> every item's title and data, independently
//
// This file is deliberately framework-free (no React) and has zero
// dependency on anything else in this app, specifically so it can be
// unit-tested with plain `node --test` — see ../test/crypto.test.js —
// the same way HomeSync's pathPlanner.js is tested in isolation from
// Android. Security-critical logic deserves the most direct test path
// available, not one routed through UI rendering.
//
// This server (apps/homevault-backend) NEVER sees a password, a derived
// key, or a vault key. Every function below that touches a real secret
// runs here, in the browser, and only ever sends ciphertext or public
// KDF parameters over the network.
import { argon2id } from "hash-wasm";

// OWASP's current recommended default for Argon2id (2024 cheat sheet):
// m=19 MiB, t=2, p=1. Runs client-side — in the user's own browser, not
// this ecosystem's (possibly modest, e.g. a Raspberry Pi) server — so
// there's no reason to weaken it for self-host hardware's sake. Stored
// per-vault (see apps/homevault-backend/src/db.js) so bumping this
// later never breaks an already-created vault; it only takes effect for
// a new vault or the next master-password change.
export const DEFAULT_KDF_PARAMS = { m: 19456, t: 2, p: 1 };

// A fixed, known plaintext. A copy of it, encrypted once under the real
// vault key at creation time, is stored alongside the wrapped keys.
// On unlock, decrypting that stored copy with the freshly-derived/
// unwrapped key and checking the result equals VERIFIER_PLAINTEXT lets
// the UI say "that password is wrong" immediately (see Unlock.jsx and
// Recover.jsx), instead of only finding out indirectly when decrypting
// the first real item fails. The comparison isn't what actually
// provides security here — AES-GCM's own authentication tag already
// makes `decryptBytes` throw on a wrong key before this check ever
// runs (see decryptBytes below); this is a deliberately redundant,
// explicit belt-and-suspenders check on top of that, not a substitute
// for it.
export const VERIFIER_PLAINTEXT = "homevault-verify-v1";

const AES_KEY_USAGES = ["encrypt", "decrypt"];

// ---- encoding helpers --------------------------------------------------

export function bytesToBase64(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// RFC 4648 base32, no padding — chosen for the recovery key specifically
// because it's unambiguous to hand-transcribe (no lookalike 0/O or 1/I/l
// the way base64/hex can read confusingly in some fonts) and shorter
// than hex for the same entropy. Implemented directly (20 lines) rather
// than adding a dependency for it.
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function bytesToBase32(bytes) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32ToBytes(str) {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

// Groups of 5 characters separated by dashes — easy to read aloud, easy
// to visually check in chunks, a well-worn convention (license/product
// keys, 2FA recovery codes) for exactly this "a human needs to copy this
// correctly" problem.
//
// The last group is a single checksum character (see crc8 below), not
// key material — it exists purely so a mistyped/mis-scanned character
// is caught immediately, with a clear "you made a typo" message, rather
// than silently producing a different, wrong 32-byte key that only
// fails much later (and unhelpfully) when it doesn't unwrap the vault.
// This is error *detection*, not a security control — it's exactly as
// guessable as any other single base32 character, so it adds no
// meaningful resistance if someone is deliberately guessing recovery
// keys (rate limiting and the key's own 256 bits of entropy already
// handle that).
export function formatRecoveryKey(bytes) {
  const raw = bytesToBase32(withChecksum(bytes));
  return raw.match(/.{1,5}/g).join("-");
}

// Throws with a distinct, recognizable message if the checksum doesn't
// match — callers (see Recover.jsx) use this to tell "you mistyped
// this" apart from "this key is correctly formed but doesn't unlock
// this particular vault," which need different messages to actually be
// useful to someone who's already stressed about being locked out.
export function parseRecoveryKey(formatted) {
  const bytes = base32ToBytes(formatted);
  return withoutChecksum(bytes);
}

// A minimal CRC-8 (poly 0x07, the standard/"CRC-8/SMBUS" variant) —
// deliberately not cryptographic. Its only job is catching an
// accidental single-character transcription error before it wastes a
// vault-unwrap attempt, not resisting a deliberate attacker (who would
// just recompute it, trivially, since it's neither secret nor keyed).
function crc8(bytes) {
  let crc = 0x00;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

function withChecksum(bytes) {
  return new Uint8Array([...bytes, crc8(bytes)]);
}

function withoutChecksum(bytesWithChecksum) {
  if (bytesWithChecksum.length < 1) {
    throw new Error("Recovery key is too short — check for a typo and try again.");
  }
  const bytes = bytesWithChecksum.slice(0, -1);
  const claimedChecksum = bytesWithChecksum[bytesWithChecksum.length - 1];
  if (crc8(bytes) !== claimedChecksum) {
    throw new Error("Recovery key has a typo — check it and try again.");
  }
  return bytes;
}

// ---- key derivation & generation ---------------------------------------

export function generateSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}

// Raw 256-bit recovery key. Already maximally random — unlike a
// human-chosen master password, it gains nothing from Argon2id and
// paying that cost on every recovery attempt would only be friction, so
// it's imported directly as an AES key (see importAesKeyRaw).
export function generateRecoveryKeyBytes() {
  return crypto.getRandomValues(new Uint8Array(32));
}

// Returns a raw 32-byte key derived from the password — the caller wraps
// it into a CryptoKey via importAesKeyRaw. Kept as two steps (derive,
// then import) rather than one, so the derivation itself — the part
// that's actually slow and actually protects a stolen database — is
// trivially unit-testable on its own, independent of the Web Crypto API
// surrounding it.
export async function deriveMasterKeyBits(password, salt, params = DEFAULT_KDF_PARAMS) {
  const hashHex = await argon2id({
    password,
    salt,
    memorySize: params.m,
    iterations: params.t,
    parallelism: params.p,
    hashLength: 32,
    outputType: "hex"
  });
  return hexToBytes(hashHex);
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export async function importAesKeyRaw(rawBytes, usages = AES_KEY_USAGES) {
  return crypto.subtle.importKey("raw", rawBytes, { name: "AES-GCM", length: 256 }, false, usages);
}

export async function generateVaultKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, AES_KEY_USAGES);
}

export async function exportKeyRaw(key) {
  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
}

// ---- generic encrypt/decrypt (used for both key-wrapping and item data) -

// Every call generates its own random 12-byte IV — reusing an IV with
// the same key is the one classical mistake that fully breaks AES-GCM's
// confidentiality and authentication both, so there is deliberately no
// code path here that accepts a caller-supplied IV.
export async function encryptBytes(plainBytes, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plainBytes);
  return { ciphertext: bytesToBase64(new Uint8Array(cipherBuf)), iv: bytesToBase64(iv) };
}

// Throws (via the Web Crypto API's own SubtleCrypto rejection) if `key`
// is wrong or the ciphertext was tampered with — AES-GCM authenticates
// on every decrypt, it does not silently return garbage. Callers rely on
// this: it's the actual mechanism behind "wrong password" detection
// (see VERIFIER_PLAINTEXT above) and behind items simply refusing to
// open if the database were ever corrupted or tampered with.
export async function decryptBytes(ciphertextB64, ivB64, key) {
  const cipherBytes = base64ToBytes(ciphertextB64);
  const iv = base64ToBytes(ivB64);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherBytes);
  return new Uint8Array(plainBuf);
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function encryptString(plaintext, key) {
  return encryptBytes(textEncoder.encode(plaintext), key);
}

export async function decryptString(ciphertextB64, ivB64, key) {
  return textDecoder.decode(await decryptBytes(ciphertextB64, ivB64, key));
}

export async function encryptJSON(obj, key) {
  return encryptString(JSON.stringify(obj), key);
}

export async function decryptJSON(ciphertextB64, ivB64, key) {
  return JSON.parse(await decryptString(ciphertextB64, ivB64, key));
}

// ---- vault-key wrapping (the envelope itself) ---------------------------

export async function wrapVaultKey(vaultKey, wrappingKey) {
  const raw = await exportKeyRaw(vaultKey);
  return encryptBytes(raw, wrappingKey);
}

export async function unwrapVaultKey(ciphertextB64, ivB64, wrappingKey) {
  const raw = await decryptBytes(ciphertextB64, ivB64, wrappingKey);
  return importAesKeyRaw(raw);
}
