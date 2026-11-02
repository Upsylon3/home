// Loopback-only disposable emulator backend. No dotenv, installed data or
// deployment credentials: existing integration helpers own all temp databases.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("../test/helpers/app");
const { registerUser } = require("../../../homecore/test/helpers/client");
const PHOTO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWPYEiWyJUqEAUIBACJGBImnebzNAAAAAElFTkSuQmCC", "base64");

async function main() {
  const ctx = await startTestApp();
  const owner = await registerUser(ctx.homecore.baseUrl, { username: "emulator_owner", password: "DisposableEmulator123!" });
  function status() {
    const synced = ctx.db.prepare("SELECT * FROM synced_files WHERE user_id = ?").all(owner.user.id);
    const files = ctx.homecloudBackend.db.prepare("SELECT * FROM files WHERE user_id = ?").all(owner.user.id);
    const devices = ctx.db.prepare("SELECT id FROM devices WHERE user_id = ?").all(owner.user.id);
    const bytesMatch = files.length === 1 && fs.readFileSync(path.join(ctx.homecloudBackend.dataDir, "uploads", String(owner.user.id), files[0].stored_name)).equals(PHOTO);
    return { files: files.length, synced: synced.length, devices: devices.length, bytesMatch,
      hashMatches: synced.length === 1 && synced[0].content_hash === crypto.createHash("sha256").update(PHOTO).digest("hex") };
  }
  let stopping = false;
  const server = http.createServer((req, res) => {
    if (req.url === "/__fixture__/status" && req.method === "GET") {
      try { const result = status(); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(result)); }
      catch { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Fixture verification failed." })); }
      return;
    }
    if (req.url === "/__fixture__/verify" && req.method === "GET") {
      try { assert.deepEqual(status(), { files: 1, synced: 1, devices: 1, bytesMatch: true, hashMatches: true });
        res.writeHead(200); res.end("ok emulator upload bytes, SHA-256, single file/device and dedup\n"); }
      catch { res.writeHead(500); res.end("Emulator backup proof incomplete.\n"); }
      return;
    }
    if (req.url === "/__fixture__/stop" && req.method === "POST") {
      res.writeHead(204); res.end(); setImmediate(shutdown); return;
    }
    if (!req.url.startsWith("/api/")) { res.writeHead(404); res.end(); return; }
    const origin = req.url.startsWith("/api/homesync/") ? ctx.baseUrl :
      req.url.startsWith("/api/homecloud/") ? ctx.homecloudBackend.baseUrl : ctx.homecore.baseUrl;
    const upstream = http.request(`${origin}${req.url}`, { method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  async function shutdown() {
    if (stopping) return; stopping = true;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    for (const service of [ctx, ctx.homecloudBackend, ctx.homecore]) service.server.closeAllConnections();
    await stopTestApp();
  }
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown().catch(() => { process.exitCode = 1; }));
  try { await new Promise((resolve, reject) => { server.once("error", reject); server.listen(18083, "127.0.0.1", resolve); }); }
  catch (error) { await shutdown(); throw error; }
  console.log("Disposable Android fixture ready on loopback port 18083; rate limits disabled, no TLS.");
}
main().catch(() => { console.error("Android fixture failed."); process.exitCode = 1; });
