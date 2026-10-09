// Unit tests for the pure helpers in src/validation.js. No server, no
// database: just "give it an input, check the output". These run in a few
// milliseconds, which is why we test the fiddly rules (like dates) here
// instead of through HTTP.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const v = require("../src/validation");

test("isRealDate accepts real dates and rejects impossible or badly shaped ones", () => {
  assert.equal(v.isRealDate("2026-10-09"), true);
  assert.equal(v.isRealDate("2028-02-29"), true); // 2028 is a leap year
  assert.equal(v.isRealDate("2026-02-29"), false); // 2026 is not
  assert.equal(v.isRealDate("2026-02-31"), false);
  assert.equal(v.isRealDate("2026-13-01"), false);
  assert.equal(v.isRealDate("2026-1-5"), false); // wrong shape: needs two digits
  assert.equal(v.isRealDate("tomorrow"), false);
  assert.equal(v.isRealDate(20261009), false); // a number, not text
  assert.equal(v.isRealDate(null), false);
});

test("resolveToday uses the browser's date when valid, otherwise today in UTC", () => {
  assert.equal(v.resolveToday("2026-10-09"), "2026-10-09");
  assert.match(v.resolveToday("garbage"), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(v.resolveToday(undefined), /^\d{4}-\d{2}-\d{2}$/);
});

test("priority converts between words and the numbers we store", () => {
  assert.equal(v.priorityToNumber("none"), 0);
  assert.equal(v.priorityToNumber("high"), 3);
  assert.equal(v.priorityToNumber("urgent"), -1);
  assert.equal(v.priorityToName(2), "medium");
  assert.equal(v.priorityToName(99), "none"); // a bad stored value can't crash us
});

test("validateTitle trims, and rejects missing, blank and too-long titles", () => {
  assert.deepEqual(v.validateTitle("  Buy milk  "), { value: "Buy milk" });
  assert.ok(v.validateTitle(undefined).error);
  assert.ok(v.validateTitle(42).error);
  assert.ok(v.validateTitle("   ").error);
  assert.ok(v.validateTitle("x".repeat(201)).error);
  assert.equal(v.validateTitle("x".repeat(200)).value.length, 200); // exactly the limit is fine
});

test("optional fields default sensibly and reject bad values", () => {
  assert.deepEqual(v.validateNotes(undefined), { value: "" });
  assert.ok(v.validateNotes(5).error);
  assert.deepEqual(v.validatePriority(undefined), { value: 0 });
  assert.ok(v.validatePriority("urgent").error);
  assert.deepEqual(v.validateDueDate(null), { value: null });
  assert.ok(v.validateDueDate("2026-02-31").error);
  assert.deepEqual(v.validateProjectId(null), { value: null });
  assert.deepEqual(v.validateProjectId(7), { value: 7 });
  assert.ok(v.validateProjectId("7").error); // must be a real number, not text
  assert.ok(v.validateProjectId(0).error);
});

test("parseId only accepts whole positive numbers", () => {
  assert.equal(v.parseId("12"), 12);
  assert.equal(v.parseId("abc"), null);
  assert.equal(v.parseId("1.5"), null);
  assert.equal(v.parseId("0"), null);
  assert.equal(v.parseId("-3"), null);
});
