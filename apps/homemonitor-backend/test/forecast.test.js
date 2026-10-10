const { test } = require("node:test");
const assert = require("node:assert/strict");
const { forecastFull } = require("../src/forecast");

const GB = 1e9;
const points = (usedList, total = 100 * GB, start = Date.UTC(2026, 9, 1)) =>
  usedList.map((used, i) => ({ day: new Date(start + i * 86_400_000).toISOString().slice(0, 10), usedBytes: used * GB, totalBytes: total }));

test("steady growth gives days until full", () => {
  // +1 GB a day, 50 GB used of 100 now => about 50 days left.
  const result = forecastFull(points([46, 47, 48, 49, 50]));
  assert.equal(result.daysUntilFull, 50);
  assert.ok(Math.abs(result.bytesPerDay - GB) < 1);
});

test("no forecast without enough history, or when the disk is flat or shrinking", () => {
  assert.equal(forecastFull(points([10, 11])), null); // under 3 points
  assert.equal(forecastFull(points([50, 50, 50, 50])), null); // flat
  assert.equal(forecastFull(points([60, 55, 50, 45])), null); // shrinking
});

test("needs at least two days of spread, even with 3 points", () => {
  const samples = [
    { day: "2026-10-01", usedBytes: 10 * GB, totalBytes: 100 * GB },
    { day: "2026-10-01", usedBytes: 11 * GB, totalBytes: 100 * GB },
    { day: "2026-10-02", usedBytes: 12 * GB, totalBytes: 100 * GB }
  ];
  assert.equal(forecastFull(samples), null);
});

test("a disk that's already full says 0 days; a hopelessly slow one says nothing", () => {
  assert.equal(forecastFull(points([98, 99, 100, 101], 100 * GB)).daysUntilFull, 0);
  // +1 KB a day on a 100 GB disk: far beyond ten years.
  const slow = [0, 1, 2].map((i) => ({ day: `2026-10-0${i + 1}`, usedBytes: 50 * GB + i * 1000, totalBytes: 100 * GB }));
  assert.equal(forecastFull(slow), null);
});

test("noisy but growing data still gives a sensible answer", () => {
  // The best-fit line through these points rises 1.2 GB a day (worked out by
  // hand: covariance 21 / variance 17.5), and 100 - 47 = 53 GB are left, so
  // 53 / 1.2 = 44 days.
  const result = forecastFull(points([40, 43, 41, 45, 44, 47]));
  assert.equal(result.daysUntilFull, 44);
  assert.ok(Math.abs(result.bytesPerDay - 1.2 * GB) < 1e3);
});
