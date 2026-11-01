const { createApp } = require("./app");
const { HOMECORE_URL } = require("@home/homecore-client");
const { configuredStore } = require("./automationStore");
const { createAutomation, POLL_MS } = require("./automation");
const store = configuredStore();
let automation = null;
if (store) {
  try {
    automation = createAutomation({ store, homecoreUrl: HOMECORE_URL,
      monitorUrl: process.env.HOMEMONITOR_INTERNAL_URL || "http://homemonitor-backend:4800",
      tasksUrl: process.env.HOMETASKS_INTERNAL_URL || "http://hometasks-backend:4700" });
  } catch { store.close(); console.error("[homebridge] automation configuration is unavailable; search remains enabled"); }
}
const port = Number(process.env.PORT || 4900);
const server = createApp({ automation }).listen(port, () => console.log(`[homebridge] listening on ${port}`));
const timer = automation ? setInterval(() => automation.tick().catch(() => console.error("[homebridge] automation cycle failed")), POLL_MS) : null;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (timer) clearInterval(timer);
    automation?.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10000).unref();
  });
}
