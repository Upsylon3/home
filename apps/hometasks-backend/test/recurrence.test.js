// Unit tests for src/recurrence.js: every awkward calendar case, no server.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { REPEATS, isValidRepeat, nextDueDate } = require("../src/recurrence");

// A "today" far in the past so these tests only check the stepping rules.
// (The skip-forward behavior has its own test below.)
const LONG_AGO = "2000-01-01";

test("the list of repeats, and validation", () => {
  assert.deepEqual(REPEATS, ["none", "daily", "weekdays", "weekly", "monthly", "yearly"]);
  assert.equal(isValidRepeat("weekly"), true);
  assert.equal(isValidRepeat("hourly"), false);
  assert.equal(isValidRepeat(undefined), false);
});

test("daily, across month and year ends", () => {
  assert.equal(nextDueDate("daily", "2026-10-09", "2026-10-09", LONG_AGO), "2026-10-10");
  assert.equal(nextDueDate("daily", "2026-10-31", "2026-10-31", LONG_AGO), "2026-11-01");
  assert.equal(nextDueDate("daily", "2026-12-31", "2026-12-31", LONG_AGO), "2027-01-01");
  assert.equal(nextDueDate("daily", "2028-02-28", "2028-02-28", LONG_AGO), "2028-02-29");
});

test("weekdays skips Saturday and Sunday", () => {
  // 2026-10-09 is a Friday.
  assert.equal(nextDueDate("weekdays", "2026-10-09", "2026-10-09", LONG_AGO), "2026-10-12"); // Monday
  assert.equal(nextDueDate("weekdays", "2026-10-12", "2026-10-12", LONG_AGO), "2026-10-13"); // Tuesday
  // A task someone set on a Saturday still moves to the next weekday.
  assert.equal(nextDueDate("weekdays", "2026-10-10", "2026-10-10", LONG_AGO), "2026-10-12");
});

test("weekly is exactly seven days", () => {
  assert.equal(nextDueDate("weekly", "2026-10-09", "2026-10-09", LONG_AGO), "2026-10-16");
  assert.equal(nextDueDate("weekly", "2026-12-28", "2026-12-28", LONG_AGO), "2027-01-04");
});

test("monthly keeps its day, and clips short months WITHOUT drifting", () => {
  assert.equal(nextDueDate("monthly", "2026-10-09", "2026-10-09", LONG_AGO), "2026-11-09");
  assert.equal(nextDueDate("monthly", "2026-12-15", "2026-12-15", LONG_AGO), "2027-01-15");

  // A series anchored on the 31st: Jan 31 -> Feb 28 -> Mar 31 -> Apr 30 -> May 31.
  const anchor = "2027-01-31";
  const feb = nextDueDate("monthly", "2027-01-31", anchor, LONG_AGO);
  const mar = nextDueDate("monthly", feb, anchor, LONG_AGO);
  const apr = nextDueDate("monthly", mar, anchor, LONG_AGO);
  assert.deepEqual([feb, mar, apr], ["2027-02-28", "2027-03-31", "2027-04-30"]);

  // Leap year February.
  assert.equal(nextDueDate("monthly", "2028-01-31", "2028-01-31", LONG_AGO), "2028-02-29");
});

test("yearly keeps its date; Feb 29 becomes Feb 28 and returns in the next leap year", () => {
  assert.equal(nextDueDate("yearly", "2026-10-09", "2026-10-09", LONG_AGO), "2027-10-09");
  const anchor = "2028-02-29";
  const y2029 = nextDueDate("yearly", "2028-02-29", anchor, LONG_AGO);
  assert.equal(y2029, "2029-02-28");
  let date = y2029;
  for (let i = 0; i < 3; i += 1) date = nextDueDate("yearly", date, anchor, LONG_AGO); // 2030, 2031, 2032
  assert.equal(date, "2032-02-29");
});

test("the next date is always AFTER today, skipping missed occurrences", () => {
  // A daily task due 5 days ago, completed today: tomorrow, not 4 days ago.
  assert.equal(nextDueDate("daily", "2026-10-04", "2026-10-04", "2026-10-09"), "2026-10-10");
  // Weekly, due on Oct 2 (a Friday), completed on Friday Oct 9: the NEXT Friday.
  assert.equal(nextDueDate("weekly", "2026-10-02", "2026-10-02", "2026-10-09"), "2026-10-16");
  // Due today, completed today: just the next step.
  assert.equal(nextDueDate("daily", "2026-10-09", "2026-10-09", "2026-10-09"), "2026-10-10");
  // Completed EARLY (due in the future): still just one step from the due date.
  assert.equal(nextDueDate("weekly", "2026-10-20", "2026-10-20", "2026-10-09"), "2026-10-27");
  // Monthly, long overdue: lands on the right day of a future month.
  assert.equal(nextDueDate("monthly", "2026-06-15", "2026-06-15", "2026-10-09"), "2026-10-15");
});

test("asking for the next occurrence of a non-repeating task is a programming error", () => {
  assert.throws(() => nextDueDate("none", "2026-10-09", "2026-10-09", LONG_AGO));
});
