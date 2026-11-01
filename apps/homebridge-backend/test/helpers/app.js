// HomeBridge tests use a real isolated HomeCore for identity and the
// application registry. Provider HTTP servers stand in for the individual
// app APIs here; the Docker CI smoke test exercises the full real stack.
const http = require("http");
const homecoreTestApp = require("../../../../homecore/test/helpers/app");

let started = null;

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function startTestApp() {
  if (started) return started;

  const homecore = await homecoreTestApp.startTestApp();
  const providerState = { failedSources: new Set(), calls: [] };
  const providerServer = http.createServer((req, res) => {
    const url = new URL(req.url, "http://provider.test");
    const path = url.pathname;
    const source =
      path.startsWith("/api/homecloud/") ? "homecloud" :
      path.startsWith("/api/homemedia/") ? "homemedia" :
      path.startsWith("/api/homenotes/") ? "homenotes" :
      path.startsWith("/api/hometasks/") ? "hometasks" : "unknown";

    providerState.calls.push({
      source,
      path,
      search: url.searchParams.get("search"),
      authorization: req.headers.authorization
    });

    if (providerState.failedSources.has(source)) return json(res, 503, { error: "offline" });

    if (path === "/api/homecloud/files/all") {
      return json(res, 200, {
        files: [
          { id: 44, name: "family-photo.jpg", size: 2048, mimetype: "image/jpeg", createdAt: "2026-10-30 10:00:00" },
          { id: 45, name: "annual-report.pdf", size: 4096, mimetype: "application/pdf", createdAt: "2026-10-29 10:00:00" }
        ],
        truncated: false
      });
    }
    if (path === "/api/homemedia/library") {
      return json(res, 200, {
        files: [
          { id: 44, name: "family-photo.jpg", kind: "image", mimetype: "image/jpeg", createdAt: "2026-10-30 10:00:00" },
          { id: 46, name: "holiday-video.mp4", kind: "video", mimetype: "video/mp4", createdAt: "2026-10-28 10:00:00" }
        ]
      });
    }
    if (path === "/api/homemedia/albums") {
      return json(res, 200, {
        albums: [{ id: 7, name: "Family holidays", itemCount: 18, updatedAt: "2026-10-27 10:00:00" }]
      });
    }
    if (path === "/api/homenotes/notes") {
      return json(res, 200, {
        notes: [{ id: 11, title: "Trip planning", excerpt: "A few notes about the journey", updatedAt: "2026-10-26 10:00:00" }]
      });
    }
    if (path === "/api/hometasks/tasks") {
      return json(res, 200, {
        tasks: [{ id: 21, title: "Book train tickets", completedAt: null, priority: "high", dueDate: "2026-11-05", updatedAt: "2026-10-25 10:00:00" }]
      });
    }
    return json(res, 404, { error: "not found" });
  });
  await new Promise((resolve) => providerServer.listen(0, "127.0.0.1", resolve));
  const providerUrl = `http://127.0.0.1:${providerServer.address().port}`;

  process.env.HOMECORE_INTERNAL_URL = homecore.baseUrl;
  process.env.HOMECLOUD_BACKEND_INTERNAL_URL = providerUrl;
  process.env.HOMEMEDIA_BACKEND_INTERNAL_URL = providerUrl;
  process.env.HOMENOTES_BACKEND_INTERNAL_URL = providerUrl;
  process.env.HOMETASKS_BACKEND_INTERNAL_URL = providerUrl;
  process.env.CORS_ORIGIN = "*";
  delete process.env.PORT;

  // eslint-disable-next-line global-require -- auth client reads HOMECORE_INTERNAL_URL at import time
  const { app } = require("../../src/app");
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  started = {
    app,
    server,
    providerServer,
    providerState,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    providerUrl,
    homecore
  };
  return started;
}

async function stopTestApp() {
  if (!started) return;
  await new Promise((resolve) => started.server.close(resolve));
  await new Promise((resolve) => started.providerServer.close(resolve));
  await homecoreTestApp.stopTestApp();
  started = null;
}

module.exports = { startTestApp, stopTestApp };
