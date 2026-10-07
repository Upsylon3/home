// Every other test file disables rate limiting (see test/helpers/app.js)
// so it can exercise auth/share endpoints freely without tripping a limit
// meant for a real attacker, not a test harness. This file is the
// deliberate exception: it starts its own isolated app with rate limiting
// left ON, specifically to prove the limiter itself actually works.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient } = require("./helpers/client");

let baseUrl;

before(async () => {
  ({ baseUrl } = await startTestApp({ disableRateLimit: false }));
});

after(async () => {
  await stopTestApp();
});

test("the auth rate limiter blocks after too many requests from one IP, with a 429", async () => {
  const client = makeClient(baseUrl);

  // authLimiter allows 10 requests per 15-minute window (see auth.js) and
  // is shared across every route it's attached to — register included.
  const results = [];
  for (let i = 0; i < 12; i++) {
    // Deliberately invalid credentials: this test only cares about the
    // rate limiter kicking in, not about a specific auth outcome.
    // eslint-disable-next-line no-await-in-loop
    const res = await client.post("/api/auth/login", { username: "nobody", password: "wrong-password" });
    results.push(res.status);
  }

  assert.ok(results.slice(0, 10).every((s) => s === 401), "the first 10 requests should be normal 401s, not blocked");
  assert.ok(results.slice(10).every((s) => s === 429), "requests past the limit should be blocked with 429");
});

// Behind the gateway every request arrives from the gateway's own address,
// so the limiter has to read the real visitor from X-Forwarded-For — else
// one person's wrong guesses lock everybody out. In this test the "gateway"
// is just this machine (127.0.0.1), which is trusted, so a header on the
// request is believed the same way a real gateway's would be.
test("the limiter counts each real visitor separately when requests come through a proxy", async () => {
  const attempt = (forwardedFor) =>
    makeClient(baseUrl).post(
      "/api/auth/login",
      { username: "nobody", password: "wrong-password" },
      { headers: { "X-Forwarded-For": forwardedFor } }
    );

  for (let i = 0; i < 11; i++) await attempt("198.51.100.10"); // visitor A burns their allowance
  assert.equal((await attempt("198.51.100.10")).status, 429, "visitor A is blocked");
  assert.equal((await attempt("198.51.100.20")).status, 401, "visitor B is unaffected");
});

test("a visitor can't dodge the limiter by inventing a different address in X-Forwarded-For", async () => {
  const attempt = (forwardedFor) =>
    makeClient(baseUrl).post(
      "/api/auth/login",
      { username: "nobody", password: "wrong-password" },
      { headers: { "X-Forwarded-For": forwardedFor } }
    );

  // The real visitor is 203.0.113.7 — the proxy appends it LAST. Whatever
  // they typed before it is theirs to fake, and must not matter.
  for (let i = 0; i < 11; i++) await attempt(`10.99.99.${i}, 203.0.113.7`);
  assert.equal((await attempt("1.2.3.4, 203.0.113.7")).status, 429);
});
