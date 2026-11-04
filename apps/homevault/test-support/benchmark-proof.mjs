import assert from "node:assert/strict";
import fs from "node:fs/promises";

export async function verifyBenchmark(browser, url, { runs = 1, screenshot } = {}) {
  const context = await browser.newContext();
  const errors = [], forbiddenRequests = [], reports = [];
  await context.addInitScript(() => {
    localStorage.setItem("home_session_token", "benchmark-must-not-read-this-test-token");
    window.benchmarkStorageReads = [];
    const read = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      window.benchmarkStorageReads.push(key);
      return read.call(this, key);
    };
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => {
    const parsed = new URL(request.url());
    if ((parsed.protocol !== "blob:" && parsed.origin !== new URL(url).origin) || /\/(?:api|demo-api)(?:\/|$)/.test(parsed.pathname)) forbiddenRequests.push(request.url());
  });
  try {
    for (let index = 0; index < runs; index++) {
      await page.goto(url);
      await page.getByRole("button", { name: "Run speed test" }).waitFor();
      await page.getByLabel("Device label (optional)").fill("Automated browser check; not a minimum-device certification");
      await page.getByRole("button", { name: "Run speed test" }).click();
      await page.getByText(/^Measurement complete\./).waitFor({ timeout: 30_000 });
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download results" }).click();
      const report = JSON.parse(await fs.readFile(await (await downloaded).path(), "utf8"));
      assert.deepEqual(report.kdfParams, { m: 19456, t: 2, p: 1 });
      assert.equal(report.steadyMs.length, 7);
      assert.equal(report.runInPage, 1, "Each recorded run must start in a fresh page");
      assert.ok(report.firstDerivationMs > 0 && report.summary.minMs > 0);
      assert.equal(Object.keys(report).some(key => /password|salt$|key$|token/i.test(key)), false);
      reports.push(report);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });
    // The timer is queued by a simulated user action, ensuring cancellation
    // is tested between real derivations rather than racing Playwright clicks.
    await page.evaluate(() => {
      document.querySelector("#benchmark-form").requestSubmit();
      setTimeout(() => document.querySelector("#stop").click(), 0);
    });
    await page.getByText("Test stopped. No partial report was kept.").waitFor();
    assert.equal(await page.locator("#download").isDisabled(), true);
    assert.equal(await page.locator("#results").isVisible(), false);
    const reads = await page.evaluate(() => window.benchmarkStorageReads);
    assert.ok(reads.every(key => ["homecloud-theme", "home-retro"].includes(key)), "Benchmark must not read account/session storage");
    assert.deepEqual(forbiddenRequests, [], "No APIs or third-party requests are allowed");
    assert.deepEqual(errors, []);
    return reports;
  } finally { await context.close(); }
}
