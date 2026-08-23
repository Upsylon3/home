// HOME_MASTER_SPECIFICATION.md §33 defines a standard error shape:
//   { error: { code, message, requestId } }
//
// This only applies to routes mounted under /api/core — HomeCloud's
// existing endpoints (/api/auth, /api/files, /api/folders, /api/admin,
// /api/activity, /api/share) still return their original { error: "..." }
// shape. Rule 2 says don't change existing behavior without being asked,
// and the frontend already depends on that shape; unifying it is a
// follow-up migration, not part of v0.
const crypto = require("crypto");

function attachRequestId(req, res, next) {
  req.requestId = `req_${crypto.randomBytes(8).toString("hex")}`;
  next();
}

function errorBody(req, code, message) {
  return { error: { code, message, requestId: req.requestId } };
}

// Error handler scoped to the /api/core router, mounted after all of
// HomeCore's routes (see index.js) so unexpected errors there get the
// { error: {...} } shape instead of falling through to server.js's
// legacy { error: "string" } handler.
function coreErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  console.error("[homecore]", err);
  res.status(500).json(errorBody(req, "INTERNAL_ERROR", "Internal server error."));
}

module.exports = { attachRequestId, errorBody, coreErrorHandler };
