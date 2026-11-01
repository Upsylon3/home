const express = require("express");
const { requireDelegation } = require("@home/homecore-client");
const { db } = require("./db");
const { createAutomationStore } = require("./automationStore");
const store = createAutomationStore(db);
const router = express.Router();
router.post("/automation/tasks", (req, res, next) => { res.set("Cache-Control", "no-store"); next(); },
  requireDelegation({ audience: "hometasks", action: "tasks.automation.create-once" }), (req, res) => {
    try {
      if (Object.keys(req.query).length) return res.status(400).json({ error: "Task creation accepts no query parameters." });
      const result = store.createOnce(req.delegation, req.body);
      res.status(result.created ? 201 : 200).json({ receipt: result.receipt });
    } catch (error) {
      if (error.retryAfter) res.set("Retry-After", String(error.retryAfter));
      res.status(error.status || 500).json({ error: error.status ? error.message : "Automated task creation failed." });
    }
  });
module.exports = router;
