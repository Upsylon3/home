// Words for the ways a task can repeat. The server accepts exactly these
// values (see apps/hometasks-backend/src/recurrence.js).
//
// Kept in its own tiny file, separate from React, so it is easy to test and
// so the wording lives in one place.

// The choices shown in the "Repeat" dropdown, in the order shown.
export const REPEAT_OPTIONS = [
  { value: "none", label: "Doesn't repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Every weekday (Mon–Fri)" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
  { value: "yearly", label: "Every year" }
];

// The short label on a task row: "Repeats weekly". Returns null for a normal
// task, meaning "show nothing".
const SHORT = {
  daily: "daily",
  weekdays: "on weekdays",
  weekly: "weekly",
  monthly: "monthly",
  yearly: "yearly"
};

export function describeRepeat(repeat) {
  return SHORT[repeat] ? `Repeats ${SHORT[repeat]}` : null;
}
