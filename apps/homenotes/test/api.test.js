import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, setToken, getToken } from '../src/api.js';

test('an in-flight save from an old session cannot clear a new login', async t => {
  const storage = new Map();
  const events = [];
  Object.defineProperty(globalThis, 'localStorage', { value: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key)
  }, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: { dispatchEvent: event => events.push(event.type) }, configurable: true });
  let finish;
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { finish = resolve; }));
  setToken('old-session');
  const saving = api.notes.update(1, { content: 'draft' });
  setToken('new-session');
  finish(new Response(JSON.stringify({ error: 'Session expired' }), { status: 401, headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(saving, /Session expired/);
  assert.equal(getToken(), 'new-session');
  assert.deepEqual(events, []);
});
