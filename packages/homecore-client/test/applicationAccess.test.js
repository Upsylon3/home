const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { createApplicationVerifier, requirePermission } = require('../src/applicationAccess');
const { requireAuth } = require('../src/middleware');
const { createVerifier } = require('../src/verify');
const token = 'hc_app_' + crypto.randomBytes(32).toString('base64url');
const context = { audience: 'homecloud', permission: 'files.read' };
const application = { kind: 'application', id: crypto.randomUUID(), applicationSlug: 'homenotes', ...context,
  expiresAt: '2099-01-01T00:00:00.000Z', user: { id: 1, username: 'fixture', role: 'user', quotaOverride: null } };
async function upstream(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}
const send = (res, value) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
test('application permission verification is live, bounded and whitelists a separate unprivileged principal', async t => {
  let calls = 0;
  const homecoreUrl = await upstream(t, (req, res) => {
    calls++; assert.equal(req.url, '/api/core/application-access/verify');
    if (calls > 2) { res.writeHead(403); res.end(); }
    else send(res, { application: { ...application, token, administrator: true } });
  });
  const verify = createApplicationVerifier({ homecoreUrl });
  const results = await Promise.all([verify(token, context), verify(token, context)]);
  assert.equal(calls, 2); assert.deepEqual(results[0], application);
  assert.equal(await verify(token, context), null);
  assert.equal(await verify('session.jwt.token', context), null);
});
test('malformed, oversized, expired, wrong audience and elevated role replies fail closed', async t => {
  for (const value of [{}, { padding: 'x'.repeat(9000) },
    ...[{ audience: 'homevault' }, { permission: 'files.delete' }, { expiresAt: '2000-01-01' },
      { user: { id: 1, username: 'fixture', role: 'admin' } }, { user: { id: -1, username: 'fixture', role: 'user' } }]
      .map(change => ({ application: { ...application, ...change } }))]) {
    const homecoreUrl = await upstream(t, (_req, res) => send(res, value));
    await assert.rejects(createApplicationVerifier({ homecoreUrl })(token, context), { status: 502 });
  }
});
test('outages, deadlines and capacity remain retryable; redirects never receive a credential', async t => {
  let forwarded = 0;
  const target = await upstream(t, (_req, res) => { forwarded++; send(res, { application }); });
  const redirect = await upstream(t, (_req, res) => { res.writeHead(307, { Location: target }); res.end(); });
  await assert.rejects(createApplicationVerifier({ homecoreUrl: redirect })(token, context), { status: 502 });
  assert.equal(forwarded, 0);
  const down = await upstream(t, (_req, res) => { res.writeHead(503); res.end('private upstream body'); });
  await assert.rejects(createApplicationVerifier({ homecoreUrl: down })(token, context), error => error.status === 503 && !error.message.includes('private'));
  let arrived;
  const waiting = new Promise(resolve => { arrived = resolve; });
  const stalled = await upstream(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{'); arrived(); });
  const verify = createApplicationVerifier({ homecoreUrl: stalled, timeoutMs: 200, maxPendingRequests: 1 });
  const deadline = assert.rejects(verify(token, context), { status: 504 });
  await waiting;
  await assert.rejects(verify(token, context), { status: 503 });
  await deadline;
});
test('session-only middleware and verifier refuse application credentials and unverified route context', async () => {
  let called = false, status;
  const req = { headers: { authorization: 'Bearer ' + token } };
  const res = { status(value) { status = value; return this; }, json() {} };
  await requireAuth(req, res, () => { called = true; });
  assert.equal(status, 403); assert.equal(called, false); assert.equal(req.user, undefined);
  assert.equal(await createVerifier()(token), null);
  assert.throws(() => requirePermission('*'));
});
