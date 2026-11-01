const express = require("express");
const { createVerifier } = require("@home/homecore-client");
const { db } = require("./db");
const { asyncHandler } = require("./asyncHandler");
const router = express.Router();
// This destructive surface must not inherit the ordinary identity cache's
// five-second revocation window. Core outages fail closed with retryable errors.
const verifyLive = createVerifier({ cacheTtlMs: 0 });
router.use(asyncHandler(async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Sign in required." });
  const user = await verifyLive(token);
  if (!user) return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  if (user.role !== "admin") return res.status(403).json({ error: "Administrator access required." });
  req.user = user;
  next();
}));
router.param("userId", (req, res, next, value) => {
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id)) {
    return res.status(400).json({ error: "Invalid account id." });
  }
  req.targetUserId = id;
  next();
});
router.get("/users/:userId/vault", (req, res) => {
  const vault = db.prepare("SELECT id FROM vaults WHERE user_id = ?").get(req.targetUserId);
  res.json(vault ? { exists: true, vaultId: vault.id } : { exists: false });
});
const reset = db.transaction((actorId, targetId, vaultId) => {
  const current = db.prepare("SELECT id FROM vaults WHERE user_id = ?").get(targetId);
  if (!current) return 404;
  if (current.id !== vaultId) return 409;
  db.prepare("DELETE FROM vaults WHERE id = ?").run(vaultId);
  db.prepare("INSERT INTO vault_admin_resets (actor_user_id, target_user_id, vault_id) VALUES (?, ?, ?)").run(actorId, targetId, vaultId);
  return 204;
});
router.delete("/users/:userId/vault", (req, res) => {
  const { vaultId, confirmation } = req.body || {};
  if (!Number.isSafeInteger(vaultId) || vaultId <= 0 || confirmation !== `DELETE ${req.targetUserId}`) {
    return res.status(400).json({ error: "Confirm the account id and the checked vault id before resetting." });
  }
  const status = reset(req.user.id, req.targetUserId, vaultId);
  if (status === 404) return res.status(404).json({ error: "No vault exists for this account." });
  if (status === 409) return res.status(409).json({ error: "The vault has changed. Check its status again before resetting." });
  res.status(204).end();
});
module.exports = router;
