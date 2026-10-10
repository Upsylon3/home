// Boots REAL, isolated copies of what an API test needs: HomeCore (through its
// own test helper) and HomeMonitor pointed at it. The only pretend part is the
// "machine" being measured (a scripted collector), so tests can make a disk
// fill up on demand. Notifications go to the REAL HomeCore.
//
// As in the other apps: `node --test` runs each file in its own process, and
// env vars are set BEFORE the app's modules are first required (db.js reads
// DATA_DIR once, when it first loads).
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const homecoreTestApp = require("../../../../homecore/test/helpers/app");

let started = null;

async function startTestApp() {
  if (started) return started;

  const homecore = await homecoreTestApp.startTestApp();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "homemonitor-test-"));
  process.env.DATA_DIR = dataDir;
  process.env.HOMECORE_INTERNAL_URL = homecore.baseUrl;
  process.env.CORS_ORIGIN = "*";

  /* eslint-disable global-require -- these must load after the env vars are set */
  const { db } = require("../../src/db");
  const history = require("../../src/history");
  const { loadConfig } = require("../../src/config");
  const { createMonitor } = require("../../src/monitor");
  const { sendNotifications } = require("../../src/notifier");
  const { createApp } = require("../../src/app");
  /* eslint-enable global-require */

  const config = loadConfig({
    HOMECORE_INTERNAL_URL: homecore.baseUrl,
    HOMECORE_INTERNAL_SECRET: homecore.internalSecret,
    DISK_ALERT_PERCENT: "80",
    SERVICE_DOWN_CHECKS: "2"
  });

  // The pretend machine. Change `machine` between ticks to change what is "measured".
  const machine = { disk: 50, service: "up", at: Date.UTC(2026, 9, 9, 12, 0, 0) };
  const collector = {
    collect: async () => ({
      at: new Date(machine.at).toISOString(),
      system: { cpuPercent: 12.5, memory: { totalBytes: 8e9, usedBytes: 2e9, percent: 25 }, loadAverage: [0.1, 0.2, 0.3], uptimeSeconds: 3600, network: null },
      disks: [{ label: "data", path: "/data", totalBytes: 100e9, usedBytes: machine.disk * 1e9, usedPercent: machine.disk }],
      services: [{ slug: "homecloud", name: "HomeCloud", status: machine.service, latencyMs: 12, checkedAt: new Date(machine.at).toISOString(), detail: machine.service === "down" ? "HTTP 500" : null }],
      registryError: null,
      backups: { status: "ok", detail: null, maxAgeHours: 36, sources: [] }
    })
  };

  const monitor = createMonitor({
    config,
    collector,
    history,
    notifier: (items) => sendNotifications(items, config),
    now: () => machine.at
  });
  const app = createApp({ monitor, history, now: () => machine.at });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  started = { app, db, history, monitor, machine, server, baseUrl: `http://127.0.0.1:${server.address().port}`, dataDir, homecore };
  return started;
}

async function stopTestApp() {
  if (!started) return;
  await new Promise((resolve) => started.server.close(resolve));
  try {
    started.db.close();
  } catch {
    // already closed
  }
  fs.rmSync(started.dataDir, { recursive: true, force: true });
  await homecoreTestApp.stopTestApp();
  started = null;
}

module.exports = { startTestApp, stopTestApp };
