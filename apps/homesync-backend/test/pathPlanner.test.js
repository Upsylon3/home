const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildPathSegments } = require("../src/pathPlanner");

test("builds category/year/month segments from a capture date", () => {
  const segments = buildPathSegments("Photos", "2026-08-14T10:30:00.000Z");
  assert.deepEqual(segments, ["Photos", "2026", "August"]);
});

test("falls back to today when capturedAt is missing or unparseable", () => {
  const withMissing = buildPathSegments("Videos", undefined);
  assert.equal(withMissing[0], "Videos");
  assert.equal(withMissing[1], String(new Date().getFullYear()));

  const withGarbage = buildPathSegments("Screenshots", "not-a-date");
  assert.equal(withGarbage[0], "Screenshots");
  assert.equal(withGarbage[1], String(new Date().getFullYear()));
});

test("works for every category the app can send", () => {
  for (const category of ["Photos", "Videos", "Screenshots", "Downloads"]) {
    const segments = buildPathSegments(category, "2025-01-05T00:00:00.000Z");
    assert.deepEqual(segments, [category, "2025", "January"]);
  }
});
