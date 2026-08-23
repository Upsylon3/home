const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerUser } = require("./helpers/client");

let baseUrl;

before(async () => {
  ({ baseUrl } = await startTestApp());
});

after(async () => {
  await stopTestApp();
});

test("folder routes require auth", async () => {
  const res = await makeClient(baseUrl).get("/api/folders/");
  assert.equal(res.status, 401);
});

test("create rejects invalid names and duplicate names at the same level", async () => {
  const { client } = await registerUser(baseUrl);

  const empty = await client.post("/api/folders", { name: "" });
  assert.equal(empty.status, 400);

  const slash = await client.post("/api/folders", { name: "a/b" });
  assert.equal(slash.status, 400);

  const first = await client.post("/api/folders", { name: "Photos" });
  assert.equal(first.status, 201);

  const dupe = await client.post("/api/folders", { name: "photos" }); // case-insensitive
  assert.equal(dupe.status, 409);
});

test("list root folders, nested folders, and breadcrumb", async () => {
  const { client } = await registerUser(baseUrl);
  const top = await client.post("/api/folders", { name: "Top" });
  const child = await client.post("/api/folders", { name: "Child", parentId: top.body.folder.id });
  const grandchild = await client.post("/api/folders", { name: "Grandchild", parentId: child.body.folder.id });

  const rootList = await client.get("/api/folders/");
  assert.equal(rootList.body.folders.length, 1);
  assert.equal(rootList.body.breadcrumb.length, 0);

  const childList = await client.get(`/api/folders/?parentId=${top.body.folder.id}`);
  assert.equal(childList.body.folders.length, 1);
  assert.equal(childList.body.breadcrumb.length, 1);

  const grandchildList = await client.get(`/api/folders/?parentId=${child.body.folder.id}`);
  assert.equal(grandchildList.body.breadcrumb.length, 2);
  assert.equal(grandchildList.body.breadcrumb[0].name, "Top");
  assert.equal(grandchildList.body.breadcrumb[1].name, "Child");

  const all = await client.get("/api/folders/all");
  assert.equal(all.body.folders.length, 3);

  assert.equal(grandchild.status, 201); // sanity: creation itself succeeded
});

test("listing inside a nonexistent parent 404s", async () => {
  const { client } = await registerUser(baseUrl);
  const res = await client.get("/api/folders/?parentId=999999");
  assert.equal(res.status, 404);
});

test("rename: succeeds, rejects invalid names, rejects colliding with a sibling", async () => {
  const { client } = await registerUser(baseUrl);
  const a = await client.post("/api/folders", { name: "Alpha" });
  const b = await client.post("/api/folders", { name: "Beta" });

  const rename = await client.patch(`/api/folders/${b.body.folder.id}`, { name: "Beta Renamed" });
  assert.equal(rename.status, 200);

  const collide = await client.patch(`/api/folders/${b.body.folder.id}`, { name: "alpha" });
  assert.equal(collide.status, 409);

  const invalid = await client.patch(`/api/folders/${a.body.folder.id}`, { name: "bad/name" });
  assert.equal(invalid.status, 400);

  const notFound = await client.patch("/api/folders/999999", { name: "Whatever" });
  assert.equal(notFound.status, 404);
});

test("move: rejects a nonexistent destination and moving into one's own subtree", async () => {
  const { client } = await registerUser(baseUrl);
  const parent = await client.post("/api/folders", { name: "Parent" });
  const child = await client.post("/api/folders", { name: "Child", parentId: parent.body.folder.id });

  const badDest = await client.post(`/api/folders/${parent.body.folder.id}/move`, { parentId: 999999 });
  assert.equal(badDest.status, 404);

  const intoOwnChild = await client.post(`/api/folders/${parent.body.folder.id}/move`, {
    parentId: child.body.folder.id
  });
  assert.equal(intoOwnChild.status, 400);

  const toRoot = await client.post(`/api/folders/${child.body.folder.id}/move`, { parentId: null });
  assert.equal(toRoot.status, 200);
});

test("delete: empty folder removes cleanly; non-empty requires force and trashes its files", async () => {
  const { client } = await registerUser(baseUrl);
  const empty = await client.post("/api/folders", { name: "EmptyOne" });
  const delEmpty = await client.delete(`/api/folders/${empty.body.folder.id}`);
  assert.equal(delEmpty.status, 200);

  const withFile = await client.post("/api/folders", { name: "HasFile" });
  const form = new FormData();
  form.append("file", new Blob(["contents"], { type: "text/plain" }), "note.txt");
  form.append("folderId", String(withFile.body.folder.id));
  const upload = await client.post("/api/files/upload", form, { raw: true });
  assert.equal(upload.status, 201);

  const withoutForce = await client.delete(`/api/folders/${withFile.body.folder.id}`);
  assert.equal(withoutForce.status, 409);
  assert.equal(withoutForce.body.fileCount, 1);

  const withForce = await client.delete(`/api/folders/${withFile.body.folder.id}?force=true`);
  assert.equal(withForce.status, 200);
  assert.equal(withForce.body.filesTrashed, 1);

  // The file itself should now be in trash, not gone entirely.
  const trash = await client.get("/api/files/trash");
  assert.equal(trash.body.files.some((f) => f.id === upload.body.file.id), true);
});

test("folders are isolated per user", async () => {
  const owner = await registerUser(baseUrl);
  const stranger = await registerUser(baseUrl);

  const folder = await owner.client.post("/api/folders", { name: "OwnersOnly" });
  const strangerRename = await stranger.client.patch(`/api/folders/${folder.body.folder.id}`, { name: "Hijacked" });
  assert.equal(strangerRename.status, 404);

  const strangerList = await stranger.client.get("/api/folders/");
  assert.equal(strangerList.body.folders.length, 0);
});
