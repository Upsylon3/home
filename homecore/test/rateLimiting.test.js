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
