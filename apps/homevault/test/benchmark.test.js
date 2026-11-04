import { test } from "node:test";
import assert from "node:assert/strict";
import { measureKdf, summarize, STEADY_SAMPLES } from "../src/benchmark/measure.js";
import { DEFAULT_KDF_PARAMS } from "../src/crypto.js";

test("summary handles outliers and ordering without mutating samples", () => {
  const samples = [1000, 2, 4, 3, 1];
  assert.deepEqual(summarize(samples), { minMs: 1, medianMs: 3, maxMs: 1000 });
  assert.deepEqual(samples, [1000, 2, 4, 3, 1]);
  assert.equal(summarize([4, 2]).medianMs, 3);
  for (const invalid of [[], [NaN], [Infinity], [0], [-1], ["2"]]) assert.throws(() => summarize(invalid));
});

test("real production KDF benchmark reports only timings and public parameters", async () => {
  const progress = [];
  const result = await measureKdf({ onProgress: update => progress.push(update) });
  assert.deepEqual(result.kdfParams, DEFAULT_KDF_PARAMS);
  assert.equal(result.steadyMs.length, STEADY_SAMPLES);
  assert.deepEqual(result.summary, summarize(result.steadyMs));
  assert.ok(result.firstDerivationMs > 0);
  assert.equal(progress.at(-1).completed, STEADY_SAMPLES + 1);
  assert.deepEqual(Object.keys(result).sort(), ["schema", "algorithm", "implementation", "execution", "kdfParams", "saltBytes", "derivedKeyBytes", "measuredAt", "firstDerivationMs", "steadyMs", "summary"].sort());
});

test("cancellation and hidden pages discard partial measurements", async () => {
  const controller = new AbortController();
  let count = 0;
  await assert.rejects(measureKdf({ signal: controller.signal, onProgress: () => { count++; controller.abort(); } }), { name: "AbortError" });
  assert.equal(count, 1);
  let visible = true;
  await assert.rejects(measureKdf({ isVisible: () => visible, onProgress: () => { visible = false; } }), /page was hidden/);
  await assert.rejects(measureKdf({ isVisible: () => false }), /page was hidden/);
});
