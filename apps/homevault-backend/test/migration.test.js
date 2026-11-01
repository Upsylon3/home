const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const Database = require("better-sqlite3");

test("Trash migration preserves an existing vault and ciphertext across two starts", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "homevault-migration-"));
  const databasePath = path.join(dataDir, "homevault.db");
  let db;
  try {
    db = new Database(databasePath);
    // The pre-Trash schema, including populated rows, exercises an upgrade
    // rather than just recreating the new schema in an empty database.
    db.exec(`
      CREATE TABLE vaults (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL UNIQUE,
        kdf_salt TEXT NOT NULL, kdf_params TEXT NOT NULL,
        wrapped_key_master TEXT NOT NULL, wrapped_key_master_iv TEXT NOT NULL,
        wrapped_key_recovery TEXT NOT NULL, wrapped_key_recovery_iv TEXT NOT NULL,
        verifier TEXT NOT NULL, verifier_iv TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE vault_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vault_id INTEGER NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('login', 'note', 'card')),
        encrypted_title TEXT NOT NULL, encrypted_title_iv TEXT NOT NULL,
        encrypted_data TEXT NOT NULL, encrypted_data_iv TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO vaults (user_id, kdf_salt, kdf_params, wrapped_key_master,
        wrapped_key_master_iv, wrapped_key_recovery, wrapped_key_recovery_iv, verifier, verifier_iv)
      VALUES (42, 'salt', '{"m":19456,"t":2,"p":1}', 'master', 'm-iv', 'recovery', 'r-iv', 'verifier', 'v-iv');
      INSERT INTO vault_items (vault_id, type, encrypted_title, encrypted_title_iv, encrypted_data, encrypted_data_iv)
      VALUES (1, 'note', 'opaque-title', 'title-iv', 'opaque-data', 'data-iv');
    `);
    const vault = db.prepare("SELECT * FROM vaults").get();
    const item = db.prepare("SELECT * FROM vault_items").get();
    db.close();
    const entry = path.resolve(__dirname, "../src/db.js");
    for (let i = 0; i < 2; i++) {
      execFileSync(process.execPath, ["-e", "require(process.argv[1]).db.close()", entry], {
        env: { ...process.env, DATA_DIR: dataDir }, stdio: "pipe"
      });
      db = new Database(databasePath);
      assert.deepEqual(db.prepare("SELECT * FROM vaults").get(), vault);
      assert.deepEqual(db.prepare("SELECT * FROM vault_items").get(), {
        ...item, deleted_at: i === 0 ? null : "2026-01-01 00:00:00"
      });
      if (i === 0) db.prepare("UPDATE vault_items SET deleted_at = ? WHERE id = ?").run("2026-01-01 00:00:00", item.id);
      db.close();
    }
  } finally {
    if (db?.open) db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
