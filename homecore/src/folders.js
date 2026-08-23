const express = require("express");
const { db, logActivity } = require("./db");
const { requireAuth } = require("./middleware/authMiddleware");

const router = express.Router();
router.use(requireAuth);

const NAME_RE = /^[^/\\]{1,100}$/; // no path separators, 1-100 chars

function getFolder(id, userId) {
  return db.prepare("SELECT * FROM folders WHERE id = ? AND user_id = ?").get(id, userId);
}

// All folder ids nested anywhere under (and including) rootId, via a
// recursive query — used both to block moving a folder into its own
// descendant, and to cascade-delete everything inside a folder.
function getSubtreeIds(rootId, userId) {
  const rows = db
    .prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM folders WHERE id = ? AND user_id = ?
         UNION ALL
         SELECT f.id FROM folders f JOIN subtree s ON f.parent_id = s.id
       )
       SELECT id FROM subtree`
    )
    .all(rootId, userId);
  return rows.map((r) => r.id);
}

function buildBreadcrumb(folderId, userId) {
  const trail = [];
  let current = folderId;
  let guard = 0; // safety net against any accidental cycle
  while (current !== null && current !== undefined && guard++ < 100) {
    const folder = getFolder(current, userId);
    if (!folder) break;
    trail.unshift({ id: folder.id, name: folder.name });
    current = folder.parent_id;
  }
  return trail;
}

// The full folder tree in one flat list (id/name/parentId), used by the
// frontend to build a "move to folder" picker without needing to navigate
// level by level.
router.get("/all", (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, parent_id AS parentId FROM folders
       WHERE user_id = ? ORDER BY name COLLATE NOCASE ASC`
    )
    .all(req.user.id);
  res.json({ folders: rows });
});

// List the subfolders directly inside a given parent (or the root, if
// parentId is omitted). Used by the main file-browser view.
router.get("/", (req, res) => {
  const parentId = req.query.parentId ? Number(req.query.parentId) : null;

  if (parentId !== null) {
    const parent = getFolder(parentId, req.user.id);
    if (!parent) return res.status(404).json({ error: "Folder not found." });
  }

  const rows = db
    .prepare(
      `SELECT id, name, parent_id AS parentId, created_at AS createdAt
       FROM folders WHERE user_id = ? AND parent_id IS ?
       ORDER BY name COLLATE NOCASE ASC`
    )
    .all(req.user.id, parentId);

  const breadcrumb = parentId !== null ? buildBreadcrumb(parentId, req.user.id) : [];
  res.json({ folders: rows, breadcrumb });
});

router.post("/", (req, res) => {
  const { name, parentId } = req.body || {};
  if (typeof name !== "string") {
    return res.status(400).json({ error: "Folder name is required." });
  }
  const trimmed = name.trim();

  if (!NAME_RE.test(trimmed)) {
    return res.status(400).json({ error: "Folder name must be 1-100 characters and can't contain / or \\." });
  }

  let parent = null;
  if (parentId) {
    parent = getFolder(parentId, req.user.id);
    if (!parent) return res.status(404).json({ error: "Parent folder not found." });
  }

  const existing = db
    .prepare("SELECT id FROM folders WHERE user_id = ? AND parent_id IS ? AND name = ? COLLATE NOCASE")
    .get(req.user.id, parent ? parent.id : null, trimmed);
  if (existing) {
    return res.status(409).json({ error: "A folder with that name already exists here." });
  }

  const info = db
    .prepare("INSERT INTO folders (user_id, parent_id, name) VALUES (?, ?, ?)")
    .run(req.user.id, parent ? parent.id : null, trimmed);

  logActivity(req.user.id, "folder_create", trimmed);
  res.status(201).json({ folder: { id: info.lastInsertRowid, name: trimmed, parentId: parent ? parent.id : null } });
});

router.patch("/:id", (req, res) => {
  const folder = getFolder(req.params.id, req.user.id);
  if (!folder) return res.status(404).json({ error: "Folder not found." });

  if (typeof req.body?.name !== "string") {
    return res.status(400).json({ error: "Folder name is required." });
  }
  const trimmed = req.body.name.trim();
  if (!NAME_RE.test(trimmed)) {
    return res.status(400).json({ error: "Folder name must be 1-100 characters and can't contain / or \\." });
  }

  const existing = db
    .prepare("SELECT id FROM folders WHERE user_id = ? AND parent_id IS ? AND name = ? COLLATE NOCASE AND id != ?")
    .get(req.user.id, folder.parent_id, trimmed, folder.id);
  if (existing) {
    return res.status(409).json({ error: "A folder with that name already exists here." });
  }

  db.prepare("UPDATE folders SET name = ? WHERE id = ?").run(trimmed, folder.id);
  logActivity(req.user.id, "folder_rename", `${folder.name} → ${trimmed}`);
  res.json({ ok: true });
});

// Move a folder under a new parent (or to the root, if parentId is null).
router.post("/:id/move", (req, res) => {
  const folder = getFolder(req.params.id, req.user.id);
  if (!folder) return res.status(404).json({ error: "Folder not found." });

  const { parentId } = req.body || {};

  if (parentId) {
    const newParent = getFolder(parentId, req.user.id);
    if (!newParent) return res.status(404).json({ error: "Destination folder not found." });

    const subtreeIds = getSubtreeIds(folder.id, req.user.id);
    if (subtreeIds.includes(Number(parentId))) {
      return res.status(400).json({ error: "Can't move a folder into itself or one of its own subfolders." });
    }
  }

  db.prepare("UPDATE folders SET parent_id = ? WHERE id = ?").run(parentId || null, folder.id);
  res.json({ ok: true });
});

// Delete a folder. If it's empty, this just removes it. If it (or any
// subfolder) still contains files, ?force=true is required, and those
// files are moved to Trash rather than being immediately, permanently
// deleted — consistent with how deleting a single file works elsewhere.
router.delete("/:id", (req, res) => {
  const folder = getFolder(req.params.id, req.user.id);
  if (!folder) return res.status(404).json({ error: "Folder not found." });

  const subtreeIds = getSubtreeIds(folder.id, req.user.id);
  const placeholders = subtreeIds.map(() => "?").join(",");
  const fileCount = db
    .prepare(`SELECT COUNT(*) AS n FROM files WHERE folder_id IN (${placeholders}) AND deleted_at IS NULL`)
    .get(...subtreeIds).n;

  if (fileCount > 0 && req.query.force !== "true") {
    return res.status(409).json({
      error: `This folder contains ${fileCount} file(s). Delete again with force to move them to Trash.`,
      fileCount
    });
  }

  if (fileCount > 0) {
    db.prepare(
      `UPDATE files SET deleted_at = datetime('now'), folder_id = NULL
       WHERE folder_id IN (${placeholders}) AND deleted_at IS NULL`
    ).run(...subtreeIds);
  }

  // Files already sitting in Trash that reference this folder subtree
  // would otherwise be left with a dangling folder_id — clear it so a
  // later restore lands them in the root view instead of nowhere.
  db.prepare(`UPDATE files SET folder_id = NULL WHERE folder_id IN (${placeholders}) AND deleted_at IS NOT NULL`).run(
    ...subtreeIds
  );

  // Deleting the folders themselves cascades to subfolders via the
  // ON DELETE CASCADE foreign key, so removing just the root of the
  // subtree is enough.
  db.prepare("DELETE FROM folders WHERE id = ?").run(folder.id);
  logActivity(req.user.id, "folder_delete", folder.name);
  res.json({ ok: true, filesTrashed: fileCount });
});

module.exports = router;
module.exports.buildBreadcrumb = buildBreadcrumb;
