const { before, after, test } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");

let app;
let token;

async function get(path, authorization = token) {
  return fetch(`${app.baseUrl}${path}`, {
    headers: authorization ? { Authorization: `Bearer ${authorization}` } : {}
  });
}

before(async () => {
  app = await startTestApp();
  const response = await fetch(`${app.homecore.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: `bridge${Date.now()}`, password: "test-password-123" })
  });
  assert.equal(response.status, 201);
  token = (await response.json()).token;
});

after(async () => {
  await stopTestApp();
});

test("health is public and reports the HomeCore identity service", async () => {
  const response = await get("/api/homebridge/health", null);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "ok");
});

test("search requires a valid HomeCore session", async () => {
  const response = await get("/api/homebridge/search?q=family", null);
  assert.equal(response.status, 401);
});

test("search validates query and result limit before calling providers", async () => {
  for (const path of [
    "/api/homebridge/search",
    "/api/homebridge/search?q=x",
    `/api/homebridge/search?q=${"x".repeat(101)}`,
    "/api/homebridge/search?q=family&limit=0",
    "/api/homebridge/search?q=family&limit=13"
  ]) {
    const response = await get(path);
    assert.equal(response.status, 400, path);
  }
  assert.equal(app.providerState.calls.length, 0);
});

test("search combines user-scoped results and removes duplicate media files", async () => {
  app.providerState.calls.length = 0;
  const response = await get("/api/homebridge/search?q=family");
  assert.equal(response.status, 200);
  const data = await response.json();

  assert.equal(data.query, "family");
  assert.ok(data.results.some((result) => result.source === "homecloud" && result.title === "annual-report.pdf"));
  assert.ok(data.results.some((result) => result.source === "homemedia" && result.title === "family-photo.jpg"));
  assert.ok(data.results.some((result) => result.source === "homemedia" && result.kind === "album"));
  assert.ok(data.results.some((result) => result.source === "homenotes" && result.title === "Family trip notes"));
  assert.ok(data.results.some((result) => result.source === "hometasks" && result.title === "Plan family weekend"));

  // HomeCloud stores the media bytes, but HomeMedia owns their library presentation.
  assert.equal(data.results.filter((result) => result.title === "family-photo.jpg").length, 1);
  assert.equal(data.sources.length, 4);
  assert.ok(data.sources.every((source) => source.status === "available"));
  assert.ok(app.providerState.calls.every((call) => call.authorization === `Bearer ${token}`));
  assert.ok(app.providerState.calls.every((call) => call.search === "family" || call.source === "homemedia"));
  assert.equal(data.results.some((result) => result.source === "homevault"), false);
});

test("a disabled app is not queried and is reported explicitly", async () => {
  app.homecore.db.prepare("UPDATE hc_applications SET enabled = 0 WHERE slug = 'homenotes'").run();
  const beforeCalls = app.providerState.calls.length;
  try {
    const response = await get("/api/homebridge/search?q=family");
    const data = await response.json();
    const notes = data.sources.find((source) => source.slug === "homenotes");
    assert.equal(notes.status, "disabled");
    assert.equal(app.providerState.calls.length - beforeCalls, 3);
  } finally {
    app.homecore.db.prepare("UPDATE hc_applications SET enabled = 1 WHERE slug = 'homenotes'").run();
  }
});

test("one unavailable provider does not fail results from the other apps", async () => {
  app.providerState.failedSources.add("homenotes");
  try {
    const response = await get("/api/homebridge/search?q=family");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.sources.find((source) => source.slug === "homenotes").status, "unavailable");
    assert.ok(data.results.some((result) => result.source === "homecloud"));
    assert.ok(data.results.some((result) => result.source === "hometasks"));
  } finally {
    app.providerState.failedSources.delete("homenotes");
  }
});
