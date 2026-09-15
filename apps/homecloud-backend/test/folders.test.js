// Exercises this service's real /api/homecloud/folders routes
// end-to-end. See files.test.js's header comment for how registration
// and auth work in these tests; the same pattern applies here.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerHomecloudBackendUser } = require("./helpers/client");

let baseUrl, homecore;

before(async () => {
  ({ baseUrl, homecore } = await startTestApp());
});

after(async () => {
  await stopTestApp();
});

async function registerUser(overrides) {
  return registerHomecloudBackendUser(homecore, baseUrl, overrides);
}

test("folder routes require auth", async () => {
  const res = await makeClient(baseUrl).get("/api/homecloud/folders/");
  assert.equal(res.status, 401);
});

test("create rejects invalid names and duplicate names at the same level", async () => {
  const { client } = await registerUser();

  const empty = await client.post("/api/homecloud/folders", { name: "" });
  assert.equal(empty.status, 400);

  const slash = await client.post("/api/homecloud/folders", { name: "a/b" });
  assert.equal(slash.status, 400);

  const first = await client.post("/api/homecloud/folders", { name: "Photos" });
  assert.equal(first.status, 201);

  const dupe = await client.post("/api/homecloud/folders", { name: "photos" }); // case-insensitive
  assert.equal(dupe.status, 409);
});

test("list root folders, nested folders, and breadcrumb", async () => {
  const { client } = await registerUser();
  const top = await client.post("/api/homecloud/folders", { name: "Top" });
  const child = await client.post("/api/homecloud/folders", { name: "Child", parentId: top.body.folder.id });
  const grandchild = await client.post("/api/homecloud/folders", { name: "Grandchild", parentId: child.body.folder.id });

  const rootList = await client.get("/api/homecloud/folders/");
  assert.equal(rootList.body.folders.length, 1);
  assert.equal(rootList.body.breadcrumb.length, 0);

  const childList = await client.get(`/api/homecloud/folders/?parentId=${top.body.folder.id}`);
  assert.equal(childList.body.folders.length, 1);
  assert.equal(childList.body.breadcrumb.length, 1);

  const grandchildList = await client.get(`/api/homecloud/folders/?parentId=${child.body.folder.id}`);
  assert.equal(grandchildList.body.breadcrumb.length, 2);
  assert.equal(grandchildList.body.breadcrumb[0].name, "Top");
  assert.equal(grandchildList.body.breadcrumb[1].name, "Child");

  const all = await client.get("/api/homecloud/folders/all");
  assert.equal(all.body.folders.length, 3);

  assert.equal(grandchild.status, 201); // sanity: creation itself succeeded
});

test("listing inside a nonexistent parent 404s", async () => {
  const { client } = await registerUser();
  const res = await client.get("/api/homecloud/folders/?parentId=999999");
  assert.equal(res.status, 404);
});

test("rename: succeeds, rejects invalid names, rejects colliding with a sibling", async () => {
  const { client } = await registerUser();
  const a = await client.post("/api/homecloud/folders", { name: "Alpha" });
  const b = await client.post("/api/homecloud/folders", { name: "Beta" });

  const rename = await client.patch(`/api/homecloud/folders/${b.body.folder.id}`, { name: "Beta Renamed" });
  assert.equal(rename.status, 200);

  const collide = await client.patch(`/api/homecloud/folders/${b.body.folder.id}`, { name: "alpha" });
  assert.equal(collide.status, 409);

  const invalid = await client.patch(`/api/homecloud/folders/${a.body.folder.id}`, { name: "bad/name" });
  assert.equal(invalid.status, 400);

  const notFound = await client.patch("/api/homecloud/folders/999999", { name: "Whatever" });
  assert.equal(notFound.status, 404);
});

test("move: rejects a nonexistent destination and moving into one's own subtree", async () => {
  const { client } = await registerUser();
  const parent = await client.post("/api/homecloud/folders", { name: "Parent" });
  const child = await client.post("/api/homecloud/folders", { name: "Child", parentId: parent.body.folder.id });

  const badDest = await client.post(`/api/homecloud/folders/${parent.body.folder.id}/move`, { parentId: 999999 });
  assert.equal(badDest.status, 404);

  const intoOwnChild = await client.post(`/api/homecloud/folders/${parent.body.folder.id}/move`, {
    parentId: child.body.folder.id
  });
  assert.equal(intoOwnChild.status, 400);

  const toRoot = await client.post(`/api/homecloud/folders/${child.body.folder.id}/move`, { parentId: null });
  assert.equal(toRoot.status, 200);
});

test("delete: empty folder removes cleanly; non-empty requires force and trashes its files", async () => {
  const { client } = await registerUser();
  const empty = await client.post("/api/homecloud/folders", { name: "EmptyOne" });
  const delEmpty = await client.delete(`/api/homecloud/folders/${empty.body.folder.id}`);
  assert.equal(delEmpty.status, 200);

  const withFile = await client.post("/api/homecloud/folders", { name: "HasFile" });
  const form = new FormData();
  form.append("file", new Blob(["contents"], { type: "text/plain" }), "note.txt");
  form.append("folderId", String(withFile.body.folder.id));
  const upload = await client.post("/api/homecloud/files/upload", form, { raw: true });
  assert.equal(upload.status, 201);

  const withoutForce = await client.delete(`/api/homecloud/folders/${withFile.body.folder.id}`);
  assert.equal(withoutForce.status, 409);
  assert.equal(withoutForce.body.fileCount, 1);

  const withForce = await client.delete(`/api/homecloud/folders/${withFile.body.folder.id}?force=true`);
  assert.equal(withForce.status, 200);
  assert.equal(withForce.body.filesTrashed, 1);

  // The file itself should now be in trash, not gone entirely.
  const trash = await client.get("/api/homecloud/files/trash");
  assert.equal(trash.body.files.some((f) => f.id === upload.body.file.id), true);
});

// New as of a security review that asked whether ON DELETE CASCADE
// (folders.parent_id) actually does anything, since deleting only the
// root of a subtree (folders.js's DELETE /:id) relies entirely on it to
// remove every descendant. Checked directly (see db.js's foreign_keys
// pragma comment): this project's pinned better-sqlite3 already
// enforces foreign keys by default, so the cascade does work today —
// but there was no test proving that before this one, meaning a future
// change that broke it (a dependency downgrade, a differently-compiled
// SQLite build) would have gone unnoticed. This is what would actually
// catch that regression; checking the child id is genuinely gone from
// a full listing, not just unreachable through one particular path.
test("delete cascades to every descendant subfolder, not just the one deleted directly", async () => {
  const { client } = await registerUser();
  const top = await client.post("/api/homecloud/folders", { name: "CascadeTop" });
  const child = await client.post("/api/homecloud/folders", { name: "CascadeChild", parentId: top.body.folder.id });
  const grandchild = await client.post("/api/homecloud/folders", {
    name: "CascadeGrandchild",
    parentId: child.body.folder.id
  });

  const del = await client.delete(`/api/homecloud/folders/${top.body.folder.id}`);
  assert.equal(del.status, 200);

  const all = await client.get("/api/homecloud/folders/all");
  const remainingIds = all.body.folders.map((f) => f.id);
  assert.equal(remainingIds.includes(top.body.folder.id), false, "the deleted root must be gone");
  assert.equal(remainingIds.includes(child.body.folder.id), false, "the child must be gone too, via cascade");
  assert.equal(remainingIds.includes(grandchild.body.folder.id), false, "the grandchild must be gone too, via cascade");
});

test("folders are isolated per user", async () => {
  const owner = await registerUser();
  const stranger = await registerUser();

  const folder = await owner.client.post("/api/homecloud/folders", { name: "OwnersOnly" });
  const strangerRename = await stranger.client.patch(`/api/homecloud/folders/${folder.body.folder.id}`, { name: "Hijacked" });
  assert.equal(strangerRename.status, 404);

  const strangerList = await stranger.client.get("/api/homecloud/folders/");
  assert.equal(strangerList.body.folders.length, 0);
});
