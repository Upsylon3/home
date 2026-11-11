import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPosterCache } from '../src/videoPosters.js';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const file = id => ({ id, size: 100, createdAt: 'fixture', mimetype: 'video/webm' });

test('poster jobs share same-source work, bound concurrency and retain a bounded cache', async () => {
  let active = 0, peak = 0, calls = 0;
  const release = [], revoked = [];
  const cache = createPosterCache({ session: () => 'fixture', revoke: value => revoked.push(value), maxEntries: 2, maxBytes: 20,
    decode: async item => { calls++; active++; peak = Math.max(peak, active); await new Promise(resolve => release.push(resolve)); active--; return { url: `blob:${item.id}`, bytes: 10 }; } });
  const a = cache.get(file(1));
  assert.equal(cache.get(file(1)), a);
  const b = cache.get(file(2)), c = cache.get(file(3));
  await tick(); assert.equal(calls, 2);
  release.shift()(); release.shift()(); await tick(); release.shift()();
  assert.deepEqual(await Promise.all([a, b, c]), ['blob:1', 'blob:2', 'blob:3']); await tick();
  assert.equal(peak, 2); assert.ok(revoked.includes('blob:1'));
  assert.equal(await cache.get(file(3)), 'blob:3'); assert.equal(calls, 3);
  cache.clear(); assert.equal(revoked.length, 3);
});

test('session changes cancel queued/running jobs and cannot adopt an old decoded result', async () => {
  let identity = 'a', complete;
  const revoked = [];
  const cache = createPosterCache({ session: () => identity, revoke: value => revoked.push(value), concurrency: 1, queueLimit: 1,
    decode: async item => { if (item.id === 1) await new Promise(resolve => { complete = resolve; }); return { url: `blob:${item.id}`, bytes: 10 }; } });
  const first = cache.get(file(1)), queued = cache.get(file(2));
  const firstDenied = assert.rejects(first, /Session changed/), queuedDenied = assert.rejects(queued, /cancelled/);
  await assert.rejects(cache.get(file(3)), /queue is full/);
  await tick(); identity = 'b'; const replacement = cache.get(file(4)); complete();
  await Promise.all([firstDenied, queuedDenied]); assert.equal(await replacement, 'blob:4');
  assert.ok(revoked.includes('blob:1')); cache.clear();
});

test('unsupported videos use a negative cache and changed source metadata triggers a new decode', async () => {
  let calls = 0;
  const cache = createPosterCache({ session: () => 'fixture', revoke: () => {}, decode: async () => { calls++; throw new Error('Unsupported video'); } });
  await assert.rejects(cache.get(file(1)), /Unsupported/);
  await tick(); await assert.rejects(cache.get(file(1)), /Unsupported/); assert.equal(calls, 1);
  await assert.rejects(cache.get({ ...file(1), size: 200 }), /Unsupported/); assert.equal(calls, 2); cache.clear();
});
