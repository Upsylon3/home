const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { fork } = require('node:child_process');
const { TOTP, Secret } = require('otpauth');
const { credentials } = require('../test-support/peer-tls.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-peer-api-'));
const children = [];
let tls, ca, a, b, adminA, adminB;
async function server(name, extra = {}) {
  const dataDir = fs.mkdtempSync(path.join(root, 'core-')), stateDir = fs.mkdtempSync(path.join(root, 'state-'));
  const child = fork(path.join(__dirname, '../test-support/peer-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, NODE_OPTIONS: '' }, windowsHide: true });
  const result = { child, logs: '' }; children.push(result);
  child.stdout.on('data', chunk => { result.logs += chunk; }); child.stderr.on('data', chunk => { result.logs += chunk; });
  result.origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Peer fixture startup timed out.')), 15000);
    child.once('message', message => { clearTimeout(timer); message.error ? reject(new Error(message.error)) : resolve(message.origin); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Peer fixture exited early.')); });
    child.send({ name, dataDir, stateDir, ...tls, ...extra });
  });
  result.request = (method, route, body, token, headers = {}, raw = false) => new Promise((resolve, reject) => {
    const url = new URL(result.origin), encoded = body === undefined ? null : Buffer.from(raw ? body : JSON.stringify(body));
    const request = https.request({ hostname: url.hostname, port: url.port, path: route, method, ca, agent: false,
      lookup: (_hostname, options, callback) => callback(null, options.all ? [{ address: '127.0.0.1', family: 4 }] : '127.0.0.1', 4),
      headers: { 'Content-Type': 'application/json', 'X-HOME-PEER-ADMIN': '1', Origin: result.origin,
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)), headers: response.headers }); }
        catch (error) { reject(error); }
      });
    });
    request.on('error', reject); request.end(encoded);
  });
  return result;
}
async function register(server, username = 'owner') {
  const password = 'Disposable-Password-Only';
  const result = await server.request('POST', '/api/core/auth/register', { username, password });
  assert.equal(result.status, 201);
  return { username, password, token: result.body.token };
}
const consent = (admin, extra = {}) => ({ password: admin.password, consent: true, ...extra });
before(async () => {
  tls = credentials(root); ca = fs.readFileSync(tls.cert);
  a = await server('a'); b = await server('b');
  adminA = await register(a); adminB = await register(b);
});
after(async () => {
  await Promise.all(children.map(f => new Promise(resolve => {
    if (f.child.exitCode !== null) return resolve();
    const timer = setTimeout(() => { f.child.kill(); resolve(); }, 5000);
    f.child.once('exit', () => { clearTimeout(timer); resolve(); }); f.child.send('stop');
  })));
  fs.rmSync(root, { recursive: true, force: true });
});

test('peer administration requires local admin session, fresh password, consent and same-origin header', async () => {
  assert.equal((await a.request('GET', '/api/core/peers')).status, 401);
  for (const token of ['hc_app_not-a-session', 'hc_dg_not-a-session', 'hc_guest_not-a-session']) {
    assert.equal((await a.request('GET', '/api/core/peers', undefined, token)).status, 401);
  }
  const user = await register(a, 'member');
  assert.equal((await a.request('GET', '/api/core/peers', undefined, user.token)).status, 403);
  assert.equal((await a.request('GET', '/api/core/peers', undefined, adminA.token, { 'X-HOME-PEER-ADMIN': '' })).status, 403);
  assert.equal((await a.request('POST', '/api/core/peers/offers', consent(adminA), adminA.token, { Origin: b.origin })).status, 403);
  assert.equal((await a.request('POST', '/api/core/peers/offers', consent(adminA, { password: 'wrong' }), adminA.token)).status, 403);
  assert.equal((await a.request('POST', '/api/core/peers/offers', consent(adminA, { consent: false }), adminA.token)).status, 400);
  assert.equal((await a.request('POST', '/api/core/peers/offers', consent(adminA), adminA.token, { 'X-Forwarded-Proto': 'http' })).status, 400);
});

test('real Core servers pair through verified TLS, require both local approvals and live-check revocation', async () => {
  const offer = await a.request('POST', '/api/core/peers/offers', consent(adminA), adminA.token);
  assert.equal(offer.status, 201);
  const stateA = await a.request('GET', '/api/core/peers', undefined, adminA.token);
  const accepted = await b.request('POST', '/api/core/peers/accept', consent(adminB, {
    invitation: offer.body.invitation, peerFingerprint: stateA.body.identity.keyId
  }), adminB.token);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.state, 'pending');
  const pairId = offer.body.pairId, stateB = await b.request('GET', '/api/core/peers', undefined, adminB.token);
  const approveA = consent(adminA, { transcriptFingerprint: accepted.body.transcriptFingerprint, peerFingerprint: stateB.body.identity.keyId });
  const approveB = consent(adminB, { transcriptFingerprint: accepted.body.transcriptFingerprint, peerFingerprint: stateA.body.identity.keyId });
  assert.equal((await a.request('POST', `/api/core/peers/${pairId}/approve`, approveA, adminA.token)).status, 502);
  assert.equal((await b.request('POST', `/api/core/peers/${pairId}/approve`, approveB, adminB.token)).status, 200);
  const completed = await a.request('POST', `/api/core/peers/${pairId}/approve`, approveA, adminA.token);
  assert.equal(completed.status, 200); assert.equal(completed.body.state, 'active');
  assert.equal(completed.body.effectiveActive, false);
  const live = await b.request('POST', `/api/core/peers/${pairId}/status`, consent(adminB), adminB.token);
  assert.equal(live.status, 200); assert.equal(live.body.effectiveActive, true);
  const refusedForeignLogin = await a.request('GET', '/api/core/users/me', undefined, offer.body.invitation.offer);
  assert.equal(refusedForeignLogin.status, 401);
  const revoked = await a.request('POST', `/api/core/peers/${pairId}/revoke`, consent(adminA), adminA.token);
  assert.equal(revoked.status, 200); assert.equal(revoked.body.state, 'revoked');
  const stopped = await b.request('POST', `/api/core/peers/${pairId}/status`, consent(adminB), adminB.token);
  assert.equal(stopped.status, 200); assert.equal(stopped.body.effectiveActive, false);
});

test('configured TOTP is required for owner approval even with an existing full session', async () => {
  const setup = await b.request('POST', '/api/core/auth/2fa/setup', {}, adminB.token);
  assert.equal(setup.status, 200);
  const totp = new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(setup.body.secret) });
  assert.equal((await b.request('POST', '/api/core/auth/2fa/confirm', { code: totp.generate() }, adminB.token)).status, 200);
  assert.equal((await b.request('POST', '/api/core/peers/offers', consent(adminB), adminB.token)).status, 403);
  const offered = await b.request('POST', '/api/core/peers/offers', consent(adminB, { totpCode: totp.generate() }), adminB.token);
  assert.equal(offered.status, 201);
});

test('malformed/duplicate/oversized bodies, query parameters and route confusion are bounded and never logged', async () => {
  assert.equal((await a.request('POST', '/federation/v1/status', '{"secret":"DO-NOT-LOG",', undefined, {}, true)).status, 400);
  assert.equal((await a.request('POST', '/federation/v1/status', '{"message":"one","message":"two"}', undefined, {}, true)).status, 400);
  assert.equal((await a.request('POST', '/federation/v1/status', { message: 'x'.repeat(33000) })).status, 413);
  assert.equal((await a.request('POST', '/federation/v1/status?target=localhost', { message: 'bad' })).status, 400);
  assert.equal((await a.request('POST', '/federation/v1/proxy', { message: 'bad' })).status, 404);
  assert.equal((await a.request('POST', '/federation/v1/activate', { message: 'bad' })).status, 400);
  assert.ok(children.every(f => !f.logs.includes('DO-NOT-LOG')));
});

test('disabled or missing protected state never prevents local login and never initializes protocol keys', async () => {
  for (const extra of [{ enabled: false }, { missingState: true }]) {
    const isolated = await server('a', extra), owner = await register(isolated);
    assert.equal((await isolated.request('GET', '/api/core/users/me', undefined, owner.token)).status, 200);
    assert.equal((await isolated.request('GET', '/api/core/peers', undefined, owner.token)).status, extra.enabled === false ? 404 : 503);
    assert.equal((await isolated.request('POST', '/federation/v1/status', { message: 'not-a-session' })).status, extra.enabled === false ? 404 : 503);
  }
});

test('an unfinished incoming peer body is closed within the absolute request deadline without logging it', async () => {
  const url = new URL(a.origin);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { request.destroy(); reject(new Error('Incoming peer body exceeded deadline.')); }, 10000);
    const request = https.request({ hostname: url.hostname, port: url.port, path: '/federation/v1/status', method: 'POST', ca, agent: false,
      lookup: (_host, options, callback) => callback(null, options.all ? [{ address: '127.0.0.1', family: 4 }] : '127.0.0.1', 4),
      headers: { 'Content-Type': 'application/json', 'Content-Length': '9999' }
    }, response => {
      assert.equal(response.statusCode, 504); response.resume();
      response.once('close', () => { clearTimeout(timer); resolve(); });
    });
    request.on('error', error => {
      clearTimeout(timer);
      if (error.code === 'ECONNRESET') resolve(); else reject(error);
    });
    request.write('{"message":"SLOW-BODY-CANARY');
  });
  assert.equal((await a.request('GET', '/api/core/peers', undefined, adminA.token)).status, 200);
  assert.ok(children.every(f => !f.logs.includes('SLOW-BODY-CANARY')));
});
