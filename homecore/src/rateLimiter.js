const rateLimit = require("express-rate-limit");

// express-rate-limit's counters are shared per IP for the lifetime of the
// process — the right behavior in production, but it means an automated
// test file that legitimately exercises register/login/2FA/password-change
// many times in a few seconds (all from the same test-harness IP) trips
// the same 429 a real attacker would, for reasons that have nothing to do
// with whatever that test is actually checking.
//
// DISABLE_RATE_LIMIT_FOR_TESTS must never be set outside a test run — the
// only place that sets it is test/helpers/app.js. Everywhere else
// (including a real deployment's .env) it's unset, so createRateLimiter()
// always returns the real express-rate-limit middleware in production —
// this changes no runtime behavior for anyone actually running the server.
function createRateLimiter(options) {
  if (process.env.DISABLE_RATE_LIMIT_FOR_TESTS === "true") {
    return (req, res, next) => next();
  }
  return rateLimit(options);
}

module.exports = { createRateLimiter };
