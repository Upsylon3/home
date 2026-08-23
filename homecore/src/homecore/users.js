// /api/core/users/* — HOME_MASTER_SPECIFICATION.md §10.
// This deliberately does NOT touch password/username/role — that's still
// HomeCloud's existing /api/auth surface (change-password, etc). This is
// only the identity fields HomeCore itself owns per §7.1: displayName, plus
// a read-only view of the account and its sessions.
const express = require("express");
const { db } = require("../db");
const { asyncHandler } = require("../asyncHandler");
const { errorBody } = require("./errors");
const { listSessions } = require("./sessions");

const router = express.Router();

function serializeSelf(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at
  };
}

router.get("/me", (req, res) => {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json({ user: serializeSelf(row) });
});

router.patch(
  "/me",
  asyncHandler(async (req, res) => {
    const { displayName } = req.body || {};

    if (displayName !== undefined && displayName !== null) {
      if (typeof displayName !== "string" || displayName.trim().length === 0 || displayName.length > 64) {
        return res
          .status(400)
          .json(errorBody(req, "INVALID_DISPLAY_NAME", "displayName must be 1-64 characters, or null to clear it."));
      }
    }

    if (displayName !== undefined) {
      db.prepare("UPDATE users SET display_name = ?, updated_at = datetime('now') WHERE id = ?").run(
        displayName,
        req.user.id
      );
    }

    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    res.json({ user: serializeSelf(row) });
  })
);

// A first, small piece of usable "Sessions" surface (§7.2): lets a user see
// every device that's logged in and when it was last active. There's no
// per-session revoke endpoint yet in v0 — only revoke-all exists today
// (HomeCloud's existing /api/auth/logout-everywhere) — so this is read-only
// for now.
router.get("/me/sessions", (req, res) => {
  res.json({ sessions: listSessions(req.user.id) });
});

module.exports = router;
