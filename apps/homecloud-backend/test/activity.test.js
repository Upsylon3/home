// Verifies files.js/folders.js's logActivity() calls end-to-end — an
// action through this service's own HTTP API genuinely reaches
// HomeCore's hc_activity_events, over the network, through
// POST /internal/events — not a unit test of logActivity() in
// isolation.
//
// logActivity() is fire-and-forget by design (see db.js's comment): this
// service's response to the original action comes back before the emit to
// HomeCore is necessarily done. waitFor() below polls HomeCore's own
// activity feed for a short window instead of assuming either "already
// there" or a fixed, flaky sleep.
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

async function waitFor(check, { timeoutMs = 2000, intervalMs = 25 } = {}) {
  const start = Date.now();
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() - start >= timeoutMs) return undefined;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

test("creating a folder through homecloud-backend eventually shows up in HomeCore's own activity feed", async () => {
  const { client, token } = await registerHomecloudBackendUser(homecore, baseUrl, {
    username: "backend_activity_user"
  });
  const homecoreClient = makeClient(homecore.baseUrl);
  homecoreClient.setToken(token);

  const folder = await client.post("/api/homecloud/folders", { name: "Cross-Service Folder" });
  assert.equal(folder.status, 201);

  const found = await waitFor(async () => {
    const res = await homecoreClient.get("/api/core/activity/me");
    return res.body.events.find(
      (e) => e.eventType === "homecloud.folder.created" && e.targetId === "Cross-Service Folder"
    );
  });
  assert.ok(found, "expected the folder creation to reach HomeCore's activity feed over HTTP");

  // And through the old, pre-split HomeCloud-only view too (GET
  // /api/activity — see homecore/src/homecore/homecloudActivity.js),
  // translated back to the original action string.
  const legacy = await waitFor(async () => {
    const res = await homecoreClient.get("/api/activity");
    return res.body.activity.find((a) => a.targetName === "Cross-Service Folder");
  });
  assert.ok(legacy, "expected the folder creation to reach the legacy per-user activity feed too");
  assert.equal(legacy.action, "folder_create");
});

test("if HomeCore is unreachable, the action itself still succeeds (fire-and-forget, per ARCHITECTURE.md §4)", async () => {
  const { client } = await registerHomecloudBackendUser(homecore, baseUrl, {
    username: "backend_activity_resilience_user"
  });

  const originalSecret = process.env.HOMECORE_INTERNAL_SECRET;
  // Simplest way to make the emit fail without tearing down the real
  // HomeCore instance other tests in this file still need: break the
  // secret, so HomeCore's own requireInternalSecret rejects every emit
  // with 401 — logActivity() must swallow that, not let it surface.
  process.env.HOMECORE_INTERNAL_SECRET = "deliberately_wrong_for_this_test";
  try {
    const folder = await client.post("/api/homecloud/folders", { name: "Should Still Be Created" });
    assert.equal(folder.status, 201);

    const list = await client.get("/api/homecloud/folders/");
    assert.ok(list.body.folders.some((f) => f.name === "Should Still Be Created"));
  } finally {
    process.env.HOMECORE_INTERNAL_SECRET = originalSecret;
  }
});
