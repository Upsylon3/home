// Routes for PROJECTS (named buckets of tasks).
//
// Every route here is mounted behind `requireAuth` (see app.js), so by the
// time a handler runs, `req.user.id` is the verified id of whoever is asking.
// EVERY database query below includes `user_id = ?` with that id. That one
// habit is what stops person A from reading or changing person B's projects:
// authorization is enforced here on the server, never by hiding buttons in
// the browser.
const express = require("express");
const { db } = require("./db");
const { asyncHandler } = require("./asyncHandler");
const { validateProjectName, parseId } = require("./validation");

const router = express.Router();

// Turns a database row (snake_case, SQLite types) into the JSON shape the
// API promises (camelCase). Keeping this in one function means the shape is
// defined in exactly one place.
function serializeProject(row) {
  return {
    id: row.id,
    name: row.name,
    openCount: row.open_count ?? 0,
    createdAt: row.created_at
  };
}

// Reads one project, but only if it belongs to this user. Returns undefined
// if it doesn't exist OR belongs to someone else: the caller answers "not
// found" either way, so we never reveal that someone else's project exists.
function findOwnProject(id, userId) {
  return db.prepare("SELECT * FROM task_projects WHERE id = ? AND user_id = ?").get(id, userId);
}

function nameIsTaken(userId, name, exceptId = null) {
  const row = db
    .prepare("SELECT id FROM task_projects WHERE user_id = ? AND name = ? COLLATE NOCASE AND id IS NOT ?")
    .get(userId, name, exceptId);
  return Boolean(row);
}

// GET /api/hometasks/projects — all my projects, each with how many OPEN
// tasks it holds (handy for a sidebar badge).
router.get(
  "/projects",
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT p.*,
                (SELECT COUNT(*) FROM tasks t
                  WHERE t.project_id = p.id AND t.user_id = p.user_id AND t.completed_at IS NULL) AS open_count
           FROM task_projects p
          WHERE p.user_id = ?
          ORDER BY p.name COLLATE NOCASE`
      )
      .all(req.user.id);
    res.json({ projects: rows.map(serializeProject) });
  })
);

// POST /api/hometasks/projects  { name }
router.post(
  "/projects",
  asyncHandler(async (req, res) => {
    const name = validateProjectName(req.body?.name);
    if (name.error) return res.status(400).json({ error: name.error });
    if (nameIsTaken(req.user.id, name.value)) {
      return res.status(409).json({ error: "You already have a project with that name." });
    }

    const info = db.prepare("INSERT INTO task_projects (user_id, name) VALUES (?, ?)").run(req.user.id, name.value);
    const row = findOwnProject(info.lastInsertRowid, req.user.id);
    res.status(201).json({ project: serializeProject(row) });
  })
);

// PATCH /api/hometasks/projects/:id  { name }   (rename)
router.patch(
  "/projects/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const project = id && findOwnProject(id, req.user.id);
    if (!project) return res.status(404).json({ error: "Project not found." });

    const name = validateProjectName(req.body?.name);
    if (name.error) return res.status(400).json({ error: name.error });
    if (nameIsTaken(req.user.id, name.value, project.id)) {
      return res.status(409).json({ error: "You already have a project with that name." });
    }

    db.prepare("UPDATE task_projects SET name = ? WHERE id = ? AND user_id = ?").run(name.value, project.id, req.user.id);
    res.json({ project: serializeProject(findOwnProject(project.id, req.user.id)) });
  })
);

// DELETE /api/hometasks/projects/:id
//
// Deleting a project deletes ONLY the project. Its tasks are not lost: they
// simply become "not in any project". Losing a pile of tasks because you
// tidied up a label would be a nasty surprise.
router.delete(
  "/projects/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const project = id && findOwnProject(id, req.user.id);
    if (!project) return res.status(404).json({ error: "Project not found." });

    // A "transaction" groups steps so they succeed or fail TOGETHER. If the
    // second statement failed, the first is undone, so we can never end up
    // with tasks pointing at a project that no longer exists.
    const removeProject = db.transaction(() => {
      db.prepare("UPDATE tasks SET project_id = NULL WHERE project_id = ? AND user_id = ?").run(project.id, req.user.id);
      db.prepare("DELETE FROM task_projects WHERE id = ? AND user_id = ?").run(project.id, req.user.id);
    });
    removeProject();

    res.json({ ok: true });
  })
);

module.exports = router;
