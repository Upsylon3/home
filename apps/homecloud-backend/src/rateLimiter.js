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

// Which proxies in front of this service we believe when they say who the
// real visitor is (the X-Forwarded-For header). Without this, Express sees
// every request as coming from the gateway container, so the login rate
// limiter below treated ALL visitors as ONE person: 10 wrong guesses from
// anyone locked everyone out. Harmless on a home LAN; a lock-out lever the
// moment the server is reachable from the internet.
//
// "Private addresses only" is deliberate: the gateway and the optional TLS
// proxy live on Docker's private network, so their word is trusted, while
// a header typed by a visitor is only believed up to the first public
// address Express meets reading right to left — a visitor can't invent
// their own identity to dodge the limit.
const TRUSTED_PROXIES = "loopback, linklocal, uniquelocal";

module.exports = { createRateLimiter, TRUSTED_PROXIES };
