// Express 4 doesn't catch rejected promises from async route handlers on
// its own — without this, a thrown/rejected error inside an async handler
// would hang the request instead of reaching the error-handling middleware.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { asyncHandler };
