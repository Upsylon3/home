const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../middleware/authMiddleware");
const { createRateLimiter } = require("../rateLimiter");
const { createDelegationStore, INTEGRATION } = require("./delegationStore");

const store = createDelegationStore(db);
const noStore = (req, res, next) => { res.set("Cache-Control", "no-store"); next(); };
const fail = (res, status, code, message) => res.status(status).json({ error: { code, message, requestId: res.req?.requestId } });
function fields(body, keys) {
  return body && !Array.isArray(body) && typeof body === "object" &&
    Object.keys(body).length === keys.length && Object.keys(body).every(key => keys.includes(key));
}
function guarded(action) {
  return (req, res) => {
    try { action(req, res); }
    catch (error) {
      // Never pass a minting error or its request body to a generic logger.
      fail(res, error.status || 500, error.status ? error.code : "DELEGATION_ERROR",
        error.status ? error.message : "Delegation operation failed.");
    }
  };
}
const limiter = () => createRateLimiter({ windowMs: 60000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: { code: "DELEGATION_BUSY", message: "Delegation requests are busy. Try again later." } } });

const publicRouter = express.Router();
publicRouter.use(noStore);
publicRouter.post("/verify", limiter(), guarded((req, res) => {
  if (!fields(req.body, ["audience", "action"]) || typeof req.body.audience !== "string" ||
      typeof req.body.action !== "string" || req.body.audience.length > 64 || req.body.action.length > 64) {
    return fail(res, 400, "INVALID_DELEGATION_REQUEST", "An explicit audience and action are required.");
  }
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const principal = store.verify(token, req.body.audience, req.body.action);
  if (!principal) return fail(res, 403, "DELEGATION_REFUSED", "Delegation is not authorized.");
  res.json({ delegation: principal });
}));
publicRouter.use(requireAuth);
publicRouter.get("/", guarded((req, res) => res.json({ grants: store.list(req.user.id) })));
publicRouter.delete("/:id", guarded((req, res) => { store.revoke(req.user.id, req.params.id); res.status(204).end(); }));

// Issuance is not exposed by the public gateway or a browser UI. A future
// enrollment server forwards the consenting owner's full session here.
const issuanceRouter = express.Router();
issuanceRouter.use(noStore, (req, res, next) => {
  if (req.headers.origin || req.headers["sec-fetch-site"] || req.headers["sec-fetch-dest"]) {
    return fail(res, 403, "SERVER_REQUEST_REQUIRED", "Issuance requires an internal server request.");
  }
  next();
}, requireAuth, limiter());
issuanceRouter.post("/", guarded((req, res) => {
  if (!fields(req.body, ["integrationId", "consent"]) || req.body.integrationId !== INTEGRATION || req.body.consent !== true) {
    return fail(res, 400, "CONSENT_REQUIRED", "Explicit consent to monitor-followup-v1 is required.");
  }
  res.status(201).json(store.issue(req.user.id, req.sessionTokenVersion));
}));
issuanceRouter.post("/:id/renew", guarded((req, res) => {
  if (!fields(req.body, ["consent"]) || req.body.consent !== true) {
    return fail(res, 400, "CONSENT_REQUIRED", "Renewal requires fresh explicit consent.");
  }
  res.json(store.issue(req.user.id, req.sessionTokenVersion, req.params.id));
}));

module.exports = { publicRouter, issuanceRouter };
