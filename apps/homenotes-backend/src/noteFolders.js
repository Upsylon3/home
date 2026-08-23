const express = require("express");
const { db } = require("./db");
const { asyncHandler } = require("./asyncHandler");

const router = express.Router();

function validateName(name) {
  if (typeof name !== "string") return "Name is required.";
  const trimmed = name.trim();
  if (!trimmed) return "Name can't be empty.";
  if (trimmed.length > 100) return "Name must be 100 characters or fewer.";
  if (trimmed.includes("/")) return "Name can't contain a slash.";
  return null;
}

function isDescendant(folderId, candidateAncestorId, userId) {
  let current = db.prepare("SELECT parent_id FROM note_folders WHERE id = ? AND user_id = ?").get(folderId, userId);
  const visited = new Set([folderId]);
  while (current && current.parent_id !== null) {
    if (current.parent_id === candidateAncestorId) return true;
    if (visited.has(current.parent_id)) break; // guards against any accidental cycle
    visited.add(current.parent_id);
    current = db.prepare("SELECT parent_id FROM note_folders WHERE id = ? AND user_id = ?").get(current.parent_id, userId);
  }
  return false;
}

router.get(
  "/note-folders",
  asyncHandler(async (req, res) => {
    const parentId = req.query.parentId !== undefined ? Number(req.query.parentId) : null;
    if (parentId !== null) {
      const parent = db.prepare("SELECT id FROM note_folders WHERE id = ? AND user_id = ?").get(parentId, req.user.id);
      if (!parent) return res.status(404).json({ error: "Folder not found." });
    }
    const folders = db
      .prepare(
        `SELECT * FROM note_folders WHERE user_id = ? AND ${parentId === null ? "parent_id IS NULL" : "parent_id = ?"} ORDER BY name COLLATE NOCASE`
      )
      .all(...(parentId === null ? [req.user.id] : [req.user.id, parentId]));
    res.json({ folders: folders.map(serializeFolder) });
  })
);

router.get(
  "/note-folders/all",
  asyncHandler(async (req, res) => {
    const folders = db.prepare("SELECT * FROM note_folders WHERE user_id = ?").all(req.user.id);
    res.json({ folders: folders.map(serializeFolder) });
  })
);

router.post(
  "/note-folders",
  asyncHandler(async (req, res) => {
    const error = validateName(req.body?.name);
    if (error) return res.status(400).json({ error });
    const name = req.body.name.trim();
    const parentId = req.body?.parentId ?? null;

    if (parentId !== null) {
      const parent = db.prepare("SELECT id FROM note_folders WHERE id = ? AND user_id = ?").get(parentId, req.user.id);
      if (!parent) return res.status(404).json({ error: "Parent folder not found." });
    }

    const collision = db
      .prepare(
        `SELECT id FROM note_folders WHERE user_id = ? AND name = ? COLLATE NOCASE AND ${parentId === null ? "parent_id IS NULL" : "parent_id = ?"}`
      )
      .get(...(parentId === null ? [req.user.id, name] : [req.user.id, name, parentId]));
    if (collision) return res.status(409).json({ error: "A folder with that name already exists here." });

    const info = db.prepare("INSERT INTO note_folders (user_id, name, parent_id) VALUES (?, ?, ?)").run(req.user.id, name, parentId);
    const folder = db.prepare("SELECT * FROM note_folders WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json({ folder: serializeFolder(folder) });
  })
);

router.patch(
  "/note-folders/:id",
  asyncHandler(async (req, res) => {
    const folder = db.prepare("SELECT * FROM note_folders WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!folder) return res.status(404).json({ error: "Folder not found." });

    if (req.body?.name !== undefined) {
      const error = validateName(req.body.name);
      if (error) return res.status(400).json({ error });
      const name = req.body.name.trim();
      const collision = db
        .prepare(
          `SELECT id FROM note_folders WHERE user_id = ? AND id != ? AND name = ? COLLATE NOCASE AND ${
            folder.parent_id === null ? "parent_id IS NULL" : "parent_id = ?"
          }`
        )
        .get(...(folder.parent_id === null ? [req.user.id, folder.id, name] : [req.user.id, folder.id, name, folder.parent_id]));
      if (collision) return res.status(409).json({ error: "A folder with that name already exists here." });
      db.prepare("UPDATE note_folders SET name = ? WHERE id = ?").run(name, folder.id);
    }

    if (req.body?.parentId !== undefined) {
      const newParentId = req.body.parentId;
      if (newParentId !== null) {
        const parent = db.prepare("SELECT id FROM note_folders WHERE id = ? AND user_id = ?").get(newParentId, req.user.id);
        if (!parent) return res.status(404).json({ error: "Destination folder not found." });
        if (newParentId === folder.id || isDescendant(newParentId, folder.id, req.user.id)) {
          return res.status(400).json({ error: "Can't move a folder into its own subtree." });
        }
      }
      db.prepare("UPDATE note_folders SET parent_id = ? WHERE id = ?").run(newParentId, folder.id);
    }

    const updated = db.prepare("SELECT * FROM note_folders WHERE id = ?").get(folder.id);
    res.json({ folder: serializeFolder(updated) });
  })
);

function collectDescendantFolderIds(rootId, userId) {
  // BFS, root first. Reversing this order later (deepest descendants
  // deleted before their ancestors) is what lets every folder be removed
  // without ever leaving a remaining row's parent_id pointing at an
  // already-deleted folder.
  const all = [rootId];
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift();
    const children = db.prepare("SELECT id FROM note_folders WHERE parent_id = ?").all(current);
    for (const child of children) {
      all.push(child.id);
      queue.push(child.id);
    }
  }
  return all;
}

router.delete(
  "/note-folders/:id",
  asyncHandler(async (req, res) => {
    const folder = db.prepare("SELECT id FROM note_folders WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!folder) return res.status(404).json({ error: "Folder not found." });

    // Includes the folder itself plus every descendant at any depth —
    // deleting a folder with grandchildren (or deeper) needs all of them
    // accounted for, not just direct children.
    const allIds = collectDescendantFolderIds(folder.id, req.user.id);
    const childFolderCount = allIds.length - 1;
    const placeholders = allIds.map(() => "?").join(",");
    const noteCount = db
      .prepare(`SELECT COUNT(*) AS n FROM notes WHERE folder_id IN (${placeholders}) AND deleted_at IS NULL`)
      .get(...allIds).n;

    if ((childFolderCount > 0 || noteCount > 0) && req.query.force !== "true") {
      return res.status(409).json({ error: "This folder isn't empty.", childFolderCount, noteCount });
    }

    // Notes move to trash *and* lose their folder reference (moving to a
    // "no folder" / root context) — never hard-deleted just because their
    // folder went away (same "don't destroy content as a side effect"
    // principle as HomeCloud's own force-folder-delete), and clearing
    // folder_id is what actually lets these folder rows be removed
    // without violating the foreign key referencing them.
    if (noteCount > 0) {
      db.prepare(
        `UPDATE notes SET folder_id = NULL, deleted_at = datetime('now'), updated_at = datetime('now')
         WHERE folder_id IN (${placeholders}) AND deleted_at IS NULL`
      ).run(...allIds);
    }

    for (const id of [...allIds].reverse()) {
      db.prepare("DELETE FROM note_folders WHERE id = ?").run(id);
    }

    res.json({ ok: true, notesTrashed: noteCount });
  })
);

function serializeFolder(f) {
  return { id: f.id, name: f.name, parentId: f.parent_id, createdAt: f.created_at };
}

module.exports = router;
