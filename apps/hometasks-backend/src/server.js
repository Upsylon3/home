// The entry point: `npm start` runs this file. It loads settings, starts the
// app listening on a port, and shuts down cleanly when Docker asks it to.
require("dotenv").config(); // reads a local .env file into process.env, if there is one

const { app, db } = require("./app");

// A promise that failed with nobody handling it is a bug. Log loudly.
process.on("unhandledRejection", (reason) => {
  console.error("[hometasks] Unhandled promise rejection (this should always be caught somewhere, please report it):", reason);
});

// If something truly unexpected throws, exit and let Docker restart us
// cleanly rather than limping along in an unknown state.
process.on("uncaughtException", (err) => {
  console.error("[hometasks] Uncaught exception, shutting down so Docker can restart cleanly:", err);
  process.exit(1);
});

// Each Home backend has its own port: 4000 HomeCore, 4200 HomeMedia,
// 4300 HomeSync, 4400 HomeNotes, 4500 HomeCloud, 4600 HomeVault, 4700 HomeTasks.
const PORT = process.env.PORT || 4700;

const server = app.listen(PORT, () => {
  console.log(`[hometasks] backend listening on port ${PORT}`);
});

// Graceful shutdown: stop accepting new requests, let current ones finish,
// close the database, then exit. The timer is a safety net in case
// something never finishes.
function shutdown(signal) {
  console.log(`[hometasks] Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    db.close();
    console.log("[hometasks] Shutdown complete.");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
