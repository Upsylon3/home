// Covers what was added when HomeMedia learned to upload, play music, show
// GIFs and actually stream video: the library's handling of every media
// type, uploading through HomeMedia, and the ticket-based streaming that
// replaced "download the whole file into the browser first".
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerHomeMediaUser } = require("./helpers/client");

let homemediaUrl, homecore, homecloudBackend;

// A genuine 1x1 GIF, so HomeCloud's thumbnailer has something valid to read.
const TINY_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

before(async () => {
  const started = await startTestApp();
  homemediaUrl = started.baseUrl;
  homecore = started.homecore;
  homecloudBackend = started.homecloudBackend;
});

after(async () => {
  await stopTestApp();
});

async function newUser(username) {
  const media = await registerHomeMediaUser(homecore, homemediaUrl, { username });
  const homecloud = makeClient(homecloudBackend.baseUrl);
  homecloud.setToken(media.token);
  return { ...media, homecloud };
}

// Stores a file in HomeCloud directly (bypassing HomeMedia) so a test can
// control the exact mimetype HomeCloud records.
async function putInHomeCloud(homecloud, name, bytes, type) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), name);
  const res = await homecloud.post("/api/homecloud/files/upload", form, { raw: true });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.file;
}

test("library includes music, and the audio filter returns only music", async () => {
  const { client, homecloud } = await newUser("media_audio_user");
  await putInHomeCloud(homecloud, "song.mp3", "fake-mp3-bytes", "audio/mpeg");
  await putInHomeCloud(homecloud, "clip.mp4", "fake-mp4-bytes", "video/mp4");

  const all = await client.get("/api/homemedia/library");
  assert.deepEqual(all.body.files.map((f) => f.kind).sort(), ["audio", "video"]);

  const onlyAudio = await client.get("/api/homemedia/library?type=audio");
  assert.equal(onlyAudio.body.files.length, 1);
  assert.equal(onlyAudio.body.files[0].name, "song.mp3");
});

test("a media file HomeCloud stored as application/octet-stream is still recognised by its extension", async () => {
  const { client, homecloud } = await newUser("media_octet_user");
  // This is what a browser sends for formats it doesn't know (e.g. .flac on Windows).
  await putInHomeCloud(homecloud, "track.flac", "fake-flac", "application/octet-stream");
  await putInHomeCloud(homecloud, "report.pdf", "fake-pdf", "application/octet-stream");

  const res = await client.get("/api/homemedia/library");
  assert.equal(res.body.files.length, 1, "the .pdf must not be treated as media");
  assert.equal(res.body.files[0].name, "track.flac");
  assert.equal(res.body.files[0].kind, "audio");
});

test("animated GIFs are listed as photos", async () => {
  const { client, homecloud } = await newUser("media_gif_user");
  await putInHomeCloud(homecloud, "party.gif", TINY_GIF, "image/gif");
  const res = await client.get("/api/homemedia/library");
  assert.equal(res.body.files[0].kind, "image");
  assert.equal(res.body.files[0].mimetype, "image/gif");
});

test("exif on a music file answers null instead of failing", async () => {
  const { client, homecloud } = await newUser("media_audio_exif_user");
  const file = await putInHomeCloud(homecloud, "song.mp3", "fake-mp3", "audio/mpeg");
  const res = await client.get(`/api/homemedia/${file.id}/exif`);
  assert.equal(res.status, 200);
  assert.equal(res.body.exif, null);
});

test("upload through HomeMedia lands in HomeCloud's HomeMedia folder and shows in the library", async () => {
  const { client, homecloud } = await newUser("media_upload_user");

  const folder = await client.get("/api/homemedia/upload-folder");
  assert.equal(folder.status, 200);
  assert.ok(Number.isInteger(folder.body.folderId));
  // Asking twice must reuse the same folder, not create a second one.
  const again = await client.get("/api/homemedia/upload-folder");
  assert.equal(again.body.folderId, folder.body.folderId);

  const form = new FormData();
  form.append("folderId", String(folder.body.folderId));
  form.append("file", new Blob(["fake-song"], { type: "audio/mpeg" }), "uploaded.mp3");
  const up = await client.post("/api/homemedia/upload", form, { raw: true });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(up.body.file.name, "uploaded.mp3");

  const lib = await client.get("/api/homemedia/library");
  assert.equal(lib.body.files.length, 1);
  assert.equal(lib.body.files[0].folderId, folder.body.folderId);

  // And it is really in HomeCloud, not only in HomeMedia's view.
  const inCloud = await homecloud.get("/api/homecloud/files/all");
  assert.equal(inCloud.body.files.length, 1);
});

test("upload through HomeMedia needs a login and a multipart body", async () => {
  const anon = await makeClient(homemediaUrl).post("/api/homemedia/upload", new FormData(), { raw: true });
  assert.equal(anon.status, 401);

  const { client } = await newUser("media_upload_bad_user");
  const notMultipart = await client.post("/api/homemedia/upload", { hello: "world" });
  assert.equal(notMultipart.status, 400);
});

test("upload relays HomeCloud's own error message instead of inventing one", async () => {
  const { client } = await newUser("media_quota_user");
  // A folder that doesn't exist makes HomeCloud answer 404; seeing that exact status proves the answer is HomeCloud's.
  const form = new FormData();
  form.append("folderId", "999999");
  form.append("file", new Blob(["x"], { type: "image/png" }), "x.png");
  const res = await client.post("/api/homemedia/upload", form, { raw: true });
  assert.equal(res.status, 404);
});

test("streaming: a ticket plays the whole file with no login header, and supports seeking", async () => {
  const { client, homecloud } = await newUser("media_stream_user");
  const bytes = "0123456789abcdefghij";
  const file = await putInHomeCloud(homecloud, "movie.mp4", bytes, "video/mp4");

  const ticket = await client.post(`/api/homemedia/${file.id}/ticket`);
  assert.equal(ticket.status, 200);
  assert.match(ticket.body.url, /^\/api\/homemedia\/stream\//);

  // Plain fetch, NO Authorization header — exactly what a <video> tag does.
  const full = await fetch(`${homemediaUrl}${ticket.body.url}`);
  assert.equal(full.status, 200);
  assert.equal(await full.text(), bytes);
  assert.notEqual(full.headers.get("content-disposition")?.startsWith("attachment"), true);

  const slice = await fetch(`${homemediaUrl}${ticket.body.url}`, { headers: { Range: "bytes=5-9" } });
  assert.equal(slice.status, 206);
  assert.equal(slice.headers.get("content-range"), "bytes 5-9/20");
  assert.equal(await slice.text(), "56789");
});

test("streaming: a GIF is served as image/gif so it keeps animating", async () => {
  const { client, homecloud } = await newUser("media_stream_gif_user");
  const file = await putInHomeCloud(homecloud, "party.gif", TINY_GIF, "image/gif");
  const { body } = await client.post(`/api/homemedia/${file.id}/ticket`);
  const res = await fetch(`${homemediaUrl}${body.url}`);
  assert.equal(res.headers.get("content-type"), "image/gif");
});

test("streaming: tickets can't be forged, and can't be requested for someone else's file", async () => {
  const owner = await newUser("media_ticket_owner");
  const stranger = await newUser("media_ticket_stranger");
  const file = await putInHomeCloud(owner.homecloud, "private.mp3", "secret", "audio/mpeg");

  const forged = await fetch(`${homemediaUrl}/api/homemedia/stream/not-a-real-ticket`);
  assert.equal(forged.status, 404);

  const stolen = await stranger.client.post(`/api/homemedia/${file.id}/ticket`);
  assert.equal(stolen.status, 404);

  const noLogin = await makeClient(homemediaUrl).post(`/api/homemedia/${file.id}/ticket`);
  assert.equal(noLogin.status, 401);
});
