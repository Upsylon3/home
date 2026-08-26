// Adapted from homecore/test/files.test.js per MIGRATION_PLAN.md's Phase
// 2 — same assertions, same coverage, adapted for two real separate
// services instead of one merged one:
//   - /api/files -> /api/homecloud/files (this service's real prefix,
//     see app.js's comment on why that decision got made here in Phase 2
//     rather than staying deferred to Phase 5)
//   - registerUser(baseUrl) -> registerHomecloudBackendUser(homecore,
//     baseUrl) — registration happens against the real HomeCore instance,
//     the resulting token is used against this service
//   - the one /api/auth/me check now goes through a client pointed at
//     homecore.baseUrl, not this service's baseUrl — that route lives on
//     HomeCore, not here
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

// A tiny, valid 1x1 PNG — real enough for sharp to thumbnail successfully,
// small enough to keep tests fast.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function textFile(content) {
  return new Blob([content], { type: "text/plain" });
}

async function uploadFile(client, { name = "note.txt", content = "hello world", folderId, blob } = {}) {
  const form = new FormData();
  form.append("file", blob || textFile(content), name);
  if (folderId !== undefined) form.append("folderId", String(folderId));
  return client.post("/api/homecloud/files/upload", form, { raw: true });
}

test("files routes require auth", async () => {
  const res = await makeClient(baseUrl).get("/api/homecloud/files/");
  assert.equal(res.status, 401);
});

test("quota endpoint requires auth and starts at zero for a fresh account", async () => {
  const unauth = await makeClient(baseUrl).get("/api/homecloud/files/quota");
  assert.equal(unauth.status, 401);

  const { client } = await registerUser();
  const res = await client.get("/api/homecloud/files/quota");
  assert.equal(res.status, 200);
  assert.equal(res.body.usedBytes, 0);
  assert.ok(res.body.quotaBytes > 0);
});

test("upload requires an attached file", async () => {
  const { client } = await registerUser();
  const form = new FormData();
  const res = await client.post("/api/homecloud/files/upload", form, { raw: true });
  assert.equal(res.status, 400);
});

test("upload, list, download round-trip preserves bytes", async () => {
  const { client } = await registerUser();
  const content = "the quick brown fox jumps over the lazy dog";

  const up = await uploadFile(client, { name: "fox.txt", content });
  assert.equal(up.status, 201);
  assert.equal(up.body.file.name, "fox.txt");
  assert.equal(up.body.file.size, content.length);

  const list = await client.get("/api/homecloud/files/");
  assert.equal(list.status, 200);
  assert.equal(list.body.files.length, 1);
  assert.equal(list.body.files[0].id, up.body.file.id);

  const download = await client.get(`/api/homecloud/files/${up.body.file.id}/download`);
  assert.equal(download.status, 200);
  assert.equal(Buffer.from(download.body).toString("utf8"), content);
});

test("uploading into a nonexistent folder is rejected", async () => {
  const { client } = await registerUser();
  const res = await uploadFile(client, { folderId: 999999 });
  assert.equal(res.status, 404);
});

test("uploading into a real folder associates the file with it", async () => {
  const { client } = await registerUser();
  const folder = await client.post("/api/homecloud/folders", { name: "Documents" });
  assert.equal(folder.status, 201);

  const up = await uploadFile(client, { folderId: folder.body.folder.id });
  assert.equal(up.status, 201);

  const rootList = await client.get("/api/homecloud/files/");
  assert.equal(rootList.body.files.length, 0);

  const folderList = await client.get(`/api/homecloud/files/?folderId=${folder.body.folder.id}`);
  assert.equal(folderList.body.files.length, 1);
  assert.equal(folderList.body.breadcrumb.length, 1);
  assert.equal(folderList.body.breadcrumb[0].name, "Documents");
});

test("an image upload gets a thumbnail; a text upload does not", async () => {
  const { client } = await registerUser();

  const imgUp = await uploadFile(client, { name: "pic.png", blob: new Blob([PNG_1X1], { type: "image/png" }) });
  assert.equal(imgUp.status, 201);
  assert.equal(imgUp.body.file.hasThumbnail, true);

  const thumb = await client.get(`/api/homecloud/files/${imgUp.body.file.id}/thumbnail`);
  assert.equal(thumb.status, 200);
  assert.ok(Buffer.from(thumb.body).length > 0);

  const textUp = await uploadFile(client, { name: "plain.txt" });
  assert.equal(textUp.body.file.hasThumbnail, false);

  const noThumb = await client.get(`/api/homecloud/files/${textUp.body.file.id}/thumbnail`);
  assert.equal(noThumb.status, 404);
});

test("quota is enforced across uploads and the rejected upload isn't left on disk/quota", async () => {
  // The test app is started with QUOTA_BYTES = 2 MiB (see test/helpers/app.js).
  const { client } = await registerUser();
  const oneMbMinusABit = "a".repeat(1.4 * 1024 * 1024);

  const first = await uploadFile(client, { name: "big1.txt", content: oneMbMinusABit });
  assert.equal(first.status, 201);

  const second = await uploadFile(client, { name: "big2.txt", content: oneMbMinusABit });
  assert.equal(second.status, 413);

  // Usage lives on this service now, not HomeCore's /api/auth/me — see
  // files.js's /quota route comment for why that field is stale once
  // split. Usage should reflect only the first, successful upload — the
  // rejected one must not have been counted (or left on disk).
  const quota = await client.get("/api/homecloud/files/quota");
  assert.equal(quota.status, 200);
  assert.equal(quota.body.usedBytes, oneMbMinusABit.length);

  const list = await client.get("/api/homecloud/files/");
  assert.equal(list.body.files.length, 1);
});

test("users cannot see, download, or delete each other's files", async () => {
  const owner = await registerUser();
  const stranger = await registerUser();

  const up = await uploadFile(owner.client, { name: "private.txt" });
  assert.equal(up.status, 201);
  const fileId = up.body.file.id;

  const strangerList = await stranger.client.get("/api/homecloud/files/");
  assert.equal(strangerList.body.files.length, 0);

  const strangerDownload = await stranger.client.get(`/api/homecloud/files/${fileId}/download`);
  assert.equal(strangerDownload.status, 404);

  const strangerDelete = await stranger.client.delete(`/api/homecloud/files/${fileId}`);
  assert.equal(strangerDelete.status, 404);

  // The owner can still see it — proves the 404s above were an
  // authorization boundary, not the file actually being gone.
  const ownerList = await owner.client.get("/api/homecloud/files/");
  assert.equal(ownerList.body.files.length, 1);
});

test("move: relocates a file into a folder; rejects a nonexistent destination", async () => {
  const { client } = await registerUser();
  const up = await uploadFile(client);
  const folder = await client.post("/api/homecloud/folders", { name: "Archive" });

  const badMove = await client.post(`/api/homecloud/files/${up.body.file.id}/move`, { folderId: 999999 });
  assert.equal(badMove.status, 404);

  const goodMove = await client.post(`/api/homecloud/files/${up.body.file.id}/move`, { folderId: folder.body.folder.id });
  assert.equal(goodMove.status, 200);

  const folderList = await client.get(`/api/homecloud/files/?folderId=${folder.body.folder.id}`);
  assert.equal(folderList.body.files.length, 1);
});

test("trash lifecycle: delete, list in trash, restore, permanently delete", async () => {
  const { client } = await registerUser();
  const up = await uploadFile(client, { name: "temp.txt" });
  const id = up.body.file.id;

  const del = await client.delete(`/api/homecloud/files/${id}`);
  assert.equal(del.status, 200);

  const listAfterDelete = await client.get("/api/homecloud/files/");
  assert.equal(listAfterDelete.body.files.length, 0);

  const trash = await client.get("/api/homecloud/files/trash");
  assert.equal(trash.body.files.length, 1);
  assert.equal(trash.body.files[0].id, id);

  const restore = await client.post(`/api/homecloud/files/${id}/restore`);
  assert.equal(restore.status, 200);

  const listAfterRestore = await client.get("/api/homecloud/files/");
  assert.equal(listAfterRestore.body.files.length, 1);

  const del2 = await client.delete(`/api/homecloud/files/${id}`);
  assert.equal(del2.status, 200);

  const permanent = await client.delete(`/api/homecloud/files/${id}/permanent`);
  assert.equal(permanent.status, 200);

  const trashAfterPurge = await client.get("/api/homecloud/files/trash");
  assert.equal(trashAfterPurge.body.files.length, 0);

  // Even the owner can no longer restore something permanently deleted.
  const restoreGone = await client.post(`/api/homecloud/files/${id}/restore`);
  assert.equal(restoreGone.status, 404);
});

test("share link lifecycle: create, download, revoke", async () => {
  const { client } = await registerUser();
  const content = "shared content";
  const up = await uploadFile(client, { name: "shared.txt", content });

  const share = await client.post(`/api/homecloud/files/${up.body.file.id}/share`);
  assert.equal(share.status, 201);
  assert.ok(share.body.share.token);

  const anonDownload = await makeClient(baseUrl).get(`/api/share/${share.body.share.token}`);
  assert.equal(anonDownload.status, 200);
  assert.equal(Buffer.from(anonDownload.body).toString("utf8"), content);

  const revoke = await client.delete(`/api/homecloud/files/shares/${share.body.share.id}`);
  assert.equal(revoke.status, 200);

  const afterRevoke = await makeClient(baseUrl).get(`/api/share/${share.body.share.token}`);
  assert.equal(afterRevoke.status, 404);
});

test("share expiresInDays validation", async () => {
  const { client } = await registerUser();
  const up = await uploadFile(client);

  const tooBig = await client.post(`/api/homecloud/files/${up.body.file.id}/share`, { expiresInDays: 9999 });
  assert.equal(tooBig.status, 400);

  const negative = await client.post(`/api/homecloud/files/${up.body.file.id}/share`, { expiresInDays: -1 });
  assert.equal(negative.status, 400);

  const valid = await client.post(`/api/homecloud/files/${up.body.file.id}/share`, { expiresInDays: 7 });
  assert.equal(valid.status, 201);
  assert.ok(valid.body.share.expiresAt);
});

test("a share to a trashed file 404s, and works again once restored", async () => {
  const { client } = await registerUser();
  const up = await uploadFile(client, { name: "will_be_trashed.txt" });
  const share = await client.post(`/api/homecloud/files/${up.body.file.id}/share`);

  await client.delete(`/api/homecloud/files/${up.body.file.id}`);
  const whileTrashed = await makeClient(baseUrl).get(`/api/share/${share.body.share.token}`);
  assert.equal(whileTrashed.status, 404);

  await client.post(`/api/homecloud/files/${up.body.file.id}/restore`);
  const afterRestore = await makeClient(baseUrl).get(`/api/share/${share.body.share.token}`);
  assert.equal(afterRestore.status, 200);
});

test("download-batch: validates input and returns a real zip for valid ids", async () => {
  const { client } = await registerUser();
  const a = await uploadFile(client, { name: "a.txt", content: "AAA" });
  const b = await uploadFile(client, { name: "b.txt", content: "BBB" });

  const empty = await client.post("/api/homecloud/files/download-batch", { ids: [] });
  assert.equal(empty.status, 400);

  const nonInteger = await client.post("/api/homecloud/files/download-batch", { ids: [1.5] });
  assert.equal(nonInteger.status, 400);

  const tooMany = await client.post("/api/homecloud/files/download-batch", { ids: Array.from({ length: 501 }, (_, i) => i + 1) });
  assert.equal(tooMany.status, 400);

  const noneFound = await client.post("/api/homecloud/files/download-batch", { ids: [999999] });
  assert.equal(noneFound.status, 404);

  const ok = await client.post("/api/homecloud/files/download-batch", { ids: [a.body.file.id, b.body.file.id] });
  assert.equal(ok.status, 200);
  const bytes = Buffer.from(ok.body);
  // A real zip file always starts with the "PK" local-file-header signature.
  assert.equal(bytes.slice(0, 2).toString("ascii"), "PK");
  assert.ok(bytes.length > 0);
});

test("GET /api/homecloud/files/all: flat cross-folder listing, filterable by top-level mime type, isolated per user", async () => {
  const owner = await registerUser();
  const stranger = await registerUser();

  const folder = await owner.client.post("/api/homecloud/folders", { name: "Nested" });
  await uploadFile(owner.client, { name: "top.txt", content: "top level" });
  await uploadFile(owner.client, {
    name: "pic.png",
    folderId: folder.body.folder.id,
    blob: new Blob([PNG_1X1], { type: "image/png" })
  });

  const badType = await owner.client.get("/api/homecloud/files/all?type=bogus");
  assert.equal(badType.status, 400);

  const everything = await owner.client.get("/api/homecloud/files/all");
  assert.equal(everything.status, 200);
  assert.equal(everything.body.files.length, 2);
  assert.equal(everything.body.truncated, false);
  // Cross-folder: the nested image shows up without querying its folder.
  const nested = everything.body.files.find((f) => f.name === "pic.png");
  assert.equal(nested.folderId, folder.body.folder.id);

  const onlyImages = await owner.client.get("/api/homecloud/files/all?type=image");
  assert.equal(onlyImages.body.files.length, 1);
  assert.equal(onlyImages.body.files[0].name, "pic.png");

  const onlyVideos = await owner.client.get("/api/homecloud/files/all?type=video");
  assert.equal(onlyVideos.body.files.length, 0);

  // A second user's library is completely invisible here.
  const strangerView = await stranger.client.get("/api/homecloud/files/all");
  assert.equal(strangerView.body.files.length, 0);
});
