// Everything in this file is "dumb blob storage with an owner check" —
// per docs/SECURITY.md, encryption itself (not this server's logic) is
// what protects vault contents. Nothing here ever validates a password
// or derives a key; the client (apps/homevault/src/crypto.js) does all
// of that and sends the already-computed result. Server-side ownership
// (getOrCreateVaultRow always scoped to req.user.id) is the only real
// enforcement — exactly the same "each app checks its own ownership
// directly" model every other app in this ecosystem already uses.
const express = require("express");
const { db } = require("./db");
const { asyncHandler } = require("./asyncHandler");

const router = express.Router();

function getVaultRow(userId) {
  return db.prepare("SELECT * FROM vaults WHERE user_id = ?").get(userId);
}

function serializeVault(row) {
  return {
    kdfSalt: row.kdf_salt,
    kdfParams: JSON.parse(row.kdf_params),
    wrappedKeyMaster: row.wrapped_key_master,
    wrappedKeyMasterIv: row.wrapped_key_master_iv,
    wrappedKeyRecovery: row.wrapped_key_recovery,
    wrappedKeyRecoveryIv: row.wrapped_key_recovery_iv,
    verifier: row.verifier,
    verifierIv: row.verifier_iv,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Every field below is required and must be a non-empty string — this is
// a cheap shape check, not a security check. A malformed request just
// gets a 400 instead of a confusing 500 from a later JSON.parse; it
// can't be used to smuggle anything meaningful since none of it is ever
// interpreted as more than an opaque blob.
function requireEnvelopeFields(body, fields) {
  for (const f of fields) {
    if (typeof body[f] !== "string" || body[f].length === 0) {
      const err = new Error(`Missing or invalid field: ${f}`);
      err.status = 400;
      throw err;
    }
  }
}

// GET /api/homevault/vault — does this user have a vault yet, and if so,
// everything needed to attempt unlocking it. Returning both wrap paths
// (master-password and recovery-key) in one response is deliberate
// simplicity: neither is useful without the matching key the server
// never has, so there's no confidentiality reason to split this into two
// requests.
router.get(
  "/vault",
  asyncHandler(async (req, res) => {
    const row = getVaultRow(req.user.id);
    if (!row) return res.json({ exists: false });
    res.json({ exists: true, vault: serializeVault(row) });
  })
);

// POST /api/homevault/vault — create this user's vault. 409 if one
// already exists; this route only ever creates, never overwrites (see
// PATCH /vault/rewrap and POST /vault/regenerate-recovery for updates,
// and DELETE /vault for the explicit, separate "destroy and start over"
// action).
router.post(
  "/vault",
  asyncHandler(async (req, res) => {
    if (getVaultRow(req.user.id)) {
      return res.status(409).json({ error: "A vault already exists for this account." });
    }
    requireEnvelopeFields(req.body, [
      "kdfSalt",
      "wrappedKeyMaster",
      "wrappedKeyMasterIv",
      "wrappedKeyRecovery",
      "wrappedKeyRecoveryIv",
      "verifier",
      "verifierIv"
    ]);
    const kdfParams = req.body.kdfParams;
    if (!kdfParams || typeof kdfParams.m !== "number" || typeof kdfParams.t !== "number" || typeof kdfParams.p !== "number") {
      return res.status(400).json({ error: "Missing or invalid kdfParams (expected {m, t, p})." });
    }

    db.prepare(
      `INSERT INTO vaults
         (user_id, kdf_salt, kdf_params, wrapped_key_master, wrapped_key_master_iv,
          wrapped_key_recovery, wrapped_key_recovery_iv, verifier, verifier_iv)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.user.id,
      req.body.kdfSalt,
      JSON.stringify(kdfParams),
      req.body.wrappedKeyMaster,
      req.body.wrappedKeyMasterIv,
      req.body.wrappedKeyRecovery,
      req.body.wrappedKeyRecoveryIv,
      req.body.verifier,
      req.body.verifierIv
    );

    res.status(201).json({ vault: serializeVault(getVaultRow(req.user.id)) });
  })
);

// PATCH /api/homevault/vault/rewrap — replaces only the master-password
// wrap path (new salt, new params, new wrapped key, new verifier). Used
// for two different client-side flows that both end here: changing your
// master password (you had it, you're changing it), and completing a
// recovery (you used the recovery key to unlock, now you're setting a
// new master password since you forgot the old one). Either way the
// underlying vault key is unchanged — only how it's wrapped for the
// master-password path changes — so no item needs re-encrypting.
router.patch(
  "/vault/rewrap",
  asyncHandler(async (req, res) => {
    const row = getVaultRow(req.user.id);
    if (!row) return res.status(404).json({ error: "No vault exists for this account yet." });

    requireEnvelopeFields(req.body, ["kdfSalt", "wrappedKeyMaster", "wrappedKeyMasterIv", "verifier", "verifierIv"]);
    const kdfParams = req.body.kdfParams;
    if (!kdfParams || typeof kdfParams.m !== "number" || typeof kdfParams.t !== "number" || typeof kdfParams.p !== "number") {
      return res.status(400).json({ error: "Missing or invalid kdfParams (expected {m, t, p})." });
    }

    db.prepare(
      `UPDATE vaults
         SET kdf_salt = ?, kdf_params = ?, wrapped_key_master = ?, wrapped_key_master_iv = ?,
             verifier = ?, verifier_iv = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(req.body.kdfSalt, JSON.stringify(kdfParams), req.body.wrappedKeyMaster, req.body.wrappedKeyMasterIv, req.body.verifier, req.body.verifierIv, row.id);

    res.json({ vault: serializeVault(getVaultRow(req.user.id)) });
  })
);

// POST /api/homevault/vault/regenerate-recovery — replaces only the
// recovery-key wrap path. Invalidates any previously downloaded/printed
// recovery kit immediately (the old recovery key can no longer unwrap
// anything useful) — the frontend should make this consequence obvious
// before calling it, not just after.
router.post(
  "/vault/regenerate-recovery",
  asyncHandler(async (req, res) => {
    const row = getVaultRow(req.user.id);
    if (!row) return res.status(404).json({ error: "No vault exists for this account yet." });

    requireEnvelopeFields(req.body, ["wrappedKeyRecovery", "wrappedKeyRecoveryIv"]);

    db.prepare(
      `UPDATE vaults SET wrapped_key_recovery = ?, wrapped_key_recovery_iv = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(req.body.wrappedKeyRecovery, req.body.wrappedKeyRecoveryIv, row.id);

    res.json({ vault: serializeVault(getVaultRow(req.user.id)) });
  })
);

// DELETE /api/homevault/vault — destroys the vault and every item in it.
// Irreversible: there is no server-side backup of the unwrapped key, by
// design, so this isn't a soft-delete/Trash situation the way HomeCloud's
// files are — once this runs, the data is gone even with the correct
// master password. Matches the threat model's "HomeCore admin overreach"
// row: this is the one action an account holder (or, via a future admin
// route, HomeCore) can take on a vault without ever being able to read
// it first.
router.delete(
  "/vault",
  asyncHandler(async (req, res) => {
    const row = getVaultRow(req.user.id);
    if (!row) return res.status(404).json({ error: "No vault exists for this account yet." });
    db.prepare("DELETE FROM vaults WHERE id = ?").run(row.id); // vault_items cascades
    res.status(204).end();
  })
);

module.exports = { router, getVaultRow };
