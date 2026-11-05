// Disposable UI proof: real Core, built Home, no dotenv or personal data.
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { startTestApp, stopTestApp } = require("../test/helpers/app");
const { registerUser } = require("../test/helpers/client");

async function main() {
  let proxy, browser;
  try {
    const core = await startTestApp({ installedApps: false });
    const owner = await registerUser(core.baseUrl), regular = await registerUser(core.baseUrl);
    const root = path.resolve(__dirname, "../../apps/home/dist");
    const types = { ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff" };
    proxy = http.createServer((req, res) => {
      if (req.url.startsWith("/api/")) {
        const upstream = http.request(core.baseUrl + req.url, { method: req.method, headers: req.headers }, response => {
          res.writeHead(response.statusCode, response.headers); response.pipe(res);
        });
        upstream.on("error", () => { res.writeHead(502); res.end(); }); req.pipe(upstream); return;
      }
      const candidate = path.resolve(root, "." + new URL(req.url, "http://fixture").pathname);
      const file = candidate.startsWith(root + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(root, "index.html");
      res.setHeader("Content-Type", types[path.extname(file)] || "text/html");
      fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${proxy.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.DEMO_BROWSER_CHANNEL ? { channel: process.env.DEMO_BROWSER_CHANNEL } : {}) });
    const context = await browser.newContext();
    await context.addInitScript(token => localStorage.setItem("home_session_token", token), owner.token);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/core/apps", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Application service unavailable."}' }));
    await page.goto(origin + "/apps");
    await page.getByText("Application list unavailable.", { exact: true }).waitFor();
    assert.equal(await page.getByText("No applications installed. Choose one below to get started.", { exact: true }).count(), 0);
    await page.unroute("**/api/core/apps");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.getByText("No applications installed. Choose one below to get started.", { exact: true }).waitFor();
    const card = name => page.locator(".app-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
    assert.equal(await card("HomeMedia").getByRole("button", { name: "Install", exact: true }).isDisabled(), true);
    await card("HomeCloud").getByRole("button", { name: "Install", exact: true }).press("Enter");
    await card("HomeCloud").getByText("Disabled", { exact: true }).waitFor();
    await card("HomeCloud").getByRole("button", { name: "Enable", exact: true }).click();
    await card("HomeCloud").getByRole("link", { name: "Launch", exact: true }).waitFor();
    await card("HomeNotes").getByRole("button", { name: "Install", exact: true }).click();
    await card("HomeNotes").getByRole("button", { name: "Enable", exact: true }).click();
    await card("HomeNotes").getByRole("link", { name: "Launch", exact: true }).waitFor();
    await page.getByRole("navigation").getByRole("link", { name: "HomeNotes", exact: true }).waitFor();
    await card("HomeCloud").getByRole("button", { name: "Disable", exact: true }).click();
    await page.getByRole("alert").getByText(/HomeNotes depends/).waitFor();
    page.once("dialog", dialog => dialog.accept());
    await card("HomeNotes").getByRole("button", { name: "Uninstall", exact: true }).click();
    await card("HomeNotes").getByRole("button", { name: "Install", exact: true }).waitFor();
    await page.reload();
    await card("HomeNotes").getByRole("button", { name: "Install", exact: true }).waitFor();
    assert.equal((await owner.client.get("/api/core/apps/homenotes")).status, 404);
    await card("HomeNotes").getByRole("button", { name: "Install", exact: true }).click();
    await card("HomeNotes").getByRole("button", { name: "Enable", exact: true }).click();
    await card("HomeNotes").getByRole("link", { name: "Launch", exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Application controls must fit a narrow screen");
    if (process.env.HOME_APPLICATION_SCREENSHOT) await page.screenshot({ path: process.env.HOME_APPLICATION_SCREENSHOT, fullPage: true });
    const member = await browser.newContext();
    await member.addInitScript(token => localStorage.setItem("home_session_token", token), regular.token);
    const memberPage = await member.newPage();
    await memberPage.goto(origin + "/apps");
    await memberPage.getByRole("heading", { name: "HomeCloud", exact: true }).waitFor();
    assert.equal(await memberPage.getByRole("button", { name: /^(Install|Uninstall|Enable|Disable)$/ }).count(), 0);
    assert.deepEqual(errors, []);
    console.log("Verified unavailable/retry, fresh catalog, keyboard install, enable/dependencies, uninstall/reload/reinstall, sidebar refresh, member controls and narrow layout.");
  } finally {
    if (browser) await browser.close();
    if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
    await stopTestApp();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
