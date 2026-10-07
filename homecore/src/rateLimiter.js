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
