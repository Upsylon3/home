import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, getToken, setToken } from '../src/api.js';

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key)
};
const events = [];
globalThis.window = { dispatchEvent: event => events.push(event.type) };
afterEach(() => { storage.clear(); events.length = 0; });
const response = (status, body = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' }
});

for (const [name, operation] of [
  ['password change', () => api.changePassword('wrong', 'new-password')],
  ['TOTP confirmation', () => api.twoFactor.confirm('000000')],
  ['TOTP disable', () => api.twoFactor.disable('wrong')],
  ['recovery rotation', () => api.twoFactor.regenerate('wrong')]
]) {
  test(`${name}: bad proof preserves a valid session; revoked session expires`, async t => {
    for (const status of [200, 401, 503]) {
      setToken('original');
      events.length = 0;
      const calls = [];
      t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push({ url, options });
        return calls.length === 1 ? response(401, { error: 'Bad proof' }) : response(status);
      });
      await assert.rejects(operation, /Bad proof/);
      assert.equal(calls[1].url, '/api/auth/me');
      assert.equal(calls[1].options.headers.Authorization, 'Bearer original');
      assert.equal('keepSessionOn401' in calls[0].options, false);
      assert.equal(getToken(), status === 401 ? null : 'original');
      assert.deepEqual(events, status === 401 ? ['home:session-expired'] : []);
      t.mock.restoreAll();
    }
  });
}

test('an unavailable session check preserves the session for retry', async t => {
  setToken('original');
  t.mock.method(globalThis, 'fetch', async url => {
    if (url === '/api/auth/me') throw new TypeError('Offline');
    return response(401, { error: 'Bad proof' });
  });
  await assert.rejects(api.twoFactor.confirm('000000'), /Bad proof/);
  assert.equal(getToken(), 'original');
  assert.deepEqual(events, []);
});

test('ordinary unauthorized calls expire the shared session', async t => {
  setToken('original');
  t.mock.method(globalThis, 'fetch', async () => response(401));
  await assert.rejects(api.me());
  assert.equal(getToken(), null);
  assert.deepEqual(events, ['home:session-expired']);
});

test('a late unauthorized response cannot sign out a newer session', async t => {
  setToken('original');
  let finish;
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { finish = resolve; }));
  const pending = api.me();
  setToken('renewed');
  finish(response(401));
  await assert.rejects(pending);
  assert.equal(getToken(), 'renewed');
  assert.deepEqual(events, []);
});

test('Core error envelopes and admin payloads remain compatible', async t => {
  setToken('original');
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/admin/users/12/quota');
    assert.deepEqual(JSON.parse(options.body), { quotaBytes: null });
    assert.equal(options.headers.Authorization, 'Bearer original');
    return response(403, { error: { code: 'FORBIDDEN', message: 'Admin required' } });
  });
  await assert.rejects(api.accountAdmin.setQuota(12, null), { message: 'Admin required', code: 'FORBIDDEN' });
  assert.equal(getToken(), 'original');
});
