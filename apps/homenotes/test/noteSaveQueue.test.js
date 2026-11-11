import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNoteSaveQueue } from '../src/noteSaveQueue.js';

function fixture(update = async fields => fields) {
  const states = [], saved = [];
  const queue = createNoteSaveQueue({ update, onSaved: note => saved.push(note), onState: (state, error) => states.push({ state, error }) });
  return { queue, states, saved };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('pending text/tags merge, and navigation flushes before the debounce', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const { queue, states } = fixture(async fields => { calls.push(fields); return fields; });
  queue.edit({ title: 'new title', content: 'first' });
  queue.edit({ content: 'latest', tags: ['private'] });
  assert.equal(queue.hasUnsaved(), true);
  assert.equal(states.at(-1).state, 'pending');
  assert.equal(await queue.flush(), true);
  t.mock.timers.tick(2000);
  assert.deepEqual(calls, [{ title: 'new title', content: 'latest', tags: ['private'] }]);
  assert.equal(queue.hasUnsaved(), false);
  assert.equal(states.at(-1).state, 'saved');
});

test('in-flight saves serialize subsequent edits without a false saved state', async () => {
  const first = deferred(), second = deferred(), calls = [];
  const { queue, states } = fixture(fields => { calls.push(fields); return calls.length === 1 ? first.promise : second.promise; });
  queue.edit({ content: 'first' });
  const pending = queue.flush();
  queue.edit({ content: 'second' });
  assert.equal(queue.flush(), pending);
  assert.equal(calls.length, 1);
  first.resolve({ content: 'first' });
  await Promise.resolve();
  assert.deepEqual(calls, [{ content: 'first' }, { content: 'second' }]);
  assert.equal(queue.hasUnsaved(), true);
  assert.equal(states.some(s => s.state === 'saved'), false);
  second.resolve({ content: 'second' });
  assert.equal(await pending, true);
  assert.equal(queue.hasUnsaved(), false);
  queue.dispose();
});

test('failure retains every rejected field; newer changes win on explicit retry', async () => {
  const first = deferred(), calls = [];
  const { queue, states } = fixture(fields => {
    calls.push(fields);
    return calls.length === 1 ? first.promise : Promise.resolve(fields);
  });
  queue.edit({ title: 'old', content: 'body', tags: ['old'] });
  const pending = queue.flush();
  queue.edit({ title: 'new', tags: ['new'] });
  first.reject(new Error('Offline'));
  assert.equal(await pending, false);
  assert.equal(queue.hasUnsaved(), true);
  assert.deepEqual(states.at(-1), { state: 'error', error: 'Offline' });
  assert.equal(await queue.flush(), true);
  assert.deepEqual(calls[1], { title: 'new', content: 'body', tags: ['new'] });
  queue.dispose();
});

test('explicit discard/logout cancels pending work and ignores late callbacks', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const inFlight = deferred();
  let count = 0;
  const { queue, saved } = fixture(() => { count++; return inFlight.promise; });
  queue.edit({ content: 'pending' });
  queue.dispose();
  t.mock.timers.tick(2000);
  assert.equal(count, 0);
  // React StrictMode mounts effects again after an initial cleanup.
  queue.resume();
  queue.edit({ content: 'active' });
  const pending = queue.flush();
  queue.dispose();
  inFlight.resolve({ content: 'active' });
  assert.equal(await pending, false);
  assert.deepEqual(saved, []);
});
