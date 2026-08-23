const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerHomeMediaUser } = require("./helpers/client");

let homemediaUrl, homecloud;

before(async () => {
  const started = await startTestApp();
  homemediaUrl = started.baseUrl;
  homecloud = started.homecloud;
});

after(async () => {
  await stopTestApp();
});

async function plainJpegBlob() {
  const buffer = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 50, g: 60, b: 70 } } })
    .jpeg()
    .toBuffer();
  return new Blob([buffer], { type: "image/jpeg" });
}

async function setUpUserWithPhotos(overrides, count = 2) {
  const { username, password, user, token } = await registerHomeMediaUser(homecloud, homemediaUrl, overrides);
  const client = makeClient(homemediaUrl);
  client.setToken(token);
  const homecloudClient = makeClient(homecloud.baseUrl);
  homecloudClient.setToken(token);

  const photos = [];
  for (let i = 0; i < count; i++) {
    const form = new FormData();
    form.append("file", await plainJpegBlob(), `photo-${i}.jpg`);
    // eslint-disable-next-line no-await-in-loop
    const res = await homecloudClient.post("/api/files/upload", form, { raw: true });
    photos.push(res.body.file);
  }
  return { username, password, user, token, client, homecloudClient, photos };
}

test("album routes require auth", async () => {
  const res = await makeClient(homemediaUrl).get("/api/homemedia/albums");
  assert.equal(res.status, 401);
});

test("create rejects an empty or overlong name", async () => {
  const { client } = await setUpUserWithPhotos({ username: "album_validate_user" }, 0);

  const empty = await client.post("/api/homemedia/albums", { name: "  " });
  assert.equal(empty.status, 400);

  const tooLong = await client.post("/api/homemedia/albums", { name: "x".repeat(101) });
  assert.equal(tooLong.status, 400);
});

test("full album lifecycle: create, add items, set cover, list, rename, remove an item, delete", async () => {
  const { client, photos } = await setUpUserWithPhotos({ username: "album_lifecycle_user" }, 2);

  const create = await client.post("/api/homemedia/albums", { name: "Summer Trip" });
  assert.equal(create.status, 201);
  assert.equal(create.body.album.itemCount, 0);
  const albumId = create.body.album.id;

  const addBadInput = await client.post(`/api/homemedia/albums/${albumId}/items`, { fileIds: "not-an-array" });
  assert.equal(addBadInput.status, 400);

  const add = await client.post(`/api/homemedia/albums/${albumId}/items`, {
    fileIds: [photos[0].id, photos[1].id, 999999] // 999999 doesn't exist — should be silently skipped, not error
  });
  assert.equal(add.status, 200);
  assert.equal(add.body.added, 2);

  const badCover = await client.patch(`/api/homemedia/albums/${albumId}`, { coverFileId: 999999 });
  assert.equal(badCover.status, 400);

  const setCover = await client.patch(`/api/homemedia/albums/${albumId}`, { coverFileId: photos[0].id });
  assert.equal(setCover.status, 200);
  assert.equal(setCover.body.album.coverFileId, photos[0].id);

  const list = await client.get("/api/homemedia/albums");
  assert.equal(list.status, 200);
  const found = list.body.albums.find((a) => a.id === albumId);
  assert.equal(found.itemCount, 2);

  const inLibrary = await client.get(`/api/homemedia/library?albumId=${albumId}`);
  assert.equal(inLibrary.body.files.length, 2);

  const rename = await client.patch(`/api/homemedia/albums/${albumId}`, { name: "Renamed Trip" });
  assert.equal(rename.status, 200);
  assert.equal(rename.body.album.name, "Renamed Trip");

  // Removing the cover photo from the album clears the cover, rather than
  // leaving it pointing at something no longer in the album.
  const removeItem = await client.delete(`/api/homemedia/albums/${albumId}/items/${photos[0].id}`);
  assert.equal(removeItem.status, 200);
  const afterRemove = await client.get(`/api/homemedia/albums/${albumId}`);
  assert.equal(afterRemove.body.album.itemCount, 1);
  assert.equal(afterRemove.body.album.coverFileId, null);

  const del = await client.delete(`/api/homemedia/albums/${albumId}`);
  assert.equal(del.status, 200);
  const gone = await client.get(`/api/homemedia/albums/${albumId}`);
  assert.equal(gone.status, 404);
});

test("deleting an album never touches the underlying HomeCloud files", async () => {
  const { client, homecloudClient, photos } = await setUpUserWithPhotos({ username: "album_delete_safety_user" }, 1);
  const create = await client.post("/api/homemedia/albums", { name: "Temp Album" });
  await client.post(`/api/homemedia/albums/${create.body.album.id}/items`, { fileIds: [photos[0].id] });

  await client.delete(`/api/homemedia/albums/${create.body.album.id}`);

  const stillThere = await homecloudClient.get("/api/files/");
  assert.equal(stillThere.body.files.some((f) => f.id === photos[0].id), true);
});

test("albums are isolated per user", async () => {
  const owner = await setUpUserWithPhotos({ username: "album_owner" }, 0);
  const stranger = await setUpUserWithPhotos({ username: "album_stranger" }, 0);

  const create = await owner.client.post("/api/homemedia/albums", { name: "Owner's Album" });
  const strangerGet = await stranger.client.get(`/api/homemedia/albums/${create.body.album.id}`);
  assert.equal(strangerGet.status, 404);

  const strangerList = await stranger.client.get("/api/homemedia/albums");
  assert.equal(strangerList.body.albums.length, 0);
});

test("adding someone else's file id to your album is silently rejected, not an error", async () => {
  const owner = await setUpUserWithPhotos({ username: "album_add_owner" }, 1);
  const attacker = await setUpUserWithPhotos({ username: "album_add_attacker" }, 0);

  const create = await attacker.client.post("/api/homemedia/albums", { name: "Attacker Album" });
  const add = await attacker.client.post(`/api/homemedia/albums/${create.body.album.id}/items`, {
    fileIds: [owner.photos[0].id]
  });
  assert.equal(add.status, 200);
  assert.equal(add.body.added, 0); // fileExists() correctly refused it — nothing was actually added

  const check = await attacker.client.get(`/api/homemedia/albums/${create.body.album.id}`);
  assert.equal(check.body.album.itemCount, 0);
});
