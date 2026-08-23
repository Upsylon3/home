const fs = require("fs");
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

async function uploadToHomeCloud(homecloudClient, { name = "photo.jpg", blob }) {
  const form = new FormData();
  form.append("file", blob, name);
  const res = await homecloudClient.post("/api/files/upload", form, { raw: true });
  assert.equal(res.status, 201, `upload failed: ${JSON.stringify(res.body)}`);
  return res.body.file;
}

async function plainJpegBlob() {
  const buffer = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg()
    .toBuffer();
  return new Blob([buffer], { type: "image/jpeg" });
}

// A real JPEG with real, custom EXIF tags baked in via sharp — a genuine
// round-trip fixture, not a hand-written byte string standing in for one.
async function jpegWithExifBlob() {
  const buffer = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 10, g: 10, b: 10 } } })
    .withMetadata({ exif: { IFD0: { Make: "HomeMedia Test Cameras", Model: "Test Model X100" } } })
    .jpeg()
    .toBuffer();
  return new Blob([buffer], { type: "image/jpeg" });
}

async function setUpUserWithUploads(overrides) {
  const media = await registerHomeMediaUser(homecloud, homemediaUrl, overrides);
  const homecloudClient = makeClient(homecloud.baseUrl);
  homecloudClient.setToken(media.token);
  return { ...media, homecloudClient };
}

test("GET /api/homemedia/health is public", async () => {
  const res = await makeClient(homemediaUrl).get("/api/homemedia/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ok");
});

test("library routes require auth, and a garbage token is rejected", async () => {
  const noToken = await makeClient(homemediaUrl).get("/api/homemedia/library");
  assert.equal(noToken.status, 401);

  const bad = makeClient(homemediaUrl);
  bad.setToken("not-a-real-token");
  const res = await bad.get("/api/homemedia/library");
  assert.equal(res.status, 401);
});

test("library merges HomeCloud's images and videos, ignoring other file types, filterable by type", async () => {
  const { client, homecloudClient } = await setUpUserWithUploads({ username: "media_library_user" });

  await uploadToHomeCloud(homecloudClient, { name: "photo.jpg", blob: await plainJpegBlob() });
  const textForm = new FormData();
  textForm.append("file", new Blob(["not media"], { type: "text/plain" }), "notes.txt");
  const textUpload = await homecloudClient.post("/api/files/upload", textForm, { raw: true });
  assert.equal(textUpload.status, 201);

  const all = await client.get("/api/homemedia/library");
  assert.equal(all.status, 200);
  assert.equal(all.body.files.length, 1);
  assert.equal(all.body.files[0].kind, "image");
  assert.equal(all.body.files[0].favorited, false);

  const onlyVideos = await client.get("/api/homemedia/library?type=video");
  assert.equal(onlyVideos.body.files.length, 0);

  const badType = await client.get("/api/homemedia/library?type=bogus");
  assert.equal(badType.status, 400);
});

test("library search filters by filename", async () => {
  const { client, homecloudClient } = await setUpUserWithUploads({ username: "media_search_user" });
  await uploadToHomeCloud(homecloudClient, { name: "sunset-beach.jpg", blob: await plainJpegBlob() });
  await uploadToHomeCloud(homecloudClient, { name: "mountain-hike.jpg", blob: await plainJpegBlob() });

  const res = await client.get("/api/homemedia/library?search=beach");
  assert.equal(res.body.files.length, 1);
  assert.equal(res.body.files[0].name, "sunset-beach.jpg");
});

test("each user only ever sees their own library through HomeMedia", async () => {
  const owner = await setUpUserWithUploads({ username: "media_owner" });
  const stranger = await setUpUserWithUploads({ username: "media_stranger" });
  await uploadToHomeCloud(owner.homecloudClient, { name: "private.jpg", blob: await plainJpegBlob() });

  const strangerView = await stranger.client.get("/api/homemedia/library");
  assert.equal(strangerView.body.files.length, 0);
});

test("favorites: toggle on, appears in favorite=true filter, toggle off", async () => {
  const { client, homecloudClient } = await setUpUserWithUploads({ username: "media_favorite_user" });
  const file = await uploadToHomeCloud(homecloudClient, { name: "fav.jpg", blob: await plainJpegBlob() });

  const notFound = await client.post("/api/homemedia/favorites/999999");
  assert.equal(notFound.status, 404);

  const fav = await client.post(`/api/homemedia/favorites/${file.id}`);
  assert.equal(fav.status, 200);
  assert.equal(fav.body.favorited, true);

  const filtered = await client.get("/api/homemedia/library?favorite=true");
  assert.equal(filtered.body.files.length, 1);
  assert.equal(filtered.body.files[0].id, file.id);

  const unfav = await client.delete(`/api/homemedia/favorites/${file.id}`);
  assert.equal(unfav.status, 200);
  assert.equal(unfav.body.favorited, false);

  const filteredAfter = await client.get("/api/homemedia/library?favorite=true");
  assert.equal(filteredAfter.body.files.length, 0);
});

test("exif: a file with no metadata returns null; a real embedded tag round-trips correctly and is cached", async () => {
  const { client, homecloudClient } = await setUpUserWithUploads({ username: "media_exif_user" });

  const plain = await uploadToHomeCloud(homecloudClient, { name: "plain.jpg", blob: await plainJpegBlob() });
  const plainExif = await client.get(`/api/homemedia/${plain.id}/exif`);
  assert.equal(plainExif.status, 200);
  assert.equal(plainExif.body.exif, null);

  const tagged = await uploadToHomeCloud(homecloudClient, { name: "tagged.jpg", blob: await jpegWithExifBlob() });
  const taggedExif = await client.get(`/api/homemedia/${tagged.id}/exif`);
  assert.equal(taggedExif.status, 200);
  assert.equal(taggedExif.body.exif.Make, "HomeMedia Test Cameras");
  assert.equal(taggedExif.body.exif.Model, "Test Model X100");

  // Second call hits the cache — same result either way.
  const cached = await client.get(`/api/homemedia/${tagged.id}/exif`);
  assert.deepEqual(cached.body.exif, taggedExif.body.exif);
});

test("exif for a nonexistent or someone else's file 404s", async () => {
  const owner = await setUpUserWithUploads({ username: "media_exif_owner" });
  const stranger = await setUpUserWithUploads({ username: "media_exif_stranger" });
  const file = await uploadToHomeCloud(owner.homecloudClient, { name: "mine.jpg", blob: await plainJpegBlob() });

  const strangerAttempt = await stranger.client.get(`/api/homemedia/${file.id}/exif`);
  assert.equal(strangerAttempt.status, 404);

  const madeUp = await owner.client.get("/api/homemedia/999999/exif");
  assert.equal(madeUp.status, 404);
});

test("thumbnail: generates and caches a larger gallery thumbnail for an image", async () => {
  const { client, homecloudClient } = await setUpUserWithUploads({ username: "media_thumb_user" });
  const file = await uploadToHomeCloud(homecloudClient, { name: "thumb.jpg", blob: await plainJpegBlob() });

  const res = await client.get(`/api/homemedia/${file.id}/thumbnail`);
  assert.equal(res.status, 200);
  const bytes = Buffer.from(res.body);
  assert.ok(bytes.length > 0);
  // A JPEG always starts with the 0xFFD8 SOI marker.
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1], 0xd8);

  // Not asserting on the exact cache path (internal detail) — just that a
  // second request still succeeds and returns real image bytes, whether
  // served from cache or regenerated.
  const second = await client.get(`/api/homemedia/${file.id}/thumbnail`);
  assert.equal(second.status, 200);
  assert.ok(Buffer.from(second.body).length > 0);
});

test("thumbnail for a non-image file 404s instead of erroring", async () => {
  const { client, homecloudClient } = await setUpUserWithUploads({ username: "media_thumb_textfile_user" });
  const form = new FormData();
  form.append("file", new Blob(["not an image"], { type: "text/plain" }), "notes.txt");
  const upload = await homecloudClient.post("/api/files/upload", form, { raw: true });

  const res = await client.get(`/api/homemedia/${upload.body.file.id}/thumbnail`);
  assert.equal(res.status, 404);
});
