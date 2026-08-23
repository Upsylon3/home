require("dotenv").config();

// app.js owns all Express app wiring (middleware, routes, error handling)
// so it can be required by the test suite without side effects; this file
// is only the actual running-process concerns: starting the listener, the
// trash-purge schedule, and OS signal/crash handling. See app.js for why
// dotenv is loaded here and not there.
const { app, db } = require("./app");
const { purgeExpiredTrash } = require("./files");

// A backstop, not the primary defense: every async route handler is wrapped
// with asyncHandler (see auth.js/admin.js), so in normal operation this
// should never fire. It exists in case something slips through anyway —
// e.g. a rejected promise from code outside a request (the trash-purge
// timer, a future change someone forgets to wrap) — so one unexpected
// error can't take the whole server down silently for everyone using it.
process.on("unhandledRejection", (reason) => {
  console.error("[homecloud] Unhandled promise rejection (this should always be caught somewhere — please report it):", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[homecloud] Uncaught exception — shutting down so Docker can restart cleanly:", err);
  process.exit(1);
});

const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, () => {
  console.log(`[homecloud] backend listening on port ${PORT}`);
});

// Runs the trash-purge sweep, but never lets a failure here (a transient
// filesystem hiccup, a locked database at the wrong moment) take down the
// rest of the server — it just logs and tries again on the next interval.
function safePurge() {
  try {
    purgeExpiredTrash();
  } catch (err) {
    console.error("[homecloud] Trash purge sweep failed (will retry on the next schedule):", err);
  }
}

// Sweep trash once on startup, then once a day. Deleted files stay
// recoverable for TRASH_RETENTION_DAYS (default 30) before being purged for
// good.
safePurge();
const purgeInterval = setInterval(safePurge, 24 * 60 * 60 * 1000);

// On a Docker stop/restart, this lets in-flight requests finish and the
// SQLite WAL checkpoint cleanly instead of the process being killed
// mid-write.
function shutdown(signal) {
  console.log(`[homecloud] Received ${signal}, shutting down gracefully...`);
  clearInterval(purgeInterval);
  server.close(() => {
    db.close();
    console.log("[homecloud] Shutdown complete.");
    process.exit(0);
  });
  // Safety net: if something's still holding a connection open after 10s,
  // exit anyway rather than hanging forever.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
