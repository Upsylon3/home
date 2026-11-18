import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, getToken, setToken, fetchImageBlob, uploadMedia } from '../src/api.js';

const app = import.meta.url.split('/').at(-3);
function fixture(t) {
  const events = [], storage = new Map();
  const originals = new Map(['localStorage', 'window'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key)
  } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent: event => events.push(event.type) } });
  t.after(() => { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  return events;
}
const refusal = status => new Response('{"error":"Fixture refusal"}', { status, headers: { 'Content-Type': 'application/json' } });

test('a delayed old-session 401 rejects that request without clearing the replacement login', async t => {
  const events = fixture(t);
  let finish, authorization;
  t.mock.method(globalThis, 'fetch', (_url, options) => {
    authorization = options.headers.Authorization;
    return new Promise(resolve => { finish = resolve; });
  });
  setToken('old-test-session');
  const pending = api.me();
  setToken('replacement-test-session');
  finish(refusal(401));
  await assert.rejects(pending, /Fixture refusal/);
  assert.equal(authorization, 'Bearer old-test-session');
  assert.equal(getToken(), 'replacement-test-session');
  assert.deepEqual(events, []);
});

for (const status of [401, 403]) test(`current-session ${status} preserves the correct expiry behavior`, async t => {
  const events = fixture(t);
  t.mock.method(globalThis, 'fetch', async () => refusal(status));
  setToken('current-test-session');
  await assert.rejects(api.me(), /Fixture refusal/);
  assert.equal(getToken(), status === 401 ? null : 'current-test-session');
  assert.deepEqual(events, status === 401 ? [`${app}:session-expired`] : []);
});

for (const replaced of [false, true]) test(`image 401 respects session replacement: ${replaced}`, async t => {
  const events = fixture(t);
  let finish;
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { finish = resolve; }));
  setToken('image-test-session');
  const pending = fetchImageBlob('/fixture/thumbnail');
  if (replaced) setToken('replacement-test-session');
  finish(refusal(401));
  await assert.rejects(pending, /401/);
  assert.equal(getToken(), replaced ? 'replacement-test-session' : null);
  assert.deepEqual(events, replaced ? [] : ['homemedia:session-expired']);
});

for (const replaced of [false, true]) test(`XHR upload 401 respects session replacement: ${replaced}`, async t => {
  const events = fixture(t);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
  let xhr;
  class Upload {
    upload = {};
    constructor() { xhr = this; }
    open() {}
    setRequestHeader(name, value) { if (name === 'Authorization') this.authorization = value; }
    send() {}
  }
  Object.defineProperty(globalThis, 'XMLHttpRequest', { configurable: true, value: Upload });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'XMLHttpRequest', original); else delete globalThis.XMLHttpRequest; });
  setToken('upload-test-session');
  const pending = uploadMedia(new File(['fixture'], 'proof.mp4'), null);
  if (replaced) setToken('replacement-test-session');
  xhr.status = 401; xhr.responseText = '{"error":"Fixture refusal"}'; xhr.onload();
  await assert.rejects(pending, /Fixture refusal/);
  assert.equal(xhr.authorization, 'Bearer upload-test-session');
  assert.equal(getToken(), replaced ? 'replacement-test-session' : null);
  assert.deepEqual(events, replaced ? [] : ['homemedia:session-expired']);
});
