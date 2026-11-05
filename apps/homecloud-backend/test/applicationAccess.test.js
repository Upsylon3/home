const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { startTestApp, stopTestApp } = require('./helpers/app');
const { registerUser, makeClient } = require('../../../homecore/test/helpers/client');
let context, owner, other;
before(async () => {
  context = await startTestApp();
  owner = await registerUser(context.homecore.baseUrl);
  other = await registerUser(context.homecore.baseUrl);
});
after(stopTestApp);
async function issue(permissions, account = owner, applicationSlug = 'homecloud') {
  const result = await account.client.post('/api/core/application-access', { applicationSlug, permissions, consent: true });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}
async function request(method, route, token, body, cloud = true) {
  return fetch((cloud ? context.baseUrl : context.homecore.baseUrl) + route, { method,
    headers: { Authorization: 'Bearer ' + token, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) });
}
async function revoke(key, account = owner) { assert.equal((await account.client.delete('/api/core/application-access/' + key.access.id)).status, 204); }
test('explicit consent, supported scopes, app declarations and full sign-in are mandatory', async () => {
  for (const body of [{}, { applicationSlug: 'homecloud', permissions: ['files.read'], consent: false },
    { applicationSlug: 'homecloud', permissions: ['files.read'], consent: true, userId: other.user.id }]) {
    assert.equal((await owner.client.post('/api/core/application-access', body)).status, 400);
  }
  for (const permissions of [[], ['*'], ['users.manage'], ['files.read', 'files.read']]) {
    assert.equal((await owner.client.post('/api/core/application-access', { applicationSlug: 'homecloud', permissions, consent: true })).status, 400);
  }
  assert.equal((await owner.client.post('/api/core/application-access', { applicationSlug: 'homenotes', permissions: ['files.delete'], consent: true })).status, 403);
  assert.equal((await makeClient(context.homecore.baseUrl).get('/api/core/application-access')).status, 401);
});
test('read-only key restores file bytes, filters owners and cannot write, share, manage accounts or mint credentials', async () => {
  const form = new FormData(); form.append('file', new Blob(['owned exact bytes']), 'owned.txt');
  const upload = await request('POST', '/api/homecloud/files/upload', owner.token, form);
  assert.equal(upload.status, 201);
  const file = (await upload.json()).file;
  const stranger = new FormData(); stranger.append('file', new Blob(['foreign']), 'foreign.txt');
  const foreign = (await (await request('POST', '/api/homecloud/files/upload', other.token, stranger)).json()).file;
  const key = await issue(['files.read']);
  assert.match(key.token, /^hc_app_[A-Za-z0-9_-]{43}$/);
  assert.equal((await request('GET', `/api/homecloud/files/${file.id}/download`, key.token)).status, 200);
  assert.equal(await (await request('GET', `/api/homecloud/files/${file.id}/download`, key.token)).text(), 'owned exact bytes');
  assert.equal((await request('GET', `/api/homecloud/files/${foreign.id}/download`, key.token)).status, 404);
  const listed = await (await request('GET', '/api/homecloud/files', key.token)).json();
  assert.ok(listed.files.some(item => item.id === file.id));
  assert.ok(!listed.files.some(item => item.id === foreign.id));
  for (const [method, route] of [['POST', '/files/upload'], ['POST', '/files/download-batch-no-such-route'],
    ['POST', `/files/${file.id}/move`], ['DELETE', `/files/${file.id}`], ['DELETE', `/files/${file.id}/permanent`],
    ['POST', `/files/${file.id}/restore`], ['GET', '/files/shares'], ['POST', `/files/${file.id}/share`],
    ['POST', '/folders'], ['PATCH', '/folders/1'], ['POST', '/folders/1/move'], ['DELETE', '/folders/1']]) {
    const response = await request(method, '/api/homecloud' + route, key.token, method === 'POST' || method === 'PATCH' ? {} : undefined);
    assert.equal(response.status, route.endsWith('no-such-route') ? 404 : 403, route);
  }
  for (const route of ['/api/auth/me', '/api/core/users/me', '/api/core/admin/users', '/api/core/application-access']) {
    assert.equal((await request('GET', route, key.token, undefined, false)).status, 401, route);
  }
  assert.equal((await request('POST', '/api/core/application-access', key.token, { applicationSlug: 'homecloud', permissions: ['files.delete'], consent: true }, false)).status, 401);
  assert.equal((await owner.client.post('/api/core/application-access', { applicationSlug: 'homecloud', permissions: ['files.read'], consent: true })).status, 409);
  const rows = await owner.client.get('/api/core/application-access');
  assert.ok(!JSON.stringify(rows.body).includes(key.token));
  assert.ok(!JSON.stringify(context.homecore.db.prepare('SELECT * FROM hc_application_access').all()).includes(key.token));
  assert.equal((await other.client.delete('/api/core/application-access/' + key.access.id)).status, 404);
  await revoke(key);
  assert.equal((await request('GET', '/api/homecloud/files', key.token)).status, 403);
});
test('write, delete and share permissions are independent and ownership is still enforced', async () => {
  const write = await issue(['files.write']);
  assert.equal((await request('GET', '/api/homecloud/files', write.token)).status, 403);
  const form = new FormData(); form.append('file', new Blob(['new bytes']), 'write-only.txt');
  const uploaded = await request('POST', '/api/homecloud/files/upload', write.token, form);
  assert.equal(uploaded.status, 201);
  const file = (await uploaded.json()).file;
  assert.equal((await request('DELETE', `/api/homecloud/files/${file.id}`, write.token)).status, 403);
  await revoke(write);
  const share = await issue(['files.share']);
  assert.equal((await request('POST', `/api/homecloud/files/${file.id}/share`, share.token, {})).status, 201);
  assert.equal((await request('GET', '/api/homecloud/files/shares', share.token)).status, 200);
  assert.equal((await request('GET', `/api/homecloud/files/${file.id}/download`, share.token)).status, 403);
  await revoke(share);
  const deletion = await issue(['files.delete']);
  assert.equal((await request('DELETE', `/api/homecloud/files/${file.id}`, deletion.token)).status, 200);
  assert.equal((await request('GET', '/api/homecloud/files', deletion.token)).status, 403);
  await revoke(deletion);
});
test('disable/re-enable, manifest changes, session epochs, expiry and offline restore cannot revive access', async () => {
  for (const operation of ['disable', 'permissions', 'epoch', 'expiry', 'restore']) {
    const key = await issue(['files.read'], other, 'homenotes');
    assert.equal((await request('GET', '/api/homecloud/files', key.token)).status, 200);
    if (operation === 'disable') {
      assert.equal((await owner.client.patch('/api/core/apps/homenotes', { enabled: false })).status, 200);
      assert.equal((await owner.client.patch('/api/core/apps/homenotes', { enabled: true })).status, 200);
    } else if (operation === 'permissions') {
      assert.equal((await owner.client.patch('/api/core/apps/homenotes', { permissions: ['files.read'] })).status, 200);
      assert.equal((await other.client.post('/api/core/application-access', { applicationSlug: 'homenotes', permissions: ['files.write'], consent: true })).status, 403);
    } else if (operation === 'epoch') {
      context.homecore.db.prepare('UPDATE users SET token_version=token_version+1 WHERE id=?').run(other.user.id);
    } else if (operation === 'expiry') {
      context.homecore.db.prepare('UPDATE hc_application_access SET expires_at=0 WHERE id=?').run(key.access.id);
    } else {
      const result = spawnSync(process.execPath, [path.resolve('../../homecore/scripts/revoke-restored-delegations.js'),
        '--database', path.join(context.homecore.dataDir, 'homecore.db'), '--confirm-offline-restore'], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(JSON.parse(result.stdout).revoked >= 1);
    }
    assert.equal((await request('GET', '/api/homecloud/files', key.token)).status, 403, operation);
    // Refresh the full login after the epoch invalidation.
    if (operation === 'epoch') {
      const login = await other.client.post('/api/auth/login', { username: other.username, password: other.password });
      other.token = login.body.token; other.client.setToken(other.token);
    }
    const row = context.homecore.db.prepare('SELECT id FROM hc_application_access WHERE id=?').get(key.access.id);
    assert.ok(row);
    await revoke(key, other);
  }
});
test('a caller-supplied app identity header never grants authority', async () => {
  const response = await fetch(context.baseUrl + '/api/homecloud/files', { headers: { 'X-Application-Id': 'homecloud', 'X-Permissions': 'files.read' } });
  assert.equal(response.status, 401);
});

test('uninstall and reinstall require fresh consent and never revive the old key', async () => {
  const key = await issue(['files.read'], owner, 'homenotes');
  assert.equal((await owner.client.delete('/api/core/apps/homenotes')).status, 200);
  assert.equal((await owner.client.post('/api/core/apps/homenotes/install', {})).status, 201);
  assert.equal((await owner.client.patch('/api/core/apps/homenotes', { enabled: true })).status, 200);
  assert.equal((await request('GET', '/api/homecloud/files', key.token)).status, 403);
  const next = await issue(['files.read'], owner, 'homenotes');
  assert.notEqual(next.token, key.token);
  await revoke(next);
});

test('application uploads respect live per-user quota overrides', async () => {
  const key = await issue(['files.read', 'files.write'], other);
  context.homecore.db.prepare('UPDATE users SET quota_override=8 WHERE id=?').run(other.user.id);
  const quota = await (await request('GET', '/api/homecloud/files/quota', key.token)).json();
  assert.equal(quota.quotaBytes, 8);
  const count = context.db.prepare('SELECT COUNT(*) AS n FROM files WHERE user_id=?').get(other.user.id).n;
  const form = new FormData(); form.append('file', new Blob(['x'.repeat(100)]), 'over-quota.txt');
  const response = await request('POST', '/api/homecloud/files/upload', key.token, form);
  assert.equal(response.status, 413);
  assert.equal(context.db.prepare('SELECT COUNT(*) AS n FROM files WHERE user_id=?').get(other.user.id).n, count);
  context.homecore.db.prepare('UPDATE users SET quota_override=NULL WHERE id=?').run(other.user.id);
  await revoke(key, other);
});

test('audit failure rolls app disable and key revocation back together', async () => {
  const key = await issue(['files.read'], owner, 'homenotes');
  context.homecore.db.exec(`CREATE TRIGGER refuse_access_audit BEFORE INSERT ON hc_activity_events
    WHEN NEW.event_type='homecore.application_access.revoked' BEGIN SELECT RAISE(ABORT, 'disposable audit failure'); END`);
  try {
    assert.equal((await owner.client.patch('/api/core/apps/homenotes', { enabled: false })).status, 500);
    assert.equal((await request('GET', '/api/homecloud/files', key.token)).status, 200);
    assert.equal((await owner.client.get('/api/core/apps/homenotes')).body.application.enabled, true);
  } finally { context.homecore.db.exec('DROP TRIGGER refuse_access_audit'); }
  await revoke(key);
});
