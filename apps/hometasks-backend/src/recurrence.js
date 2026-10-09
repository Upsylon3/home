// The rules for REPEATING tasks: given a task's due date and how it repeats,
// what is the date of the next one?
//
// Pure functions again (no database, no network), so every awkward calendar
// case below is covered by quick tests (test/recurrence.test.js).
//
// HOW REPEATING WORKS IN HOMETASKS
// When you tick off a repeating task, it stays in your Done list as a record
// and a brand-new copy appears with the next due date. So "Water the plants"
// done on Monday really is finished, and Wednesday's "Water the plants" is a
// separate, open task. (See `POST /tasks/:id/complete` in tasks.js.)

// "none" means a normal, one-off task.
const REPEATS = ["none", "daily", "weekdays", "weekly", "monthly", "yearly"];

function isValidRepeat(value) {
  return REPEATS.includes(value);
}

// --- small date helpers. Dates are "YYYY-MM-DD" text; we do the arithmetic in
// UTC so daylight-saving changes (23- or 25-hour days) can never shift a date.

function formatDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDate(text) {
  return text.split("-").map(Number); // "2026-10-09" -> [2026, 10, 9]
}

function addDays(text, days) {
  const [year, month, day] = parseDate(text);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

// How many days a month has. Day 0 of the NEXT month is the last day of this
// one, which is a handy trick that also handles leap years for us.
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// 0 = Sunday ... 6 = Saturday
function dayOfWeek(text) {
  const [year, month, day] = parseDate(text);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

// One single step forward from `from`, following the repeat rule.
//
// `anchor` is the date the series was ORIGINALLY set up on. Monthly and
// yearly repeats need it so they don't "drift": a task anchored on the 31st
// goes Jan 31, then Feb 28 (February is short), then back to Mar 31, rather
// than getting stuck on the 28th forever.
function stepOnce(repeat, from, anchor) {
  const [year, month] = parseDate(from);
  const anchorDay = parseDate(anchor)[2];

  switch (repeat) {
    case "daily":
      return addDays(from, 1);

    case "weekdays": {
      // Next day, then keep going while it lands on a Saturday or Sunday.
      let next = addDays(from, 1);
      while (dayOfWeek(next) === 0 || dayOfWeek(next) === 6) next = addDays(next, 1);
      return next;
    }

    case "weekly":
      return addDays(from, 7);

    case "monthly": {
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      return formatDate(nextYear, nextMonth, Math.min(anchorDay, daysInMonth(nextYear, nextMonth)));
    }

    case "yearly":
      // A Feb 29 anchor becomes Feb 28 in non-leap years, and Feb 29 again in
      // the next leap year.
      return formatDate(year + 1, month, Math.min(anchorDay, daysInMonth(year + 1, month)));

    default:
      throw new Error(`Cannot step a task that repeats "${repeat}".`);
  }
}

// The due date of the next occurrence.
//
//   repeat   one of REPEATS (not "none")
//   dueDate  the date of the occurrence being completed
//   anchor   the date the series started on (see stepOnce)
//   today    the person's own "today" (the browser tells us; we never guess
//            a time zone)
//
// The next date is always AFTER `today`. Why: if a daily task has been
// ignored for five days and you finally tick it off, you want tomorrow's
// copy, not a pile of five already-overdue ones.
function nextDueDate(repeat, dueDate, anchor, today) {
  let next = stepOnce(repeat, dueDate, anchor);

  // The counter is a safety net so a bug can never make this loop forever.
  let steps = 0;
  while (next <= today && steps < 20000) {
    next = stepOnce(repeat, next, anchor);
    steps += 1;
  }
  return next;
}

module.exports = { REPEATS, isValidRepeat, nextDueDate };
