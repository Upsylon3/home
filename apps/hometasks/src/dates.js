// Date helpers for HomeTasks. Pure functions (no React, no network), so they
// are easy to read and to test (see test/dates.test.js).
//
// Dates travel as plain "YYYY-MM-DD" text, both in the API and in the
// <input type="date"> boxes. That format has a lovely property: comparing two
// of them as TEXT puts them in calendar order ("2026-10-08" < "2026-10-09"),
// so we never need to convert to Date objects just to compare.

function pad(number) {
  return String(number).padStart(2, "0");
}

// Today's date AS THE PERSON SEES IT, e.g. "2026-10-09".
//
// Careful: new Date().toISOString() would give today's date in UTC, which
// can be yesterday or tomorrow compared with the person's own clock (late
// evening in France is already "tomorrow" somewhere else). getFullYear(),
// getMonth() and getDate() read the browser's LOCAL date instead.
export function todayString(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// "2026-10-09" + 1 -> "2026-10-10". We do the arithmetic in UTC so that
// daylight-saving changes (a 23- or 25-hour day) can't shift the result.
export function addDays(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

// "2026-10-12" -> "Oct 12". Adds the year only when it isn't the current one.
export function shortDate(dateString, today = todayString()) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const sameYear = dateString.slice(0, 4) === today.slice(0, 4);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC"
  });
}

// What to show next to a task's due date.
//   returns null            when there is no due date
//   returns { text, tone }  otherwise. `tone` picks a color class, but the
//                           WORDS carry the meaning ("Overdue", "Today").
export function describeDue(dueDate, today = todayString()) {
  if (!dueDate) return null;
  if (dueDate < today) return { text: `Overdue · ${shortDate(dueDate, today)}`, tone: "overdue" };
  if (dueDate === today) return { text: "Today", tone: "today" };
  if (dueDate === addDays(today, 1)) return { text: "Tomorrow", tone: "later" };
  return { text: shortDate(dueDate, today), tone: "later" };
}

// "Good morning" / "Good afternoon" / "Good evening" from the local hour.
export function greeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
