const express = require("express");
const { db } = require("./db");
const { requireAuth } = require("./middleware/authMiddleware");

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  const rows = db
    .prepare(
      `SELECT action, target_name AS targetName, created_at AS createdAt
       FROM activity_log
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 100`
    )
    .all(req.user.id);
  res.json({ activity: rows });
});

module.exports = router;
