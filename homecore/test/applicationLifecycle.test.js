const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerUser } = require("./helpers/client");
let context, admin;
before(async () => {
  context = await startTestApp({ installedApps: false });
  admin = await registerUser(context.baseUrl);
});
after(stopTestApp);

test("fresh server advertises trusted bundled manifests without implicitly installing apps", async () => {
  assert.deepEqual((await admin.client.get("/api/core/apps")).body.applications, []);
  const catalog = await admin.client.get("/api/core/app-catalog");
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.applications.length, 7);
  assert.ok(catalog.body.applications.every(app => !app.installed && !app.enabled && app.manifestVersion === 1));
  assert.deepEqual(catalog.body.applications.find(app => app.slug === "homenotes").dependencies, ["homecloud"]);
  const regular = await registerUser(context.baseUrl);
  assert.equal((await regular.client.post("/api/core/apps/homecloud/install", {})).status, 403);
  assert.equal((await makeClient(context.baseUrl).get("/api/core/app-catalog")).status, 401);
  assert.equal((await admin.client.post("/api/core/apps/unknown/install", {})).status, 404);
  assert.equal((await admin.client.post("/api/core/apps/homecloud/install", { permissions: ["users.manage"] })).status, 400);
  // New catalog discovery must not shadow a legacy custom app named catalog.
  assert.equal((await admin.client.post("/api/core/apps", { slug: "catalog", name: "Legacy catalog integration" })).status, 201);
  assert.equal((await admin.client.get("/api/core/apps/catalog")).body.application.name, "Legacy catalog integration");
  assert.equal((await admin.client.delete("/api/core/apps/catalog")).status, 200);
});

test("installation and enablement are separate atomic actions with dependency checks", async () => {
  assert.equal((await admin.client.post("/api/core/apps/homenotes/install", {})).status, 409);
  const competing = await Promise.all([1, 2].map(() => admin.client.post("/api/core/apps/homecloud/install", {})));
  assert.deepEqual(competing.map(result => result.status).sort(), [201, 409]);
  const cloud = competing.find(result => result.status === 201).body.application;
  assert.equal(cloud.enabled, false);
  assert.equal(cloud.baseUrl, "/cloud");
  assert.deepEqual(cloud.permissions, ["files.delete", "files.read", "files.share", "files.write"]);
  const notes = await admin.client.post("/api/core/apps/homenotes/install", {});
  assert.equal(notes.status, 201);
  assert.equal(notes.body.application.enabled, false);
  assert.equal((await admin.client.patch("/api/core/apps/homenotes", { enabled: true })).status, 409);
  assert.equal((await admin.client.patch("/api/core/apps/homecloud", { enabled: true })).status, 200);
  assert.equal((await admin.client.patch("/api/core/apps/homenotes", { enabled: true })).status, 200);
  const blocked = await admin.client.patch("/api/core/apps/homecloud", { enabled: false });
  assert.equal(blocked.status, 409);
  assert.equal((await admin.client.get("/api/core/apps/homecloud")).body.application.enabled, true);
});

test("uninstall survives startup, preserves IDs/history and requires explicit reinstall and enable", async () => {
  const original = (await admin.client.get("/api/core/apps/homenotes")).body.application;
  context.db.prepare("INSERT INTO hc_notifications (user_id, application_id, type, title) VALUES (?, ?, 'test', 'retained')")
    .run(admin.user.id, original.id);
  const regular = await registerUser(context.baseUrl);
  assert.equal((await regular.client.delete("/api/core/apps/homenotes")).status, 403);
  assert.equal((await admin.client.delete("/api/core/apps/homenotes")).body.dataPreserved, true);
  require("../src/homecore/seed").runSeed();
  assert.equal((await admin.client.get("/api/core/apps/homenotes")).status, 404);
  assert.equal((await admin.client.patch("/api/core/apps/homenotes", { enabled: true })).status, 404);
  const monitorRegistry = await fetch(context.baseUrl + "/internal/apps", { headers: { "X-Internal-Secret": context.internalSecret } });
  assert.ok(!(await monitorRegistry.json()).apps.some(app => app.slug === "homenotes"));
  assert.equal(context.db.prepare("SELECT application_id FROM hc_notifications WHERE title='retained'").get().application_id, original.id);
  const reinstalled = await admin.client.post("/api/core/apps/homenotes/install", {});
  assert.equal(reinstalled.body.application.id, original.id);
  assert.equal(reinstalled.body.application.enabled, false);
  assert.equal((await admin.client.patch("/api/core/apps/homenotes", { enabled: true })).status, 200);
  assert.ok(context.db.prepare("SELECT id FROM hc_activity_events WHERE event_type='homecore.application.uninstalled'").get());
});

test("uninstall permanently revokes existing automation consent across reinstall", async () => {
  for (const slug of ["homemonitor", "hometasks"]) {
    assert.equal((await admin.client.post(`/api/core/apps/${slug}/install`, {})).status, 201);
    assert.equal((await admin.client.patch(`/api/core/apps/${slug}`, { enabled: true })).status, 200);
  }
  const { createDelegationStore } = require("../src/homecore/delegationStore");
  const store = createDelegationStore(context.db);
  const grant = store.issue(admin.user.id, 0);
  const cap = grant.capabilities[0];
  assert.ok(store.verify(cap.token, cap.audience, cap.action));
  context.db.exec(`CREATE TEMP TRIGGER fail_uninstall BEFORE INSERT ON hc_activity_events
    WHEN NEW.event_type = 'homecore.application.uninstalled' BEGIN SELECT RAISE(ABORT, 'disposable audit failure'); END`);
  try {
    assert.equal((await admin.client.delete("/api/core/apps/hometasks")).status, 500);
    assert.equal((await admin.client.get("/api/core/apps/hometasks")).body.application.enabled, true);
    assert.ok(store.verify(cap.token, cap.audience, cap.action));
  } finally { context.db.exec("DROP TRIGGER fail_uninstall"); }
  assert.equal((await admin.client.delete("/api/core/apps/hometasks")).status, 200);
  assert.ok(context.db.prepare("SELECT id FROM hc_activity_events WHERE event_type='homecore.delegation.revoked' AND target_id=?").get(grant.grant.id));
  assert.equal(store.verify(cap.token, cap.audience, cap.action), null);
  assert.equal((await admin.client.post("/api/core/apps/hometasks/install", {})).status, 201);
  assert.equal((await admin.client.patch("/api/core/apps/hometasks", { enabled: true })).status, 200);
  assert.equal(store.verify(cap.token, cap.audience, cap.action), null);
});

test("legacy registrations migrate without changes or recreating missing apps", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "home-app-adoption-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = `
    const Database = require('better-sqlite3');
    const db = new Database(require('node:path').join(process.env.DATA_DIR, 'homecore.db'));
    db.exec("CREATE TABLE hc_applications (id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT, version TEXT, icon TEXT, base_url TEXT, health_url TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))");
    db.prepare("INSERT INTO hc_applications (id, slug, name, base_url, enabled) VALUES (42, 'homenotes', 'My notes', '/custom-notes', 0)").run();
    db.close();
    const core = require('./homecore/src/app');
    console.log(JSON.stringify(core.db.prepare('SELECT id, slug, name, base_url, installed, enabled FROM hc_applications').all()));
    core.db.close();
  `;
  const result = spawnSync(process.execPath, ["-e", script], { cwd: path.resolve(__dirname, "../.."), encoding: "utf8", timeout: 15_000,
    env: { ...process.env, DATA_DIR: root } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [{ id: 42, slug: "homenotes", name: "My notes", base_url: "/custom-notes", installed: 1, enabled: 0 }]);
});
