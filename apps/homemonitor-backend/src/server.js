// The entry point: `npm start` runs this. It builds the monitor from its parts,
// starts the web server, and runs the measuring timer.
require("dotenv").config();

const { loadConfig } = require("./config");
const { db } = require("./db");
const history = require("./history");
const { createCollector } = require("./collector");
const { createMonitor } = require("./monitor");
const { sendNotifications } = require("./notifier");
const { createApp } = require("./app");

process.on("unhandledRejection", (reason) => {
  console.error("[homemonitor] Unhandled promise rejection (this should always be caught somewhere, please report it):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[homemonitor] Uncaught exception, shutting down so Docker can restart cleanly:", err);
  process.exit(1);
});

const config = loadConfig();
if (config.alertsEnabled && !config.internalSecret) {
  console.warn("[homemonitor] HOMECORE_INTERNAL_SECRET is not set: alerts can't be sent and the app list can't be read.");
}

const collector = createCollector(config);
const monitor = createMonitor({ config, collector, history, notifier: (items) => sendNotifications(items, config) });
const app = createApp({ monitor, history });

// Ports: 4000 HomeCore, 4200 HomeMedia, 4300 HomeSync, 4400 HomeNotes,
// 4500 HomeCloud, 4600 HomeVault, 4700 HomeTasks, 4800 HomeMonitor.
const PORT = process.env.PORT || 4800;
const server = app.listen(PORT, () => {
  console.log(`[homemonitor] backend listening on port ${PORT}`);
});

// Measure now, then every intervalSeconds. A failed tick is logged, never fatal.
const runTick = () => monitor.tick().catch((err) => console.error("[homemonitor] tick failed:", err));
runTick();
const timer = setInterval(runTick, config.intervalSeconds * 1000);

function shutdown(signal) {
  console.log(`[homemonitor] Received ${signal}, shutting down gracefully...`);
  clearInterval(timer);
  server.close(() => {
    db.close();
    console.log("[homemonitor] Shutdown complete.");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
