const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerHomeNotesUser } = require("./helpers/client");

let homenotesUrl, homecore;

before(async () => {
  const started = await startTestApp();
  homenotesUrl = started.baseUrl;
  homecore = started.homecore;
});

after(async () => {
  await stopTestApp();
});

function register(overrides) {
  return registerHomeNotesUser(homecore, homenotesUrl, overrides);
}

test("note-folder routes require auth", async () => {
  const res = await makeClient(homenotesUrl).get("/api/homenotes/note-folders");
  assert.equal(res.status, 401);
});

test("create rejects invalid names, rejects duplicates at the same level", async () => {
  const { client } = await register({ username: "folder_validate_user" });

  const empty = await client.post("/api/homenotes/note-folders", { name: "" });
  assert.equal(empty.status, 400);

  const slash = await client.post("/api/homenotes/note-folders", { name: "a/b" });
  assert.equal(slash.status, 400);

  const first = await client.post("/api/homenotes/note-folders", { name: "Projects" });
  assert.equal(first.status, 201);

  const dupe = await client.post("/api/homenotes/note-folders", { name: "projects" });
  assert.equal(dupe.status, 409);
});

test("nested folders: list by parent, list all flat", async () => {
  const { client } = await register({ username: "folder_nest_user" });

  const top = await client.post("/api/homenotes/note-folders", { name: "Ideas" });
  const child = await client.post("/api/homenotes/note-folders", { name: "Half-Baked", parentId: top.body.folder.id });

  const rootList = await client.get("/api/homenotes/note-folders");
  assert.equal(rootList.body.folders.length, 1);

  const childList = await client.get(`/api/homenotes/note-folders?parentId=${top.body.folder.id}`);
  assert.equal(childList.body.folders.length, 1);
  assert.equal(childList.body.folders[0].name, "Half-Baked");

  const all = await client.get("/api/homenotes/note-folders/all");
  assert.equal(all.body.folders.length, 2);
  assert.equal(child.status, 201);
});

test("listing inside a nonexistent parent 404s", async () => {
  const { client } = await register({ username: "folder_missing_parent_user" });
  const res = await client.get("/api/homenotes/note-folders?parentId=999999");
  assert.equal(res.status, 404);
});

test("rename rejects collisions, move rejects into own subtree", async () => {
  const { client } = await register({ username: "folder_move_user" });
  const a = await client.post("/api/homenotes/note-folders", { name: "Alpha" });
  const b = await client.post("/api/homenotes/note-folders", { name: "Beta" });
  const child = await client.post("/api/homenotes/note-folders", { name: "Child", parentId: a.body.folder.id });

  const renameCollide = await client.patch(`/api/homenotes/note-folders/${b.body.folder.id}`, { name: "alpha" });
  assert.equal(renameCollide.status, 409);

  const moveIntoOwnChild = await client.patch(`/api/homenotes/note-folders/${a.body.folder.id}`, {
    parentId: child.body.folder.id
  });
  assert.equal(moveIntoOwnChild.status, 400);

  const validMove = await client.patch(`/api/homenotes/note-folders/${child.body.folder.id}`, { parentId: null });
  assert.equal(validMove.status, 200);
});

test("delete: empty folder removes cleanly; non-empty requires force and trashes its notes instead of destroying them", async () => {
  const { client } = await register({ username: "folder_delete_user" });
  const empty = await client.post("/api/homenotes/note-folders", { name: "EmptyOne" });
  const delEmpty = await client.delete(`/api/homenotes/note-folders/${empty.body.folder.id}`);
  assert.equal(delEmpty.status, 200);

  const withNote = await client.post("/api/homenotes/note-folders", { name: "HasNote" });
  const note = await client.post("/api/homenotes/notes", { title: "Keep me", folderId: withNote.body.folder.id });

  const withoutForce = await client.delete(`/api/homenotes/note-folders/${withNote.body.folder.id}`);
  assert.equal(withoutForce.status, 409);
  assert.equal(withoutForce.body.noteCount, 1);

  const withForce = await client.delete(`/api/homenotes/note-folders/${withNote.body.folder.id}?force=true`);
  assert.equal(withForce.status, 200);
  assert.equal(withForce.body.notesTrashed, 1);

  const trash = await client.get("/api/homenotes/notes/trash");
  assert.equal(trash.body.notes.some((n) => n.id === note.body.note.id), true);
});

test("folders are isolated per user", async () => {
  const owner = await register({ username: "folder_owner" });
  const stranger = await register({ username: "folder_stranger" });

  const folder = await owner.client.post("/api/homenotes/note-folders", { name: "OwnersOnly" });
  const strangerRename = await stranger.client.patch(`/api/homenotes/note-folders/${folder.body.folder.id}`, {
    name: "Hijacked"
  });
  assert.equal(strangerRename.status, 404);

  const strangerList = await stranger.client.get("/api/homenotes/note-folders");
  assert.equal(strangerList.body.folders.length, 0);
});

test("force-deleting a folder with grandchildren removes the whole subtree without a foreign-key error", async () => {
  const { client } = await register({ username: "folder_deep_nest_user" });

  const root = await client.post("/api/homenotes/note-folders", { name: "Root" });
  const mid = await client.post("/api/homenotes/note-folders", { name: "Mid", parentId: root.body.folder.id });
  const leaf = await client.post("/api/homenotes/note-folders", { name: "Leaf", parentId: mid.body.folder.id });
  const noteInLeaf = await client.post("/api/homenotes/notes", { title: "Deeply nested note", folderId: leaf.body.folder.id });
  const noteInRoot = await client.post("/api/homenotes/notes", { title: "Root-level note", folderId: root.body.folder.id });

  const withoutForce = await client.delete(`/api/homenotes/note-folders/${root.body.folder.id}`);
  assert.equal(withoutForce.status, 409);
  assert.equal(withoutForce.body.childFolderCount, 2);
  assert.equal(withoutForce.body.noteCount, 2);

  const withForce = await client.delete(`/api/homenotes/note-folders/${root.body.folder.id}?force=true`);
  assert.equal(withForce.status, 200);
  assert.equal(withForce.body.notesTrashed, 2);

  const allFolders = await client.get("/api/homenotes/note-folders/all");
  assert.equal(allFolders.body.folders.length, 0);

  const trash = await client.get("/api/homenotes/notes/trash");
  assert.ok(trash.body.notes.some((n) => n.id === noteInLeaf.body.note.id));
  assert.ok(trash.body.notes.some((n) => n.id === noteInRoot.body.note.id));

  // Restoring afterward should work cleanly too — the note lost its
  // folder reference (the folder is gone), not its content.
  const restore = await client.post(`/api/homenotes/notes/${noteInLeaf.body.note.id}/restore`);
  assert.equal(restore.status, 200);
  const restored = await client.get(`/api/homenotes/notes/${noteInLeaf.body.note.id}`);
  assert.equal(restored.body.note.folderId, null);
  assert.equal(restored.body.note.title, "Deeply nested note");
});
