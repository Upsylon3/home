// Disposable local browser QA only. No .env or real installation is loaded.
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const monitorHelper = require("../../../apps/homemonitor-backend/test/helpers/app");
const tasksHelper = require("../../../apps/hometasks-backend/test/helpers/app");
const { registerUser } = require("../../../homecore/test/helpers/client");
async function main() {
  const monitor = await monitorHelper.startTestApp(), tasks = await tasksHelper.startTestApp(), core = monitor.homecore;
  monitor.machine.at = Date.now(); await monitor.monitor.tick();
  const user = await registerUser(core.baseUrl, { username: "browser_followup", password: "DisposableBrowser123!" });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-browser-"));
  const { createAutomationStore } = require("../src/automationStore");
  const { createAutomation } = require("../src/automation");
  const { createApp } = require("../src/app");
  const store = createAutomationStore({ directory, key: crypto.randomBytes(32) });
  const automation = createAutomation({ store, homecoreUrl: core.baseUrl, monitorUrl: monitor.baseUrl, tasksUrl: tasks.baseUrl });
  const bridge = http.createServer(createApp({ homecoreUrl: core.baseUrl, tasksUrl: tasks.baseUrl, automation }));
  await new Promise(resolve => bridge.listen(0, "127.0.0.1", resolve));
  const root = path.resolve(__dirname, "../../../apps/home/dist");
  let bridgeOffline = false;
  const proxy = http.createServer(async (req, res) => {
    if (req.url === "/fixture/bridge-offline") { bridgeOffline = true; res.end("ok"); return; }
    if (req.url.startsWith("/api/")) {
      const target = req.url.startsWith("/api/homebridge/") ? `http://127.0.0.1:${bridge.address().port}` : core.baseUrl;
      if (bridgeOffline && req.url.startsWith("/api/homebridge/")) { res.writeHead(502); res.end(); return; }
      const upstream = http.request(`${target}${req.url}`, { method: req.method, headers: req.headers }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      upstream.on("error", () => { res.writeHead(502); res.end(); }); req.pipe(upstream); return;
    }
    const candidate = path.resolve(root, `.${new URL(req.url, "http://fixture").pathname}`);
    const file = candidate.startsWith(root + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(root, "index.html");
    const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
    res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream"); fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  console.log(JSON.stringify({ url: `http://127.0.0.1:${proxy.address().port}`, username: user.username }));
  const timer = setInterval(() => { monitor.machine.at = Date.now(); monitor.monitor.tick().catch(() => {}); }, 1000);
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, async () => {
    clearInterval(timer); automation.stop(); proxy.closeAllConnections(); bridge.closeAllConnections();
    await new Promise(resolve => proxy.close(resolve)); await new Promise(resolve => bridge.close(resolve));
    store.close(); fs.rmSync(directory, { recursive: true, force: true });
    try { await tasksHelper.stopTestApp(); } finally { await monitorHelper.stopTestApp(); }
    process.exit(0);
  });
}
main().catch(() => { console.error("Disposable browser fixture failed."); process.exitCode = 1; });
