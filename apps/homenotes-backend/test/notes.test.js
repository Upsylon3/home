const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerHomeNotesUser } = require("./helpers/client");

let homenotesUrl, homecloud;

before(async () => {
  const started = await startTestApp();
  homenotesUrl = started.baseUrl;
  homecloud = started.homecloud;
});

after(async () => {
  await stopTestApp();
});

function register(overrides) {
  return registerHomeNotesUser(homecloud, homenotesUrl, overrides);
}

test("note routes require auth", async () => {
  const res = await makeClient(homenotesUrl).get("/api/homenotes/notes");
  assert.equal(res.status, 401);
});

test("create defaults title to Untitled, defaults content to empty", async () => {
  const { client } = await register({ username: "note_defaults_user" });
  const res = await client.post("/api/homenotes/notes", {});
  assert.equal(res.status, 201);
  assert.equal(res.body.note.title, "Untitled");
  assert.equal(res.body.note.content, "");
});

test("create rejects a nonexistent folder", async () => {
  const { client } = await register({ username: "note_create_badfolder_user" });
  const res = await client.post("/api/homenotes/notes", { title: "X", folderId: 999999 });
  assert.equal(res.status, 404);
});

test("get, update via PATCH (partial fields only touch what's provided), and excerpt strips Markdown", async () => {
  const { client } = await register({ username: "note_update_user" });
  const create = await client.post("/api/homenotes/notes", {
    title: "Recipe",
    content: "# Heading\n\nSome **bold** text about *pasta*."
  });
  const id = create.body.note.id;

  const list = await client.get("/api/homenotes/notes");
  const summary = list.body.notes.find((n) => n.id === id);
  assert.ok(summary);
  assert.ok(!summary.excerpt.includes("#"));
  assert.ok(!summary.excerpt.includes("**"));

  const patchTitleOnly = await client.patch(`/api/homenotes/notes/${id}`, { title: "Renamed Recipe" });
  assert.equal(patchTitleOnly.status, 200);
  assert.equal(patchTitleOnly.body.note.title, "Renamed Recipe");
  assert.equal(patchTitleOnly.body.note.content, "# Heading\n\nSome **bold** text about *pasta*.");

  const get = await client.get(`/api/homenotes/notes/${id}`);
  assert.equal(get.body.note.title, "Renamed Recipe");
});

test("favorite toggling via PATCH, and favorite=true filter", async () => {
  const { client } = await register({ username: "note_favorite_user" });
  const a = await client.post("/api/homenotes/notes", { title: "Fav me" });
  const b = await client.post("/api/homenotes/notes", { title: "Not fav" });

  await client.patch(`/api/homenotes/notes/${a.body.note.id}`, { isFavorite: true });

  const favorites = await client.get("/api/homenotes/notes?favorite=true");
  assert.equal(favorites.body.notes.length, 1);
  assert.equal(favorites.body.notes[0].id, a.body.note.id);
  assert.ok(b.body.note.id); // sanity: b was created fine, just not favorited
});

test("folder filter 404s for a nonexistent folder, otherwise scopes correctly", async () => {
  const { client } = await register({ username: "note_folder_filter_user" });
  const folder = await client.post("/api/homenotes/note-folders", { name: "Scoped" });
  await client.post("/api/homenotes/notes", { title: "In folder", folderId: folder.body.folder.id });
  await client.post("/api/homenotes/notes", { title: "Not in folder" });

  const badFolder = await client.get("/api/homenotes/notes?folderId=999999");
  assert.equal(badFolder.status, 404);

  const scoped = await client.get(`/api/homenotes/notes?folderId=${folder.body.folder.id}`);
  assert.equal(scoped.body.notes.length, 1);
  assert.equal(scoped.body.notes[0].title, "In folder");
});

test("search matches title and content", async () => {
  const { client } = await register({ username: "note_search_user" });
  await client.post("/api/homenotes/notes", { title: "Sourdough starter", content: "Feed daily." });
  await client.post("/api/homenotes/notes", { title: "Unrelated", content: "Mentions sourdough only in the body." });
  await client.post("/api/homenotes/notes", { title: "Completely different", content: "Nothing relevant here." });

  const byTitle = await client.get("/api/homenotes/notes?search=starter");
  assert.equal(byTitle.body.notes.length, 1);

  const byContent = await client.get("/api/homenotes/notes?search=sourdough");
  assert.equal(byContent.body.notes.length, 2);
});

test("tags: setting tags on create and update, tag filter, GET /tags shows counts, case-insensitive reuse", async () => {
  const { client } = await register({ username: "note_tags_user" });
  const a = await client.post("/api/homenotes/notes", { title: "A", tags: ["Cooking", "quick"] });
  const b = await client.post("/api/homenotes/notes", { title: "B", tags: ["cooking"] }); // same tag, different case

  const tagsList = await client.get("/api/homenotes/tags");
  const cookingTag = tagsList.body.tags.find((t) => t.name.toLowerCase() === "cooking");
  assert.ok(cookingTag, "expected one 'cooking' tag, not two differently-cased ones");
  assert.equal(cookingTag.noteCount, 2);

  const filtered = await client.get("/api/homenotes/notes?tag=cooking");
  assert.equal(filtered.body.notes.length, 2);

  // Updating tags replaces the set rather than appending to it.
  await client.patch(`/api/homenotes/notes/${a.body.note.id}`, { tags: ["quick"] });
  const afterUpdate = await client.get(`/api/homenotes/notes/${a.body.note.id}`);
  assert.deepEqual(afterUpdate.body.note.tags, ["quick"]);

  const cookingAfter = (await client.get("/api/homenotes/tags")).body.tags.find((t) => t.name.toLowerCase() === "cooking");
  assert.equal(cookingAfter.noteCount, 1); // only b has it now
  assert.ok(b.body.note.id);
});

test("trash lifecycle: delete, appears in trash, restore, permanent delete", async () => {
  const { client } = await register({ username: "note_trash_user" });
  const note = await client.post("/api/homenotes/notes", { title: "Temp" });
  const id = note.body.note.id;

  const del = await client.delete(`/api/homenotes/notes/${id}`);
  assert.equal(del.status, 200);

  const listAfterDelete = await client.get("/api/homenotes/notes");
  assert.equal(listAfterDelete.body.notes.some((n) => n.id === id), false);

  const trash = await client.get("/api/homenotes/notes/trash");
  assert.ok(trash.body.notes.some((n) => n.id === id));

  // A trashed note can't be edited until restored.
  const editWhileTrashed = await client.patch(`/api/homenotes/notes/${id}`, { title: "Nope" });
  assert.equal(editWhileTrashed.status, 404);

  const restore = await client.post(`/api/homenotes/notes/${id}/restore`);
  assert.equal(restore.status, 200);

  const listAfterRestore = await client.get("/api/homenotes/notes");
  assert.ok(listAfterRestore.body.notes.some((n) => n.id === id));

  await client.delete(`/api/homenotes/notes/${id}`);
  const permanent = await client.delete(`/api/homenotes/notes/${id}/permanent`);
  assert.equal(permanent.status, 200);

  const trashAfterPurge = await client.get("/api/homenotes/notes/trash");
  assert.equal(trashAfterPurge.body.notes.some((n) => n.id === id), false);
});

test("version history: a snapshot is taken before a content/title change, and restoring a version snapshots the current state first", async () => {
  const { client } = await register({ username: "note_version_user" });
  const note = await client.post("/api/homenotes/notes", { title: "Draft v1", content: "First draft." });
  const id = note.body.note.id;

  // No versions exist yet — nothing has changed since creation.
  const initialVersions = await client.get(`/api/homenotes/notes/${id}/versions`);
  assert.equal(initialVersions.body.versions.length, 0);

  const edit = await client.patch(`/api/homenotes/notes/${id}`, { content: "Second draft, edited." });
  assert.equal(edit.status, 200);

  const afterEdit = await client.get(`/api/homenotes/notes/${id}/versions`);
  assert.equal(afterEdit.body.versions.length, 1);
  assert.equal(afterEdit.body.versions[0].content, "First draft."); // the snapshot captured the PRE-edit state

  const versionId = afterEdit.body.versions[0].id;
  const restore = await client.post(`/api/homenotes/notes/${id}/versions/${versionId}/restore`);
  assert.equal(restore.status, 200);
  assert.equal(restore.body.note.content, "First draft.");

  // Restoring itself created a fresh snapshot of what was live just before
  // the restore, so nothing is lost even from that action.
  const afterRestore = await client.get(`/api/homenotes/notes/${id}/versions`);
  assert.equal(afterRestore.body.versions.length, 2);
  assert.ok(afterRestore.body.versions.some((v) => v.content === "Second draft, edited."));
});

test("versions and note detail are isolated per user", async () => {
  const owner = await register({ username: "note_version_owner" });
  const stranger = await register({ username: "note_version_stranger" });
  const note = await owner.client.post("/api/homenotes/notes", { title: "Private", content: "Secret." });

  const strangerGet = await stranger.client.get(`/api/homenotes/notes/${note.body.note.id}`);
  assert.equal(strangerGet.status, 404);

  const strangerVersions = await stranger.client.get(`/api/homenotes/notes/${note.body.note.id}/versions`);
  assert.equal(strangerVersions.status, 404);
});

test("attachments: upload a new file straight through to HomeCloud, list it, remove the reference without deleting the file", async () => {
  const { client, token } = await register({ username: "note_attachment_user" });
  const note = await client.post("/api/homenotes/notes", { title: "With an attachment" });
  const id = note.body.note.id;

  const form = new FormData();
  form.append("file", new Blob(["attachment bytes"], { type: "text/plain" }), "receipt.txt");
  const upload = await client.post(`/api/homenotes/notes/${id}/attachments`, form, { raw: true });
  assert.equal(upload.status, 201);
  assert.ok(upload.body.fileId);

  const detail = await client.get(`/api/homenotes/notes/${id}`);
  assert.equal(detail.body.note.attachments.length, 1);
  assert.equal(detail.body.note.attachments[0].fileId, upload.body.fileId);

  const remove = await client.delete(`/api/homenotes/notes/${id}/attachments/${upload.body.fileId}`);
  assert.equal(remove.status, 200);

  const detailAfter = await client.get(`/api/homenotes/notes/${id}`);
  assert.equal(detailAfter.body.note.attachments.length, 0);

  // The underlying HomeCloud file itself is untouched by removing the
  // reference — confirmed by downloading it directly from HomeCloud.
  const homecloudClient = makeClient(homecloud.baseUrl);
  homecloudClient.setToken(token);
  const stillThere = await homecloudClient.get(`/api/files/${upload.body.fileId}/download`);
  assert.equal(stillThere.status, 200);
  assert.equal(Buffer.from(stillThere.body).toString("utf8"), "attachment bytes");
});

test("attachments: linking an existing HomeCloud file works; a made-up file id is rejected", async () => {
  const { client, token } = await register({ username: "note_attachment_link_user" });
  const homecloudClient = makeClient(homecloud.baseUrl);
  homecloudClient.setToken(token);

  const uploadForm = new FormData();
  uploadForm.append("file", new Blob(["already in homecloud"], { type: "text/plain" }), "existing.txt");
  const existing = await homecloudClient.post("/api/files/upload", uploadForm, { raw: true });
  assert.equal(existing.status, 201);

  const note = await client.post("/api/homenotes/notes", { title: "Linking existing files" });

  const link = await client.post(`/api/homenotes/notes/${note.body.note.id}/attachments/link`, {
    fileId: existing.body.file.id,
    name: existing.body.file.name
  });
  assert.equal(link.status, 201);

  const madeUp = await client.post(`/api/homenotes/notes/${note.body.note.id}/attachments/link`, {
    fileId: 999999,
    name: "fake.txt"
  });
  assert.equal(madeUp.status, 404);
});

test("attachments cannot be linked from another user's HomeCloud files", async () => {
  const owner = await register({ username: "note_attachment_owner" });
  const attacker = await register({ username: "note_attachment_attacker" });

  const homecloudOwnerClient = makeClient(homecloud.baseUrl);
  homecloudOwnerClient.setToken(owner.token);
  const uploadForm = new FormData();
  uploadForm.append("file", new Blob(["owner's private file"], { type: "text/plain" }), "private.txt");
  const ownerFile = await homecloudOwnerClient.post("/api/files/upload", uploadForm, { raw: true });

  const attackerNote = await attacker.client.post("/api/homenotes/notes", { title: "Attacker's note" });
  const attempt = await attacker.client.post(`/api/homenotes/notes/${attackerNote.body.note.id}/attachments/link`, {
    fileId: ownerFile.body.file.id,
    name: "private.txt"
  });
  assert.equal(attempt.status, 404);
});
