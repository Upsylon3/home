const rateLimit = require("express-rate-limit");

// Same small utility as homecore/src/rateLimiter.js (and, following the
// same pattern, duplicated rather than shared — it's generic enough that
// packages/homecore-client wouldn't be the right home for it, and small
// enough that duplicating it costs less than the plumbing to share it).
//
// DISABLE_RATE_LIMIT_FOR_TESTS must never be set outside a test run — see
// test/helpers/app.js, which inherits it from HomeCore's own test harness
// (booted first, in the same process) rather than setting it a second
// time itself.
function createRateLimiter(options) {
  if (process.env.DISABLE_RATE_LIMIT_FOR_TESTS === "true") {
    return (req, res, next) => next();
  }
  return rateLimit(options);
}

module.exports = { createRateLimiter };
