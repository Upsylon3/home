import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBytes, formatRate, formatDuration, formatAgo, meterTone, SERVICE_STATUS } from "../src/format.js";

test("formatBytes picks a sensible unit and shows a dash for no reading", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(5 * 1024 ** 3), "5.0 GB");
  assert.equal(formatBytes(2.5 * 1024 ** 4), "2.5 TB");
  assert.equal(formatBytes(null), "—");
  assert.equal(formatBytes(undefined), "—");
  assert.equal(formatBytes(NaN), "—");
});

test("formatRate adds '/s'", () => {
  assert.equal(formatRate(1536), "1.5 KB/s");
  assert.equal(formatRate(null), "—");
});

test("formatDuration shows the two biggest units", () => {
  assert.equal(formatDuration(30), "0 min");
  assert.equal(formatDuration(125 * 60), "2 h 5 min");
  assert.equal(formatDuration(93784), "1 d 2 h");
  assert.equal(formatDuration(-5), "—");
});

test("formatAgo counts up through seconds, minutes, hours, days", () => {
  const now = Date.UTC(2026, 9, 9, 12, 0, 0);
  const ago = (seconds) => formatAgo(now - seconds * 1000, now);
  assert.equal(ago(3), "just now");
  assert.equal(ago(42), "42 s ago");
  assert.equal(ago(5 * 60), "5 min ago");
  assert.equal(ago(3 * 3600), "3 h ago");
  assert.equal(ago(2 * 86400), "2 d ago");
  assert.equal(formatAgo(new Date(now - 90_000).toISOString(), now), "1 min ago"); // ISO strings work too
  assert.equal(formatAgo("not a date", now), "—");
});

test("meterTone: ok below 80, high from 80, critical from 95", () => {
  assert.equal(meterTone(79.9), "ok");
  assert.equal(meterTone(80), "high");
  assert.equal(meterTone(94.9), "high");
  assert.equal(meterTone(95), "critical");
});

test("every service status has a written label", () => {
  for (const status of ["up", "degraded", "down", "unknown"]) assert.ok(SERVICE_STATUS[status].label);
});
