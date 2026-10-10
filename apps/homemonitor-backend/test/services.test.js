const { test } = require("node:test");
const assert = require("node:assert/strict");
const { interpretHealth, resolveHealthUrl, checkService, checkAllServices } = require("../src/services");
const { loadConfig } = require("../src/config");

test("interpretHealth: the HTTP code and the status word decide together", () => {
  assert.equal(interpretHealth(200, '{"status":"ok"}'), "up");
  assert.equal(interpretHealth(200, '{"status":"healthy"}'), "up");
  assert.equal(interpretHealth(200, "not json"), "up");
  assert.equal(interpretHealth(200, ""), "up");
  assert.equal(interpretHealth(503, '{"status":"degraded"}'), "degraded"); // HomeCore's shape
  assert.equal(interpretHealth(200, '{"status":"degraded"}'), "degraded");
  assert.equal(interpretHealth(200, '{"status":"unhealthy"}'), "down");
  assert.equal(interpretHealth(503, ""), "down");
  assert.equal(interpretHealth(404, '{"status":"ok"}'), "down");
});

test("resolveHealthUrl: full URL wins, then per-app override, then the gateway", () => {
  const config = loadConfig({ GATEWAY_URL: "http://gw", SERVICE_URLS: "hometasks=http://localhost:4700" });
  assert.equal(resolveHealthUrl("x", "http://full/health", config), "http://full/health");
  assert.equal(resolveHealthUrl("hometasks", "/api/hometasks/health", config), "http://localhost:4700/api/hometasks/health");
  assert.equal(resolveHealthUrl("homenotes", "/api/homenotes/health", config), "http://gw/api/homenotes/health");
  assert.equal(resolveHealthUrl("homenotes", "/api/homenotes/health", loadConfig({})), null);
});

// A pretend fetch: answers by URL, from a table.
function fakeFetch(table, calls = []) {
  return async (url, options = {}) => {
    calls.push({ url, options });
    const entry = table[url];
    if (!entry) throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    if (entry instanceof Error) throw entry;
    return { ok: entry.status < 400, status: entry.status, text: async () => entry.body ?? "", json: async () => JSON.parse(entry.body) };
  };
}

test("checkService: up, degraded, down, timeout and unknown", async () => {
  let clock = 1000;
  const now = () => (clock += 25); // each reading "takes" 25 ms
  const timeout = Object.assign(new Error("The operation timed out"), { name: "TimeoutError" });
  const fetchFn = fakeFetch({
    "http://a/up": { status: 200, body: '{"status":"ok"}' },
    "http://a/degraded": { status: 503, body: '{"status":"degraded"}' },
    "http://a/down": { status: 500, body: "" },
    "http://a/slow": timeout
  });
  const check = (url) => checkService({ slug: "s", name: "S", url }, { fetchFn, now });

  const up = await check("http://a/up");
  assert.equal(up.status, "up");
  assert.equal(up.latencyMs, 25);
  assert.equal(up.detail, null);

  assert.equal((await check("http://a/degraded")).status, "degraded");
  const down = await check("http://a/down");
  assert.equal(down.status, "down");
  assert.equal(down.detail, "HTTP 500");

  const slow = await check("http://a/slow");
  assert.equal(slow.status, "down");
  assert.equal(slow.detail, "Timed out");

  const refused = await check("http://a/missing");
  assert.equal(refused.status, "down");
  assert.equal(refused.detail, "ECONNREFUSED");

  const unknown = await check(null);
  assert.equal(unknown.status, "unknown");
  assert.match(unknown.detail, /GATEWAY_URL/);
});

test("checkAllServices: HomeCore plus every enabled app with a health path, via the gateway", async () => {
  const config = loadConfig({ HOMECORE_INTERNAL_URL: "http://core", HOMECORE_INTERNAL_SECRET: "s3cret", GATEWAY_URL: "http://gw" });
  const calls = [];
  const fetchFn = fakeFetch(
    {
      "http://core/internal/apps": {
        status: 200,
        body: JSON.stringify({
          apps: [
            { slug: "home", name: "Home", healthUrl: null, enabled: true }, // nothing to check
            { slug: "homecloud", name: "HomeCloud", healthUrl: "/api/homecloud/health", enabled: true },
            { slug: "homemedia", name: "HomeMedia", healthUrl: "/api/homemedia/health", enabled: false } // disabled: skipped
          ]
        })
      },
      "http://core/api/core/health": { status: 200, body: '{"status":"healthy"}' },
      "http://gw/api/homecloud/health": { status: 503, body: "" }
    },
    calls
  );

  const { services, registryError } = await checkAllServices(config, { fetchFn });
  assert.equal(registryError, null);
  assert.deepEqual(services.map((s) => [s.slug, s.status]), [["homecore", "up"], ["homecloud", "down"]]);
  // The registry call proved who we are with the shared secret.
  assert.equal(calls[0].options.headers["X-Internal-Secret"], "s3cret");
});

test("checkAllServices: if the registry can't be read, HomeCore is still checked and the error is reported", async () => {
  const config = loadConfig({ HOMECORE_INTERNAL_URL: "http://core", GATEWAY_URL: "http://gw" });
  const fetchFn = fakeFetch({
    "http://core/internal/apps": { status: 401, body: "" },
    "http://core/api/core/health": { status: 200, body: '{"status":"healthy"}' }
  });
  const { services, registryError } = await checkAllServices(config, { fetchFn });
  assert.deepEqual(services.map((s) => s.slug), ["homecore"]);
  assert.match(registryError, /HomeCore answered 401/);
});

test("checkAllServices: an app with no known address shows as unknown, not down", async () => {
  const config = loadConfig({ HOMECORE_INTERNAL_URL: "http://core" }); // no gateway, no SERVICE_URLS
  const fetchFn = fakeFetch({
    "http://core/internal/apps": { status: 200, body: JSON.stringify({ apps: [{ slug: "homenotes", name: "HomeNotes", healthUrl: "/api/homenotes/health", enabled: true }] }) },
    "http://core/api/core/health": { status: 200, body: '{"status":"healthy"}' }
  });
  const { services } = await checkAllServices(config, { fetchFn });
  assert.equal(services.find((s) => s.slug === "homenotes").status, "unknown");
});
