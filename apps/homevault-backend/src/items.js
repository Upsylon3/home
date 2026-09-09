// Item CRUD, all scoped through the caller's own vault (getVaultRow,
// from ./vault.js) — never a bare item id lookup. An item id alone
// reveals nothing about who it belongs to, so every route re-derives
// "this user's vault" first and joins through it, the same
// ownership-first pattern every other app in this ecosystem uses for
// files/notes/albums.
const express = require("express");
const { db } = require("./db");
const { asyncHandler } = require("./asyncHandler");
const { getVaultRow } = require("./vault");

const router = express.Router();

const ITEM_TYPES = ["login", "note", "card"];

function requireVault(req) {
  const vault = getVaultRow(req.user.id);
  if (!vault) {
    const err = new Error("No vault exists for this account yet.");
    err.status = 404;
    throw err;
  }
  return vault;
}

function requireEncryptedFields(body, fields) {
  for (const f of fields) {
    if (typeof body[f] !== "string" || body[f].length === 0) {
      const err = new Error(`Missing or invalid field: ${f}`);
      err.status = 400;
      throw err;
    }
  }
}

function serializeItemSummary(row) {
  return {
    id: row.id,
    type: row.type,
    encryptedTitle: row.encrypted_title,
    encryptedTitleIv: row.encrypted_title_iv,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeItemFull(row) {
  return {
    ...serializeItemSummary(row),
    encryptedData: row.encrypted_data,
    encryptedDataIv: row.encrypted_data_iv
  };
}

// GET /api/homevault/vault/items — summaries only (title, not the full
// secret payload) so opening the vault doesn't pull every item's full
// ciphertext over the wire before the user has picked one to look at.
router.get(
  "/vault/items",
  asyncHandler(async (req, res) => {
    const vault = requireVault(req);
    const rows = db.prepare("SELECT * FROM vault_items WHERE vault_id = ? ORDER BY updated_at DESC").all(vault.id);
    res.json({ items: rows.map(serializeItemSummary) });
  })
);

router.get(
  "/vault/items/:id",
  asyncHandler(async (req, res) => {
    const vault = requireVault(req);
    const row = db.prepare("SELECT * FROM vault_items WHERE id = ? AND vault_id = ?").get(req.params.id, vault.id);
    if (!row) return res.status(404).json({ error: "Item not found." });
    res.json({ item: serializeItemFull(row) });
  })
);

router.post(
  "/vault/items",
  asyncHandler(async (req, res) => {
    const vault = requireVault(req);
    if (!ITEM_TYPES.includes(req.body.type)) {
      return res.status(400).json({ error: `type must be one of: ${ITEM_TYPES.join(", ")}` });
    }
    requireEncryptedFields(req.body, ["encryptedTitle", "encryptedTitleIv", "encryptedData", "encryptedDataIv"]);

    const result = db
      .prepare(
        `INSERT INTO vault_items (vault_id, type, encrypted_title, encrypted_title_iv, encrypted_data, encrypted_data_iv)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(vault.id, req.body.type, req.body.encryptedTitle, req.body.encryptedTitleIv, req.body.encryptedData, req.body.encryptedDataIv);

    const row = db.prepare("SELECT * FROM vault_items WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json({ item: serializeItemFull(row) });
  })
);

router.patch(
  "/vault/items/:id",
  asyncHandler(async (req, res) => {
    const vault = requireVault(req);
    const existing = db.prepare("SELECT * FROM vault_items WHERE id = ? AND vault_id = ?").get(req.params.id, vault.id);
    if (!existing) return res.status(404).json({ error: "Item not found." });

    requireEncryptedFields(req.body, ["encryptedTitle", "encryptedTitleIv", "encryptedData", "encryptedDataIv"]);

    db.prepare(
      `UPDATE vault_items
         SET encrypted_title = ?, encrypted_title_iv = ?, encrypted_data = ?, encrypted_data_iv = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(req.body.encryptedTitle, req.body.encryptedTitleIv, req.body.encryptedData, req.body.encryptedDataIv, existing.id);

    const row = db.prepare("SELECT * FROM vault_items WHERE id = ?").get(existing.id);
    res.json({ item: serializeItemFull(row) });
  })
);

router.delete(
  "/vault/items/:id",
  asyncHandler(async (req, res) => {
    const vault = requireVault(req);
    const result = db.prepare("DELETE FROM vault_items WHERE id = ? AND vault_id = ?").run(req.params.id, vault.id);
    if (result.changes === 0) return res.status(404).json({ error: "Item not found." });
    res.status(204).end();
  })
);

module.exports = { router };
