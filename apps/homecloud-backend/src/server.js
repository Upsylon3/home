require("dotenv").config();

// app.js owns all Express app wiring (middleware, routes, error handling)
// so it can be required by the test suite without side effects; this file
// is only the actual running-process concerns: starting the listener, the
// trash-purge schedule, and OS signal/crash handling — mirrors
// homecore/src/server.js's split exactly.
const { app, db } = require("./app");
const { purgeExpiredTrash } = require("./files");

process.on("unhandledRejection", (reason) => {
  console.error("[homecloud-backend] Unhandled promise rejection (this should always be caught somewhere — please report it):", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[homecloud-backend] Uncaught exception — shutting down so Docker can restart cleanly:", err);
  process.exit(1);
});

const PORT = process.env.PORT || 4500;

const server = app.listen(PORT, () => {
  console.log(`[homecloud-backend] listening on port ${PORT}`);
});

// Runs the trash-purge sweep, but never lets a failure here (a transient
// filesystem hiccup, a locked database at the wrong moment) take down the
// rest of the server — it just logs and tries again on the next interval.
function safePurge() {
  try {
    purgeExpiredTrash();
  } catch (err) {
    console.error("[homecloud-backend] Trash purge sweep failed (will retry on the next schedule):", err);
  }
}

// Sweep trash once on startup, then once a day. Deleted files stay
// recoverable for TRASH_RETENTION_DAYS (default 30) before being purged for
// good.
safePurge();
const purgeInterval = setInterval(safePurge, 24 * 60 * 60 * 1000);

function shutdown(signal) {
  console.log(`[homecloud-backend] Received ${signal}, shutting down gracefully...`);
  clearInterval(purgeInterval);
  server.close(() => {
    db.close();
    console.log("[homecloud-backend] Shutdown complete.");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
