// HomeVault's own database. Every value that could reveal anything about
// what a user stored is ciphertext, encrypted and decrypted entirely in
// the browser (apps/homevault/src/crypto.js) — this server never
// receives, generates, or holds a master password, a derived key, or a
// vault key in a usable form. See docs/SECURITY.md for the full threat
// model this schema is built to satisfy.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "homevault.db"));
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
// Explicit, not strictly required — see
// apps/homecloud-backend/src/db.js's identical line for the full
// explanation: verified directly that this project's pinned
// better-sqlite3 already defaults foreign keys to on, so the
// ON DELETE CASCADE below was never silently broken. Set anyway so
// that stays true regardless of a future dependency upgrade's default.
db.pragma("foreign_keys = ON");

db.exec(`
  -- One vault per user. The "envelope" this table stores:
  --   master password --Argon2id(kdf_salt, kdf_params)--> master key
  --   master key --unwraps--> wrapped_key_master --> vault key
  --   recovery key (raw, high-entropy, never Argon2id'd — it doesn't
  --     need to be, it's not human-chosen) --unwraps--> wrapped_key_recovery
  --     --> the SAME vault key, by a second independent path
  --   vault key --decrypts--> verifier (a known fixed string, so the
  --     client can confirm a password/recovery key was right before
  --     trying to decrypt real items) and every row in vault_items
  --
  -- kdf_params is stored per-vault (JSON: {"m":...,"t":...,"p":...}),
  -- not read from a shared constant, specifically so a future change to
  -- the recommended Argon2id parameters (docs/SECURITY.md) never breaks
  -- an existing vault — each vault remembers what it was actually
  -- created with. Changing a master password re-derives with current
  -- parameters and re-wraps, which is also how an old vault would pick
  -- up new parameters over time, gradually, without a forced migration.
  CREATE TABLE IF NOT EXISTS vaults (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    kdf_salt TEXT NOT NULL,
    kdf_params TEXT NOT NULL,
    wrapped_key_master TEXT NOT NULL,
    wrapped_key_master_iv TEXT NOT NULL,
    wrapped_key_recovery TEXT NOT NULL,
    wrapped_key_recovery_iv TEXT NOT NULL,
    verifier TEXT NOT NULL,
    verifier_iv TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- "type" is the one deliberately-plaintext column — a UI affordance
  -- (which icon, which fields to show) in the same spirit as item count/
  -- size/timestamps already being accepted as visible metadata
  -- (docs/SECURITY.md's "Metadata leakage" row). It reveals far less
  -- than a title would ("this is a login" vs. "Bank of America login").
  -- Title and the actual secret data are both ciphertext, each with its
  -- own IV — reusing an IV across two ciphertexts under the same key is
  -- the one classical mistake that fully breaks AES-GCM, so every
  -- encrypted column gets its own.
  CREATE TABLE IF NOT EXISTS vault_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vault_id INTEGER NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('login', 'note', 'card')),
    encrypted_title TEXT NOT NULL,
    encrypted_title_iv TEXT NOT NULL,
    encrypted_data TEXT NOT NULL,
    encrypted_data_iv TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_vault_items_vault_id ON vault_items(vault_id);
`);

module.exports = { db };
