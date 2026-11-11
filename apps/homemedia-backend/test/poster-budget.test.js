const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPosterBudget, reservePosterRead, POSTER_BYTES, POSTER_TTL_MS } = require('../src/posterBudget');

test('poster range reservations cap open-ended reads and share a finite ticket budget', () => {
  const budget = createPosterBudget(100);
  let total = 0;
  for (let index = 0; index < 8; index++) {
    const read = reservePosterRead(budget, `bytes=${index * 2_097_152}-`, 101);
    assert.equal(read.bytes, 2_097_152); total += read.bytes;
  }
  assert.equal(total, POSTER_BYTES);
  assert.throws(() => reservePosterRead(budget, 'bytes=0-', 102), { status: 410 });
});

test('poster tickets never extend their deadline and reject ambiguous ranges without charging them', () => {
  const budget = createPosterBudget(100);
  for (const header of ['bytes=-10', 'bytes=2-1', 'bytes=0-1,3-4', 'bytes=9007199254740992-']) {
    assert.throws(() => reservePosterRead(budget, header, 101), { status: 416 });
  }
  assert.equal(budget.requests, 8);
  assert.deepEqual(reservePosterRead(budget, 'bytes=40-49', 101), { range: 'bytes=40-49', bytes: 10 });
  assert.equal(budget.expiresAt, 100 + POSTER_TTL_MS);
  assert.throws(() => reservePosterRead(budget, undefined, budget.expiresAt), { status: 410 });
});
