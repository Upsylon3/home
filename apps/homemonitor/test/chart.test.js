import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSegments } from "../src/chart.js";

const area = { width: 100, height: 50, padding: 0 };

test("a rising series goes from bottom-left to top-right (bigger values are HIGHER)", () => {
  const [segment] = buildSegments([{ x: 0, y: 0 }, { x: 1, y: 5 }, { x: 2, y: 10 }], area);
  assert.deepEqual(segment, [[0, 50], [50, 25], [100, 0]]);
});

test("an explicit domain fixes the scale (50 on a 0-100 scale sits mid-height)", () => {
  const [segment] = buildSegments([{ x: 0, y: 50 }, { x: 1, y: 50 }], { ...area, domain: [0, 100] });
  assert.deepEqual(segment, [[0, 25], [100, 25]]);
});

test("a missing reading BREAKS the line instead of drawing across the gap", () => {
  const segments = buildSegments([{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: null }, { x: 3, y: 3 }, { x: 4, y: 4 }], area);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].length, 2);
  assert.equal(segments[1].length, 2);
});

test("points are placed by their x value, so uneven gaps in time show as gaps", () => {
  const [segment] = buildSegments([{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 10, y: 1 }], { ...area, domain: [0, 2] });
  assert.deepEqual(segment.map(([px]) => px), [0, 10, 100]);
});

test("a flat line doesn't divide by zero; it sits in the middle", () => {
  const [segment] = buildSegments([{ x: 0, y: 7 }, { x: 1, y: 7 }], area);
  assert.deepEqual(segment.map(([, py]) => py), [25, 25]);
});

test("a single point is centred; no data at all gives no segments", () => {
  assert.deepEqual(buildSegments([{ x: 5, y: 3 }], area)[0][0][0], 50);
  assert.deepEqual(buildSegments([], area), []);
  assert.deepEqual(buildSegments([{ x: 0, y: null }], area), []);
});

test("values outside the domain are clamped to the edge", () => {
  const [segment] = buildSegments([{ x: 0, y: 150 }, { x: 1, y: -20 }], { ...area, domain: [0, 100] });
  assert.deepEqual(segment.map(([, py]) => py), [0, 50]);
});
