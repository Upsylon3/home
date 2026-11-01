const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const notesHelper = require("../../../apps/homenotes-backend/test/helpers/app");
const tasksHelper = require("../../../apps/hometasks-backend/test/helpers/app");
const { makeClient, registerUser } = require("../../../homecore/test/helpers/client");

let notes, tasks, core, createApp, bridge;
async function listen(app) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
async function close(server) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
function app(options = {}) {
  return createApp({ homecoreUrl: core.baseUrl, notesUrl: notes.baseUrl, tasksUrl: tasks.baseUrl, ...options });
}
before(async () => {
  notes = await notesHelper.startTestApp();
  tasks = await tasksHelper.startTestApp();
  core = notes.homecore;
  ({ createApp } = require("../src/app"));
  bridge = await listen(app());
});
after(async () => {
  if (bridge) await close(bridge.server);
  try { await tasksHelper.stopTestApp(); } finally { await notesHelper.stopTestApp(); }
});
async function user() {
  const registered = await registerUser(core.baseUrl);
  const clients = {};
  for (const [name, url] of Object.entries({ bridge: bridge.url, notes: notes.baseUrl, tasks: tasks.baseUrl, core: core.baseUrl })) {
    clients[name] = makeClient(url);
    clients[name].setToken(registered.token);
  }
  return { ...registered, ...clients };
}
const search = (client, query = "trip", sources = ["homenotes", "hometasks"]) =>
  client.post("/api/homebridge/search", { query, sources });

test("health is public; searching requires a valid session and never caches results", async () => {
  const anon = makeClient(bridge.url);
  assert.equal((await anon.get("/api/homebridge/health")).status, 200);
  const denied = await search(anon);
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("cache-control"), "no-store");
  anon.setToken("not-a-session");
  assert.equal((await search(anon)).status, 401);
});

test("real services search only the caller's active notes and open/completed tasks", async () => {
  const alice = await user();
  const bob = await user();
  const note = await alice.notes.post("/api/homenotes/notes", { title: "Trip plan", content: "train booking" });
  const task = await alice.tasks.post("/api/hometasks/tasks", { title: "Trip tickets", notes: "Buy train seats" });
  const done = await alice.tasks.post("/api/hometasks/tasks", { title: "Trip passport" });
  await alice.tasks.post(`/api/hometasks/tasks/${done.body.task.id}/complete`);
  const trash = await alice.notes.post("/api/homenotes/notes", { title: "Trip trashed" });
  await alice.notes.delete(`/api/homenotes/notes/${trash.body.note.id}`);
  await bob.notes.post("/api/homenotes/notes", { title: "Trip private" });
  await bob.tasks.post("/api/hometasks/tasks", { title: "Trip private" });
  const res = await search(alice.bridge);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const [noteGroup, taskGroup] = res.body.groups;
  assert.equal(noteGroup.status, "ok");
  assert.deepEqual(noteGroup.results.map(item => item.id), [note.body.note.id]);
  assert.equal(noteGroup.results[0].href, `/notes/notes/${note.body.note.id}`);
  assert.deepEqual(taskGroup.results.map(item => item.id).sort(), [task.body.task.id, done.body.task.id].sort());
  assert.equal(taskGroup.results.find(item => item.id === done.body.task.id).href, `/tasks/done?task=${done.body.task.id}`);
  const empty = await search(alice.bridge, "nevermatchesanything");
  assert.ok(empty.body.groups.every(group => group.status === "ok" && group.results.length === 0));
});

test("selected sources only; validation rejects unknown sources, duplicates and invalid queries", async () => {
  const alice = await user();
  assert.equal((await search(alice.bridge, "trip", ["homenotes"])).body.groups.length, 1);
  for (const [query, sources] of [["x", ["homenotes"]], ["  ", ["homenotes"]], ["x".repeat(201), ["hometasks"]],
    ["trip", []], ["trip", ["homevault"]], ["trip", ["__proto__"]], ["trip", ["hometasks", "hometasks"]], [null, ["hometasks"]]]) {
    assert.equal((await search(alice.bridge, query, sources)).status, 400);
  }
});

test("an unchecked source receives no requests", async t => {
  const alice = await user();
  let hits = 0;
  const unselected = await listen((req, res) => { hits++; res.end(); });
  t.after(() => close(unselected.server));
  const instance = await listen(app({ tasksUrl: unselected.url }));
  t.after(() => close(instance.server));
  const client = makeClient(instance.url); client.setToken(alice.token);
  const res = await search(client, "trip", ["homenotes"]);
  assert.equal(res.status, 200);
  assert.equal(res.body.groups.length, 1);
  assert.equal(res.body.groups[0].status, "ok");
  assert.equal(hits, 0);
});

test("malformed and oversized request bodies return safe errors", async () => {
  const alice = await user();
  for (const [body, status] of [["{private broken json", 400], [JSON.stringify({ query: "private".repeat(1000) }), 413]]) {
    const res = await fetch(`${bridge.url}/api/homebridge/search`, {
      method: "POST", headers: { Authorization: `Bearer ${alice.token}`, "Content-Type": "application/json" }, body
    });
    assert.equal(res.status, status);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.ok(!(await res.text()).includes("private"));
  }
});

test("disabled or absent sources are not contacted, regardless of their registry URLs", async t => {
  const alice = await user();
  const admin = makeClient(core.baseUrl);
  // Grant admin only in the disposable identity database, to exercise the
  // real registry management API without relying on test ordering.
  core.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(alice.user.id);
  admin.setToken(alice.token);
  const patch = await admin.patch("/api/core/apps/homenotes", { enabled: false, baseUrl: "https://untrusted.invalid" });
  assert.equal(patch.status, 200);
  let hits = 0;
  const upstream = await listen((req, res) => {
    hits++; res.setHeader("Content-Type", "application/json"); res.end('{"notes":[]}');
  });
  t.after(() => close(upstream.server));
  const instance = await listen(app({ notesUrl: upstream.url }));
  t.after(() => close(instance.server));
  const client = makeClient(instance.url); client.setToken(alice.token);
  try {
    assert.equal((await search(client)).body.groups[0].status, "disabled");
    assert.equal(hits, 0);
    await admin.patch("/api/core/apps/homenotes", { enabled: true });
    assert.equal((await search(client)).body.groups[0].status, "ok");
    assert.equal(hits, 1, "only the configured origin was contacted, not the registry's URL");
    assert.equal((await admin.delete("/api/core/apps/homenotes")).status, 200);
    assert.equal((await search(client)).body.groups[0].status, "disabled");
    assert.equal(hits, 1);
  } finally {
    await admin.post("/api/core/apps", { slug: "homenotes", name: "HomeNotes", baseUrl: "/notes/" });
  }
});

test("an unavailable or malformed source does not hide another source's results", async t => {
  const alice = await user();
  await alice.tasks.post("/api/hometasks/tasks", { title: "Trip still works" });
  for (const body of ["not json", JSON.stringify({ notes: [{ id: "../../bad", title: "bad", excerpt: "bad" }] })]) {
    const upstream = await listen((req, res) => { res.setHeader("Content-Type", "application/json"); res.end(body); });
    t.after(() => close(upstream.server));
    const instance = await listen(app({ notesUrl: upstream.url }));
    t.after(() => close(instance.server));
    const client = makeClient(instance.url); client.setToken(alice.token);
    const res = await search(client);
    assert.equal(res.body.groups[0].status, "unavailable");
    assert.equal(res.body.groups[1].results[0].title, "Trip still works");
  }
});

test("registry failure fails closed and does not query any application", async t => {
  const alice = await user();
  let hits = 0;
  const broken = await listen((req, res) => { res.writeHead(503); res.end("private details"); });
  const target = await listen((req, res) => { hits++; res.end(); });
  t.after(() => close(broken.server)); t.after(() => close(target.server));
  const instance = await listen(app({ homecoreUrl: broken.url, notesUrl: target.url, tasksUrl: target.url }));
  t.after(() => close(instance.server));
  const client = makeClient(instance.url); client.setToken(alice.token);
  const res = await search(client);
  assert.equal(res.status, 502);
  assert.equal(hits, 0);
  assert.ok(!JSON.stringify(res.body).includes("private details"));
});

test("results and excerpts are bounded and source ordering is preserved", async t => {
  const alice = await user();
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, title: "x".repeat(500), excerpt: "y".repeat(500) }));
  const target = await listen((req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ notes: rows })); });
  t.after(() => close(target.server));
  const instance = await listen(app({ notesUrl: target.url }));
  t.after(() => close(instance.server));
  const client = makeClient(instance.url); client.setToken(alice.token);
  const group = (await search(client, "trip", ["homenotes"])).body.groups[0];
  assert.equal(group.limited, true);
  assert.equal(group.results.length, 20);
  assert.equal(group.results[0].title.length, 240);
  assert.equal(group.results[0].excerpt.length, 160);
  assert.deepEqual(group.results.map(item => item.id), Array.from({ length: 20 }, (_, i) => i + 1));
});
