// Small, PURE helper functions that check what a client sent us.
//
// "Pure" means: same input always gives the same output, and nothing outside
// the function is touched (no database, no network). That makes them very
// easy to test (see test/validation.test.js) and easy to read.
//
// Golden rule of backends: NEVER trust what arrives in a request. The
// browser's form might stop someone typing 500 characters, but anyone can
// send a request by hand, so the server has to check again.

// The priorities a task can have, lowest to highest. The position in this
// list is the number we store in the database (0, 1, 2, 3), which makes
// "sort by priority" a simple numeric sort. The API speaks in words because
// words are clearer than magic numbers in JSON.
const PRIORITIES = ["none", "low", "medium", "high"];

const { REPEATS, isValidRepeat } = require("./recurrence");

const MAX_TITLE_LENGTH = 200;
const MAX_NOTES_LENGTH = 5000;
const MAX_PROJECT_NAME_LENGTH = 60;

// "medium" -> 2.  Returns -1 for something that is not a valid priority.
function priorityToNumber(name) {
  return PRIORITIES.indexOf(name);
}

// 2 -> "medium".  Falls back to "none" so a bad stored value can't crash us.
function priorityToName(number) {
  return PRIORITIES[number] ?? "none";
}

// Is `text` a REAL calendar date written as YYYY-MM-DD?
//
// The regular expression only checks the SHAPE ("four digits, dash, two
// digits, dash, two digits"). That alone would accept "2026-02-31", which is
// not a real day. So we also build a Date from the parts and check that it
// comes back unchanged: JavaScript turns Feb 31 into Mar 3, the numbers no
// longer match, and we know the input was bogus.
function isRealDate(text) {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day)); // months count from 0 in JS
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// Which date counts as "today" for the overdue / due-today filters?
//
// The server can't know what time zone the person is in, so we let the
// browser tell us ("?today=2026-10-09"). If it didn't (or sent nonsense), we
// fall back to today's date in UTC. This is why the server never has to
// guess at time zones.
function resolveToday(queryValue) {
  if (isRealDate(queryValue)) return queryValue;
  return new Date().toISOString().slice(0, 10);
}

// Each validator below returns { value } on success or { error } on failure,
// so a route can write:  const r = validateTitle(x); if (r.error) return ...

function validateTitle(title) {
  if (typeof title !== "string") return { error: "Title is required." };
  const trimmed = title.trim();
  if (!trimmed) return { error: "Title can't be empty." };
  if (trimmed.length > MAX_TITLE_LENGTH) return { error: `Title must be ${MAX_TITLE_LENGTH} characters or fewer.` };
  return { value: trimmed };
}

// Notes are optional: missing or null means "no notes" (an empty string).
function validateNotes(notes) {
  if (notes === undefined || notes === null) return { value: "" };
  if (typeof notes !== "string") return { error: "Notes must be text." };
  if (notes.length > MAX_NOTES_LENGTH) return { error: `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.` };
  return { value: notes };
}

// Priority is optional and defaults to "none".  Returns the stored NUMBER.
function validatePriority(priority) {
  if (priority === undefined || priority === null) return { value: 0 };
  const number = priorityToNumber(priority);
  if (number === -1) return { error: `Priority must be one of: ${PRIORITIES.join(", ")}.` };
  return { value: number };
}

// A due date is optional. null (or missing) means "no due date".
function validateDueDate(dueDate) {
  if (dueDate === undefined || dueDate === null) return { value: null };
  if (!isRealDate(dueDate)) return { error: "Due date must be a real date written as YYYY-MM-DD." };
  return { value: dueDate };
}

// How a task repeats. Optional: missing or null means "none" (a normal task).
function validateRepeat(repeat) {
  if (repeat === undefined || repeat === null) return { value: "none" };
  if (!isValidRepeat(repeat)) return { error: `Repeat must be one of: ${REPEATS.join(", ")}.` };
  return { value: repeat };
}

// A task's project is optional: null (or missing) means "no project".
// Otherwise it must be a whole positive number. (Whether that project really
// exists and belongs to this person is checked separately, against the
// database, in tasks.js.)
function validateProjectId(projectId) {
  if (projectId === undefined || projectId === null) return { value: null };
  if (!Number.isInteger(projectId) || projectId < 1) return { error: "projectId must be a whole number, or null." };
  return { value: projectId };
}

function validateProjectName(name) {
  if (typeof name !== "string") return { error: "Name is required." };
  const trimmed = name.trim();
  if (!trimmed) return { error: "Name can't be empty." };
  if (trimmed.length > MAX_PROJECT_NAME_LENGTH) return { error: `Name must be ${MAX_PROJECT_NAME_LENGTH} characters or fewer.` };
  return { value: trimmed };
}

// Turns a route parameter like "12" into the number 12. Anything that isn't
// a whole positive number (like "abc" or "1.5") gives null, and the route
// answers "not found" instead of asking the database a nonsense question.
function parseId(raw) {
  const number = Number(raw);
  return Number.isInteger(number) && number > 0 ? number : null;
}

module.exports = {
  PRIORITIES,
  priorityToNumber,
  priorityToName,
  isRealDate,
  resolveToday,
  validateTitle,
  validateNotes,
  validatePriority,
  validateDueDate,
  validateRepeat,
  validateProjectId,
  validateProjectName,
  parseId
};
