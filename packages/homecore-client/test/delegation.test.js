const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const { createDelegationVerifier, requireDelegation } = require("../src/delegation");
const TOKEN = `hc_dg_${crypto.randomBytes(32).toString("base64url")}`;
const context = { audience: "homemonitor", action: "monitor.alerts.read" };
const principal = { kind: "delegation", subjectUserId: 1, grantId: crypto.randomUUID(), credentialId: crypto.randomUUID(),
  integrationId: "monitor-followup-v1", ...context, dailyCreateLimit: 20, expiresAt: "2099-01-01T00:00:00.000Z" };
async function upstream(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}
function send(res, value = { delegation: principal }) {
  res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(value));
}
test("delegation checks never cache or coalesce success and whitelist the separate principal", async t => {
  let calls = 0;
  const url = await upstream(t, (req, res) => {
    calls++; assert.equal(req.url, "/api/core/delegations/verify"); assert.equal(req.headers.authorization, `Bearer ${TOKEN}`);
    if (calls > 2) { res.writeHead(403); return res.end(); }
    send(res, { delegation: { ...principal, token: TOKEN, user: { role: "admin" } } });
  });
  const verify = createDelegationVerifier({ homecoreUrl: url });
  const results = await Promise.all([verify(TOKEN, context), verify(TOKEN, context)]);
  assert.equal(calls, 2); assert.deepEqual(results[0], principal); assert.ok(Object.isFrozen(results[0]));
  assert.equal(await verify(TOKEN, context), null);
  assert.equal(await verify("browser.jwt.token", context), null); assert.equal(calls, 3);
});
test("HTTP refusals and service failures remain distinct without leaking upstream details", async t => {
  for (const status of [401, 403, 429, 503, 500, 404]) {
    const url = await upstream(t, (_req, res) => { res.writeHead(status); res.end(TOKEN); });
    const check = createDelegationVerifier({ homecoreUrl: url })(TOKEN, context);
    if ([401, 403].includes(status)) assert.equal(await check, null);
    else await assert.rejects(check, e => e.status === ([429, 503].includes(status) ? 503 : 502) && !e.message.includes(TOKEN));
  }
});
test("malformed, oversized, expired and wrong-scope successful replies fail closed", async t => {
  for (const value of [null, {}, { delegation: { ...principal, subjectUserId: 1.5 } },
    { delegation: { ...principal, audience: "hometasks" } }, { delegation: { ...principal, action: "*" } },
    { delegation: { ...principal, grantId: "not-a-uuid" } }, { delegation: { ...principal, expiresAt: "2000-01-01" } },
    { delegation: { ...principal, dailyCreateLimit: 21 } }, { padding: "x".repeat(9000) }]) {
    const url = await upstream(t, (_req, res) => send(res, value));
    await assert.rejects(createDelegationVerifier({ homecoreUrl: url })(TOKEN, context), { status: 502 });
  }
  const url = await upstream(t, (_req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end("invalid JSON"); });
  await assert.rejects(createDelegationVerifier({ homecoreUrl: url })(TOKEN, context), { status: 502 });
});
test("redirects never forward credentials", async t => {
  let forwarded = 0;
  const target = await upstream(t, (_req, res) => { forwarded++; send(res); });
  const url = await upstream(t, (_req, res) => { res.writeHead(307, { Location: target }); res.end(); });
  await assert.rejects(createDelegationVerifier({ homecoreUrl: url })(TOKEN, context), { status: 502 });
  assert.equal(forwarded, 0);
});
test("deadlines cover response headers and bodies; pending admission recovers after timeout", async t => {
  for (const body of [false, true]) {
    let arrived;
    const arrival = new Promise(resolve => { arrived = resolve; });
    const url = await upstream(t, (_req, res) => {
      if (body) { res.writeHead(200, { "Content-Type": "application/json" }); res.write('{"delegation":'); }
      arrived();
    });
    const verify = createDelegationVerifier({ homecoreUrl: url, timeoutMs: 150, maxPendingRequests: 1 });
    const first = verify(TOKEN, context); const rejected = assert.rejects(first, { status: 504 });
    await arrival; await assert.rejects(verify(TOKEN, context), { status: 503 }); await rejected;
    await assert.rejects(verify(TOKEN, context), { status: 504 });
  }
});
test("fixed verifier configuration and middleware preserve the browser-session boundary", async () => {
  for (const options of [{ homecoreUrl: "https://example.test/path" }, { timeoutMs: -1 }, { maxPendingRequests: 0 }]) {
    assert.throws(() => createDelegationVerifier(options));
  }
  const req = { headers: { authorization: `Bearer ${TOKEN}` } };
  let next = 0;
  await requireDelegation({ ...context, verifier: async (token, scope) => {
    assert.equal(token, TOKEN); assert.deepEqual(scope, context); return principal;
  } })(req, {}, () => { next++; });
  assert.equal(next, 1); assert.deepEqual(req.delegation, principal);
  assert.equal(req.user, undefined); assert.equal(req.token, undefined);
});
