const crypto = require("crypto");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerHomeSyncUser } = require("./helpers/client");

let homesyncUrl, homecloud;

before(async () => {
  const started = await startTestApp();
  homesyncUrl = started.baseUrl;
  homecloud = started.homecloud;
});

after(async () => {
  await stopTestApp();
});

function hashOf(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function setUpUserWithDevice(overrides) {
  const media = await registerHomeSyncUser(homecloud, homesyncUrl, overrides);
  const homecloudClient = makeClient(homecloud.baseUrl);
  homecloudClient.setToken(media.token);
  const deviceRes = await media.client.post("/api/homesync/devices", { name: "Test Phone" });
  return { ...media, homecloudClient, deviceId: deviceRes.body.device.id };
}

function uploadForm({ content, filename = "photo.jpg", deviceId, category = "Photos", contentHash, capturedAt }) {
  const form = new FormData();
  form.append("file", new Blob([content], { type: "image/jpeg" }), filename);
  form.append("deviceId", String(deviceId));
  form.append("category", category);
  form.append("contentHash", contentHash || hashOf(content));
  if (capturedAt) form.append("capturedAt", capturedAt);
  return form;
}

test("sync routes require auth", async () => {
  const res = await makeClient(homesyncUrl).post("/api/homesync/check", { files: [{ hash: "abc" }] });
  assert.equal(res.status, 401);
});

test("check: validates input and correctly reports which hashes are new vs already synced", async () => {
  const { client, deviceId } = await setUpUserWithDevice({ username: "sync_check_user" });

  const badInput = await client.post("/api/homesync/check", { files: [] });
  assert.equal(badInput.status, 400);

  const tooMany = await client.post("/api/homesync/check", {
    files: Array.from({ length: 501 }, (_, i) => ({ hash: `h${i}` }))
  });
  assert.equal(tooMany.status, 400);

  const content = "some photo bytes";
  const hash = hashOf(content);

  const beforeUpload = await client.post("/api/homesync/check", { files: [{ hash }] });
  assert.equal(beforeUpload.status, 200);
  assert.equal(beforeUpload.body.results[0].alreadySynced, false);

  const form = uploadForm({ content, deviceId, contentHash: hash });
  const upload = await client.post("/api/homesync/upload", form, { raw: true });
  assert.equal(upload.status, 201);

  const afterUpload = await client.post("/api/homesync/check", { files: [{ hash }, { hash: "different-hash" }] });
  assert.equal(afterUpload.body.results.find((r) => r.hash === hash).alreadySynced, true);
  assert.equal(afterUpload.body.results.find((r) => r.hash === "different-hash").alreadySynced, false);
});

test("upload: validates device, category, and required fields", async () => {
  const { client, deviceId } = await setUpUserWithDevice({ username: "sync_upload_validate_user" });

  const noFile = await client.post("/api/homesync/upload", new FormData(), { raw: true });
  assert.equal(noFile.status, 400);

  const badDevice = await client.post(
    "/api/homesync/upload",
    uploadForm({ content: "x", deviceId: 999999 }),
    { raw: true }
  );
  assert.equal(badDevice.status, 400);

  const badCategory = await client.post(
    "/api/homesync/upload",
    uploadForm({ content: "x", deviceId, category: "Music" }),
    { raw: true }
  );
  assert.equal(badCategory.status, 400);
});

test("upload: lands the file in HomeCloud under Category/Year/Month, creating folders as needed", async () => {
  const { client, homecloudClient, deviceId } = await setUpUserWithDevice({ username: "sync_folder_user" });

  const form = uploadForm({
    content: "a real photo",
    deviceId,
    category: "Photos",
    capturedAt: "2026-08-14T12:00:00.000Z"
  });
  const res = await client.post("/api/homesync/upload", form, { raw: true });
  assert.equal(res.status, 201);
  assert.equal(res.body.deduped, false);
  assert.ok(res.body.homecloudFileId);
  assert.ok(res.body.folderId);

  const folders = await homecloudClient.get("/api/folders/all");
  const photosFolder = folders.body.folders.find((f) => f.name === "Photos" && f.parentId === null);
  assert.ok(photosFolder, "expected a top-level Photos folder to have been created");
  const yearFolder = folders.body.folders.find((f) => f.name === "2026" && f.parentId === photosFolder.id);
  assert.ok(yearFolder, "expected a 2026 folder inside Photos");
  const monthFolder = folders.body.folders.find((f) => f.name === "August" && f.parentId === yearFolder.id);
  assert.ok(monthFolder, "expected an August folder inside 2026");
  assert.equal(res.body.folderId, monthFolder.id);

  // The actual file is really there, with the real content — this went
  // through HomeCloud's real upload endpoint, not just a database row.
  const download = await homecloudClient.get(`/api/files/${res.body.homecloudFileId}/download`);
  assert.equal(download.status, 200);
  assert.equal(Buffer.from(download.body).toString("utf8"), "a real photo");
});

test("uploading the same content twice is idempotent — no duplicate file in HomeCloud", async () => {
  const { client, homecloudClient, deviceId } = await setUpUserWithDevice({ username: "sync_idempotent_user" });
  const content = "duplicate-prone content";

  const first = await client.post("/api/homesync/upload", uploadForm({ content, deviceId }), { raw: true });
  assert.equal(first.status, 201);
  assert.equal(first.body.deduped, false);

  const second = await client.post("/api/homesync/upload", uploadForm({ content, deviceId }), { raw: true });
  assert.equal(second.status, 200);
  assert.equal(second.body.deduped, true);
  assert.equal(second.body.homecloudFileId, first.body.homecloudFileId);

  const list = await homecloudClient.get("/api/files/all");
  const matching = list.body.files.filter((f) => f.id === first.body.homecloudFileId);
  assert.equal(matching.length, 1);
});

test("a second device backing up the same photo also gets deduped against the first device's upload", async () => {
  const owner = await setUpUserWithDevice({ username: "sync_multi_device_user" });
  const secondDeviceRes = await owner.client.post("/api/homesync/devices", { name: "Second Phone" });
  const secondDeviceId = secondDeviceRes.body.device.id;

  const content = "shared photo, two phones";
  const first = await owner.client.post(
    "/api/homesync/upload",
    uploadForm({ content, deviceId: owner.deviceId }),
    { raw: true }
  );
  assert.equal(first.body.deduped, false);

  const second = await owner.client.post(
    "/api/homesync/upload",
    uploadForm({ content, deviceId: secondDeviceId }),
    { raw: true }
  );
  assert.equal(second.body.deduped, true);
  assert.equal(second.body.homecloudFileId, first.body.homecloudFileId);
});

test("history: reflects uploads with correct totals, matching what the app's summary card needs", async () => {
  const { client, deviceId } = await setUpUserWithDevice({ username: "sync_history_user" });

  const empty = await client.get("/api/homesync/history");
  assert.equal(empty.body.summary.fileCount, 0);
  assert.equal(empty.body.summary.totalBytes, 0);

  const contentA = "history file A......"; // 21 bytes
  const contentB = "history file B longer content"; // 30 bytes
  await client.post("/api/homesync/upload", uploadForm({ content: contentA, deviceId }), { raw: true });
  await client.post("/api/homesync/upload", uploadForm({ content: contentB, deviceId }), { raw: true });

  const history = await client.get("/api/homesync/history");
  assert.equal(history.status, 200);
  assert.equal(history.body.summary.fileCount, 2);
  assert.equal(history.body.summary.totalBytes, contentA.length + contentB.length);
  assert.ok(history.body.summary.lastSyncedAt);
  assert.equal(history.body.files.length, 2);
  assert.equal(history.body.files[0].deviceName, "Test Phone");
});

test("sync data is isolated per user", async () => {
  const owner = await setUpUserWithDevice({ username: "sync_isolation_owner" });
  const stranger = await setUpUserWithDevice({ username: "sync_isolation_stranger" });

  await owner.client.post("/api/homesync/upload", uploadForm({ content: "owner only", deviceId: owner.deviceId }), {
    raw: true
  });

  const strangerHistory = await stranger.client.get("/api/homesync/history");
  assert.equal(strangerHistory.body.summary.fileCount, 0);

  const strangerCheck = await stranger.client.post("/api/homesync/check", {
    files: [{ hash: hashOf("owner only") }]
  });
  assert.equal(strangerCheck.body.results[0].alreadySynced, false);
});
