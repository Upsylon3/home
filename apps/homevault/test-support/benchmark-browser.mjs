// Static-only fixture: no Core, Vault backend, accounts or real installation.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { verifyBenchmark } from "./benchmark-proof.mjs";

const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const dist = path.join(root, "apps/homevault/dist");
const gateway = fs.readFileSync(path.join(root, "gateway/nginx.conf"), "utf8");
const policy = gateway.match(/add_header Content-Security-Policy "([^"]+)" always;/)?.[1].replaceAll("$csp_wasm", " 'wasm-unsafe-eval'");
if (!policy) throw new Error("Gateway CSP not found.");
const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.resolve(dist, "." + decodeURIComponent(url.pathname.slice("/vault".length)));
  if (!url.pathname.startsWith("/vault/") || !file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end("Not found"); return;
  }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Content-Security-Policy": policy, "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.DEMO_BROWSER_CHANNEL ? { channel: process.env.DEMO_BROWSER_CHANNEL } : {}) });
  const record = process.argv[2];
  const reports = await verifyBenchmark(browser, `http://127.0.0.1:${server.address().port}/vault/benchmark.html`, { runs: record ? 3 : 1, screenshot: "demo-vault-benchmark.png" });
  if (record) {
    const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    const result = {
      schema: 1,
      source: { revision: git(["rev-parse", "HEAD"]), workingTreeDirty: !!git(["status", "--porcelain"]) },
      execution: "Automated headless browser on the local host; foreground page, no CPU throttling. Not representative minimum hardware.",
      browserVersion: browser.version(),
      host: { platform: os.platform(), architecture: os.arch(), cpuModel: os.cpus()[0]?.model ?? null, logicalProcessors: os.cpus().length, memoryGiB: Math.round(os.totalmem() / 1024 ** 3) },
      runs: reports
    };
    fs.mkdirSync(path.dirname(path.resolve(record)), { recursive: true });
    fs.writeFileSync(record, JSON.stringify(result, null, 2) + "\n");
    console.log("Saved synthetic measurements to " + record);
  }
  console.log("PASS: production CSP, real KDF, JSON export, cancellation, mobile layout, no session reads or API requests.");
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
