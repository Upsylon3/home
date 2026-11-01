// HOME_MASTER_SPECIFICATION.md §33 defines a standard error shape:
//   { error: { code, message, requestId } }
//
// Core's platform routes use this shape. Compatibility auth/admin routers
// under /api/core deliberately retain their known legacy error strings;
// path migration does not silently change their response contract.
// Existing compatibility and application endpoints keep their original
// { error: "..." } shape. Unifying those contracts requires a separate
// versioned migration with caller updates, not a change of URL prefix.
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
