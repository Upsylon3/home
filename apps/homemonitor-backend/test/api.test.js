// Integration tests: the real HTTP API, behind real HomeCore logins.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerUser } = require("../../../homecore/test/helpers/client");

let ctx, admin, regular;

before(async () => {
  ctx = await startTestApp();
  // The first account registered in a fresh HomeCore is the admin.
  admin = await registerUser(ctx.homecore.baseUrl, { username: "mon_admin_user" });
  regular = await registerUser(ctx.homecore.baseUrl, { username: "mon_regular_user" });
});

after(async () => {
  await stopTestApp();
});

// A client for HomeCore itself (where the notification inbox lives).
const core = (user) => {
  const client = makeClient(ctx.homecore.baseUrl);
  client.setToken(user.token);
  return client;
};

const as = (user) => {
  const client = makeClient(ctx.baseUrl);
  if (user) client.setToken(user.token);
  return client;
};

test("health needs no login; everything else needs one", async () => {
  assert.equal((await as().get("/api/homemonitor/health")).status, 200);
  for (const route of ["status", "history", "disk-growth"]) {
    assert.equal((await as().get(`/api/homemonitor/${route}`)).status, 401, route);
  }
});

test("a signed-in non-admin is refused everywhere (403), with a clear message", async () => {
  for (const route of ["status", "history", "disk-growth"]) {
    const res = await as(regular).get(`/api/homemonitor/${route}`);
    assert.equal(res.status, 403, route);
    assert.match(res.body.error, /administrators only/i);
  }
});

test("an admin gets the full status snapshot", async () => {
  const res = await as(admin).get("/api/homemonitor/status");
  assert.equal(res.status, 200);
  assert.equal(res.body.system.cpuPercent, 12.5);
  assert.equal(res.body.system.memory.percent, 25);
  assert.equal(res.body.disks[0].label, "data");
  assert.equal(res.body.services[0].slug, "homecloud");
  assert.equal(res.body.backups.status, "ok");
  assert.deepEqual(res.body.alerts, []);
  assert.equal(res.body.alertsEnabled, true);
});

test("history returns saved samples, oldest first, and clamps the window", async () => {
  ctx.machine.at = Date.UTC(2026, 9, 9, 13, 0, 0);
  await ctx.monitor.tick();
  const res = await as(admin).get("/api/homemonitor/history?hours=24");
  assert.equal(res.status, 200);
  assert.equal(res.body.hours, 24);
  assert.ok(res.body.samples.length >= 1);
  assert.deepEqual(Object.keys(res.body.samples[0]).sort(), ["cpu", "disk", "memory", "rx", "t", "tx"]);

  assert.equal((await as(admin).get("/api/homemonitor/history?hours=9999")).body.hours, 48); // clamped
  assert.equal((await as(admin).get("/api/homemonitor/history?hours=abc")).body.hours, 24); // default
});

test("disk growth lists daily points, with a forecast only when there is enough history", async () => {
  const before = await as(admin).get("/api/homemonitor/disk-growth");
  assert.equal(before.status, 200);
  assert.equal(before.body.disks[0].forecast, null); // under 3 days of data so far

  // Pretend the disk has been filling by 2 GB a day for five days.
  for (let i = 0; i < 5; i += 1) {
    const day = new Date(Date.UTC(2026, 9, 4 + i)).toISOString().slice(0, 10);
    ctx.history.recordDiskDaily(day, [{ label: "data", usedBytes: (40 + 2 * i) * 1e9, totalBytes: 100e9 }]);
  }
  ctx.machine.at = Date.UTC(2026, 9, 9, 14, 0, 0);
  const after = await as(admin).get("/api/homemonitor/disk-growth?days=30");
  const disk = after.body.disks.find((d) => d.label === "data");
  // Six points now: Oct 4 to 8 above, plus today's reading from the earlier
  // test (50 GB). The line rises 2 GB a day, with 100 - 50 = 50 GB left.
  assert.equal(disk.forecast.daysUntilFull, 25);
  assert.ok(Math.abs(disk.forecast.bytesPerDay - 2e9) < 1e8);
});

test("end to end: a disk filling up becomes a notification in every admin's HomeCore inbox, once", async () => {
  ctx.machine.disk = 90;
  ctx.machine.at = Date.UTC(2026, 9, 9, 15, 0, 0);
  await ctx.monitor.tick(); // first bad reading
  await ctx.monitor.tick(); // second: the alert opens and HomeCore is told
  await ctx.monitor.tick(); // third: still bad, but no second notification

  const inbox = (await core(admin).get("/api/core/notifications")).body.notifications;
  const alerts = inbox.filter((n) => n.title === 'Disk "data" is 90% full');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].applicationSlug, "homemonitor");
  assert.equal(alerts[0].type, "alert");
  assert.deepEqual(alerts[0].data, { key: "disk:data", severity: "warning" });

  // The regular user never sees it.
  const regularInbox = (await core(regular).get("/api/core/notifications")).body.notifications;
  assert.equal(regularInbox.filter((n) => n.applicationSlug === "homemonitor").length, 0);

  // And the screen shows it as an active alert.
  const status = await as(admin).get("/api/homemonitor/status");
  assert.equal(status.body.alerts[0].key, "disk:data");

  // Free some space: a "Resolved" notice arrives.
  ctx.machine.disk = 40;
  await ctx.monitor.tick();
  const after = (await core(admin).get("/api/core/notifications")).body.notifications;
  assert.ok(after.some((n) => n.title === 'Resolved: Disk "data" is 90% full' && n.type === "alert-resolved"));
});

test("a wrong route under /api is a clean JSON 404", async () => {
  const res = await as(admin).get("/api/homemonitor/nope");
  assert.equal(res.status, 404);
});
