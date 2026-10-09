// Routes for TASKS: create, list (with filters), edit, tick off, un-tick,
// delete, plus a small summary of counts.
//
// As in projects.js, every route sits behind `requireAuth` and every query
// is scoped with `user_id = req.user.id`, so people only ever touch their own
// tasks.
//
// NOT BUILT YET (on purpose, see docs/ROADMAP.md): recurring tasks,
// reminders / notifications, assigning a task to another family member, and
// emitting events like "hometasks.task.completed" to the shared event bus.
// Assignment in particular needs the multi-user sharing model HomeCloud
// doesn't have yet, so it waits for that rather than being faked here.
const express = require("express");
const { db } = require("./db");
const { asyncHandler } = require("./asyncHandler");
const {
  priorityToName,
  resolveToday,
  validateTitle,
  validateNotes,
  validatePriority,
  validateDueDate,
  validateProjectId,
  parseId
} = require("./validation");

const router = express.Router();

// Database row -> the JSON shape the API promises (see projects.js for why
// this lives in one function).
function serializeTask(row) {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    priority: priorityToName(row.priority),
    dueDate: row.due_date, // "YYYY-MM-DD" or null
    projectId: row.project_id, // number or null
    isDone: row.completed_at !== null,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function findOwnTask(id, userId) {
  return db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(id, userId);
}

function ownsProject(projectId, userId) {
  return Boolean(db.prepare("SELECT id FROM task_projects WHERE id = ? AND user_id = ?").get(projectId, userId));
}

// In a SQL LIKE pattern, % and _ are wildcards. If someone searches for "50%"
// we want a literal percent sign, so we put a backslash in front of any
// wildcard character (and of the backslash itself).
function escapeLike(text) {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

// GET /api/hometasks/summary?today=YYYY-MM-DD
// Three numbers for a dashboard badge: open tasks, overdue ones, due today.
router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const today = resolveToday(req.query.today);
    const row = db
      .prepare(
        `SELECT
           COUNT(*) AS open,
           COALESCE(SUM(due_date < ?), 0) AS overdue,
           COALESCE(SUM(due_date = ?), 0) AS due_today
         FROM tasks
        WHERE user_id = ? AND completed_at IS NULL`
      )
      .get(today, today, req.user.id);
    res.json({ open: row.open, overdue: row.overdue, dueToday: row.due_today });
  })
);

// GET /api/hometasks/tasks
// Optional query parameters (all combine with AND):
//   status=open|done|all     default "open"
//   projectId=<number>       only tasks in that project
//   due=overdue|today|upcoming|none   (needs today=YYYY-MM-DD from the browser)
//   search=<text>            matches the title or the notes
router.get(
  "/tasks",
  asyncHandler(async (req, res) => {
    const status = req.query.status ?? "open";
    if (!["open", "done", "all"].includes(status)) {
      return res.status(400).json({ error: "status must be open, done or all." });
    }

    // We build the WHERE clause piece by piece. `conditions` holds SQL
    // fragments and `params` holds the values for each "?" in them, in order.
    // Values ALWAYS go through "?" placeholders, never glued into the SQL
    // text. That is what prevents "SQL injection".
    const conditions = ["user_id = ?"];
    const params = [req.user.id];

    if (status === "open") conditions.push("completed_at IS NULL");
    if (status === "done") conditions.push("completed_at IS NOT NULL");

    if (req.query.projectId !== undefined) {
      const projectId = parseId(req.query.projectId);
      if (!projectId || !ownsProject(projectId, req.user.id)) {
        return res.status(404).json({ error: "Project not found." });
      }
      conditions.push("project_id = ?");
      params.push(projectId);
    }

    if (req.query.due !== undefined) {
      const today = resolveToday(req.query.today);
      switch (req.query.due) {
        case "overdue":
          conditions.push("due_date < ?");
          params.push(today);
          break;
        case "today":
          conditions.push("due_date = ?");
          params.push(today);
          break;
        case "upcoming":
          conditions.push("due_date > ?");
          params.push(today);
          break;
        case "none":
          conditions.push("due_date IS NULL");
          break;
        default:
          return res.status(400).json({ error: "due must be overdue, today, upcoming or none." });
      }
    }

    if (typeof req.query.search === "string" && req.query.search.trim()) {
      const pattern = `%${escapeLike(req.query.search.trim())}%`;
      conditions.push("(title LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')");
      params.push(pattern, pattern);
    }

    // Sort order. Finished tasks: most recently finished first. Everything
    // else: soonest due date first, tasks with NO due date last, then
    // higher priority first, then oldest first.
    const orderBy =
      status === "done"
        ? "completed_at DESC, id DESC"
        : "due_date IS NULL, due_date ASC, priority DESC, id ASC";

    const rows = db.prepare(`SELECT * FROM tasks WHERE ${conditions.join(" AND ")} ORDER BY ${orderBy}`).all(...params);
    res.json({ tasks: rows.map(serializeTask) });
  })
);

// POST /api/hometasks/tasks  { title, notes?, priority?, dueDate?, projectId? }
router.post(
  "/tasks",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};

    const title = validateTitle(body.title);
    if (title.error) return res.status(400).json({ error: title.error });
    const notes = validateNotes(body.notes);
    if (notes.error) return res.status(400).json({ error: notes.error });
    const priority = validatePriority(body.priority);
    if (priority.error) return res.status(400).json({ error: priority.error });
    const dueDate = validateDueDate(body.dueDate);
    if (dueDate.error) return res.status(400).json({ error: dueDate.error });

    const project = validateProjectId(body.projectId);
    if (project.error) return res.status(400).json({ error: project.error });
    const projectId = project.value;
    if (projectId !== null && !ownsProject(projectId, req.user.id)) {
      return res.status(404).json({ error: "Project not found." });
    }

    const info = db
      .prepare("INSERT INTO tasks (user_id, project_id, title, notes, priority, due_date) VALUES (?, ?, ?, ?, ?, ?)")
      .run(req.user.id, projectId, title.value, notes.value, priority.value, dueDate.value);

    res.status(201).json({ task: serializeTask(findOwnTask(info.lastInsertRowid, req.user.id)) });
  })
);

// GET /api/hometasks/tasks/:id
router.get(
  "/tasks/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const task = id && findOwnTask(id, req.user.id);
    if (!task) return res.status(404).json({ error: "Task not found." });
    res.json({ task: serializeTask(task) });
  })
);

// PATCH /api/hometasks/tasks/:id
//
// A "partial update": the client sends ONLY the fields it wants to change,
// and everything else stays as it was. Sending `"dueDate": null` (or
// `"projectId": null`) means "clear it", which is different from leaving the
// field out. That's why we check whether a key is PRESENT in the body
// instead of checking whether its value is truthy.
router.patch(
  "/tasks/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const task = id && findOwnTask(id, req.user.id);
    if (!task) return res.status(404).json({ error: "Task not found." });

    const body = req.body ?? {};
    const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

    // Start from the current values, overwrite whatever was sent.
    let { title, notes, priority, due_date: dueDate, project_id: projectId } = task;

    if (has("title")) {
      const result = validateTitle(body.title);
      if (result.error) return res.status(400).json({ error: result.error });
      title = result.value;
    }
    if (has("notes")) {
      const result = validateNotes(body.notes);
      if (result.error) return res.status(400).json({ error: result.error });
      notes = result.value;
    }
    if (has("priority")) {
      const result = validatePriority(body.priority);
      if (result.error) return res.status(400).json({ error: result.error });
      priority = result.value;
    }
    if (has("dueDate")) {
      const result = validateDueDate(body.dueDate);
      if (result.error) return res.status(400).json({ error: result.error });
      dueDate = result.value;
    }
    if (has("projectId")) {
      const result = validateProjectId(body.projectId);
      if (result.error) return res.status(400).json({ error: result.error });
      projectId = result.value;
      if (projectId !== null && !ownsProject(projectId, req.user.id)) {
        return res.status(404).json({ error: "Project not found." });
      }
    }

    db.prepare(
      `UPDATE tasks
          SET title = ?, notes = ?, priority = ?, due_date = ?, project_id = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ?`
    ).run(title, notes, priority, dueDate, projectId, task.id, req.user.id);

    res.json({ task: serializeTask(findOwnTask(task.id, req.user.id)) });
  })
);

// POST /api/hometasks/tasks/:id/complete — tick a task off.
// "Idempotent": ticking an already-finished task changes nothing and still
// succeeds, so a double-click (or a retried request) can't cause trouble.
router.post(
  "/tasks/:id/complete",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const task = id && findOwnTask(id, req.user.id);
    if (!task) return res.status(404).json({ error: "Task not found." });

    if (task.completed_at === null) {
      db.prepare("UPDATE tasks SET completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(
        task.id,
        req.user.id
      );
    }
    res.json({ task: serializeTask(findOwnTask(task.id, req.user.id)) });
  })
);

// POST /api/hometasks/tasks/:id/reopen — un-tick (also idempotent).
router.post(
  "/tasks/:id/reopen",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const task = id && findOwnTask(id, req.user.id);
    if (!task) return res.status(404).json({ error: "Task not found." });

    if (task.completed_at !== null) {
      db.prepare("UPDATE tasks SET completed_at = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(
        task.id,
        req.user.id
      );
    }
    res.json({ task: serializeTask(findOwnTask(task.id, req.user.id)) });
  })
);

// DELETE /api/hometasks/tasks/:id — permanent. (Unlike files, a task is
// tiny and easy to re-create, so there is no Trash for tasks. The browser
// should still ask "are you sure?" first.)
router.delete(
  "/tasks/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const task = id && findOwnTask(id, req.user.id);
    if (!task) return res.status(404).json({ error: "Task not found." });

    db.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?").run(task.id, req.user.id);
    res.json({ ok: true });
  })
);

module.exports = router;
