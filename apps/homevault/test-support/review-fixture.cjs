// Disposable localhost review fixture. Uses real services with temporary
// databases and test-only account credentials, never .env or installed data.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const backendHelper = require("../../homevault-backend/test/helpers/app");
const { registerUser } = require("../../../homecore/test/helpers/client");
async function main() {
  // __dirname is test-support/, so the built app is one level above it.
  const dist = path.resolve(__dirname, "../dist");
  if (!fs.existsSync(path.join(dist, "index.html"))) throw new Error("Build HomeVault before starting the fixture.");
  const config = fs.readFileSync(path.resolve(__dirname, "../../../gateway/nginx.conf"), "utf8");
  const match = config.match(/add_header Content-Security-Policy "([^"]+)" always;/);
  if (!match) throw new Error("Gateway CSP could not be located.");
  const policy = match[1].replaceAll("$csp_wasm", " 'wasm-unsafe-eval'");
  const backend = await backendHelper.startTestApp();
  await registerUser(backend.homecore.baseUrl, { username: "vault_reviewer", password: "DisposableAccount123!" });
  let stopping = false;
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/__review__/stop") { res.writeHead(204); res.end(); setImmediate(shutdown); return; }
    if (req.url.startsWith("/api/")) {
      const origin = req.url.startsWith("/api/homevault/") ? backend.baseUrl : backend.homecore.baseUrl;
      const upstream = http.request(`${origin}${req.url}`, { method: req.method, headers: req.headers }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.pipe(upstream); return;
    }
    const url = new URL(req.url, "http://review.local");
    if (url.pathname === "/") { res.writeHead(302, { Location: "/vault/" }); res.end(); return; }
    if (!url.pathname.startsWith("/vault/")) { res.writeHead(404); res.end(); return; }
    const candidate = path.resolve(dist, `.${url.pathname.slice("/vault".length)}`);
    const file = candidate.startsWith(dist + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
      ? candidate : path.join(dist, "index.html");
    const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml",
      ".png": "image/png", ".woff": "font/woff", ".woff2": "font/woff2", ".json": "application/json", ".wasm": "application/wasm" };
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Content-Security-Policy": policy, "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  async function shutdown() {
    if (stopping) return; stopping = true;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    backend.server.closeAllConnections(); backend.homecore.server.closeAllConnections();
    await backendHelper.stopTestApp();
  }
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown().catch(() => { process.exitCode = 1; }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/vault/`, username: "vault_reviewer", mode: "disposable; rate limiting disabled; no TLS" }));
}
main().catch(() => { console.error("Review fixture failed. Build the frontend and use only disposable review data."); process.exitCode = 1; });
