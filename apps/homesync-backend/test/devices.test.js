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

test("device routes require auth", async () => {
  const res = await makeClient(homesyncUrl).get("/api/homesync/devices");
  assert.equal(res.status, 401);
});

test("register rejects an empty or overlong name, defaults platform to android", async () => {
  const { client } = await registerHomeSyncUser(homecloud, homesyncUrl, { username: "device_validate_user" });

  const empty = await client.post("/api/homesync/devices", { name: "  " });
  assert.equal(empty.status, 400);

  const tooLong = await client.post("/api/homesync/devices", { name: "x".repeat(101) });
  assert.equal(tooLong.status, 400);

  const res = await client.post("/api/homesync/devices", { name: "Pixel 9" });
  assert.equal(res.status, 201);
  assert.equal(res.body.device.platform, "android");
  assert.equal(res.body.device.name, "Pixel 9");
});

test("list, and delete a device (which does not touch anything in HomeCloud)", async () => {
  const { client, homecloudClient } = await registerAndGetHomeCloudClient({ username: "device_lifecycle_user" });

  const create = await client.post("/api/homesync/devices", { name: "My Phone" });
  const deviceId = create.body.device.id;

  const list = await client.get("/api/homesync/devices");
  assert.equal(list.status, 200);
  assert.ok(list.body.devices.some((d) => d.id === deviceId));

  const del = await client.delete(`/api/homesync/devices/${deviceId}`);
  assert.equal(del.status, 200);

  const listAfter = await client.get("/api/homesync/devices");
  assert.equal(listAfter.body.devices.some((d) => d.id === deviceId), false);

  const deleteAgain = await client.delete(`/api/homesync/devices/${deviceId}`);
  assert.equal(deleteAgain.status, 404);
});

test("devices are isolated per user", async () => {
  const owner = await registerHomeSyncUser(homecloud, homesyncUrl, { username: "device_owner" });
  const stranger = await registerHomeSyncUser(homecloud, homesyncUrl, { username: "device_stranger" });

  const create = await owner.client.post("/api/homesync/devices", { name: "Owner's Phone" });
  const strangerDelete = await stranger.client.delete(`/api/homesync/devices/${create.body.device.id}`);
  assert.equal(strangerDelete.status, 404);

  const strangerList = await stranger.client.get("/api/homesync/devices");
  assert.equal(strangerList.body.devices.length, 0);
});

async function registerAndGetHomeCloudClient(overrides) {
  const media = await registerHomeSyncUser(homecloud, homesyncUrl, overrides);
  const homecloudClient = makeClient(homecloud.baseUrl);
  homecloudClient.setToken(media.token);
  return { ...media, homecloudClient };
}
