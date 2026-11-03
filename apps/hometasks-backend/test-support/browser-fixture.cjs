// Disposable localhost browser QA. No dotenv, real accounts or installed data.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const helper = require("../test/helpers/app");
const { registerHomeTasksUser } = require("../test/helpers/client");
const { createReminderWorker } = require("../src/reminders");
async function main() {
  const tasks = await helper.startTestApp();
  const keyFile = path.join(tasks.dataDir, "browser-test-key");
  fs.writeFileSync(keyFile, crypto.randomBytes(32));
  process.env.HOMETASKS_REMINDER_KEY_FILE = keyFile;
  const owner = await registerHomeTasksUser(tasks.homecore, tasks.baseUrl, { username: "reminder_reviewer", password: "DisposableBrowser123!" });
  await owner.client.post("/api/hometasks/tasks", { title: "Browser reminder", notes: "Only Tasks stores these notes" });
  const homeRoot = path.resolve(__dirname, "../../home/dist"), tasksRoot = path.resolve(__dirname, "../../hometasks/dist");
  for (const root of [homeRoot, tasksRoot]) if (!fs.existsSync(path.join(root, "index.html"))) throw new Error("Build Home and Tasks first");
  const config = fs.readFileSync(path.resolve(__dirname, "../../../gateway/nginx.conf"), "utf8");
  const policy = config.match(/add_header Content-Security-Policy "([^"]+)" always;/)[1].replaceAll("$csp_wasm", "");
  let stopping = false;
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/__review__/stop") { res.writeHead(204); res.end(); setImmediate(shutdown); return; }
    if (req.method === "POST" && req.url === "/__review__/deliver") {
      // Advance only this disposable worker's clock to the selected reminder.
      const next = tasks.db.prepare("SELECT MAX(reminder_at) AS at FROM tasks").get().at;
      await createReminderWorker({ db: tasks.db, coreUrl: tasks.homecore.baseUrl, now: () => Math.max(Date.now(), Date.parse(next) + 1000) }).tick();
      res.end("ok"); return;
    }
    if (req.method === "POST" && req.url === "/__review__/disable") { delete process.env.HOMETASKS_REMINDER_KEY_FILE; res.end("ok"); return; }
    if (req.url.startsWith("/api/")) {
      const origin = req.url.startsWith("/api/hometasks/") ? tasks.baseUrl : tasks.homecore.baseUrl;
      const upstream = http.request(`${origin}${req.url}`, { method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
      upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); }); req.pipe(upstream); return;
    }
    const url = new URL(req.url, "http://fixture");
    const isTasks = url.pathname.startsWith("/tasks/");
    const root = isTasks ? tasksRoot : homeRoot;
    const candidate = path.resolve(root, `.${isTasks ? url.pathname.slice(6) : url.pathname}`);
    const file = candidate.startsWith(root + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(root, "index.html");
    const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Content-Security-Policy": policy, "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  async function shutdown() {
    if (stopping) return; stopping = true;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    tasks.server.closeAllConnections(); tasks.homecore.server.closeAllConnections();
    delete process.env.HOMETASKS_REMINDER_KEY_FILE;
    await helper.stopTestApp();
  }
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown().catch(() => { process.exitCode = 1; }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, username: owner.username, mode: "disposable test data; no TLS" }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
