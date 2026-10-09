// Tests for src/dates.js. Run with `npm test` inside apps/hometasks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { todayString, addDays, shortDate, describeDue, greeting } from "../src/dates.js";

test("todayString reads the LOCAL date, zero-padded", () => {
  // new Date(year, monthIndex, day) builds a local-time date; months count from 0.
  assert.equal(todayString(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(todayString(new Date(2026, 9, 9, 0, 1)), "2026-10-09");
});

test("addDays crosses month, year and leap-day boundaries", () => {
  assert.equal(addDays("2026-10-09", 1), "2026-10-10");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("shortDate shows the year only when it differs from today's", () => {
  assert.equal(shortDate("2026-10-12", "2026-10-09"), "Oct 12");
  assert.equal(shortDate("2027-01-03", "2026-10-09"), "Jan 3, 2027");
});

test("describeDue words: none, overdue, today, tomorrow, later", () => {
  const today = "2026-10-09";
  assert.equal(describeDue(null, today), null);
  assert.deepEqual(describeDue("2026-10-08", today), { text: "Overdue · Oct 8", tone: "overdue" });
  assert.deepEqual(describeDue("2026-10-09", today), { text: "Today", tone: "today" });
  assert.deepEqual(describeDue("2026-10-10", today), { text: "Tomorrow", tone: "later" });
  assert.deepEqual(describeDue("2026-10-20", today), { text: "Oct 20", tone: "later" });
});

test("greeting follows the local hour", () => {
  assert.equal(greeting(new Date(2026, 9, 9, 8)), "Good morning");
  assert.equal(greeting(new Date(2026, 9, 9, 14)), "Good afternoon");
  assert.equal(greeting(new Date(2026, 9, 9, 21)), "Good evening");
});
