require("dotenv").config();

const { app, db } = require("./app");

process.on("unhandledRejection", (reason) => {
  console.error("[homevault-backend] Unhandled promise rejection (this should always be caught somewhere — please report it):", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[homevault-backend] Uncaught exception — shutting down so Docker can restart cleanly:", err);
  process.exit(1);
});

const PORT = process.env.PORT || 4600;

const server = app.listen(PORT, () => {
  console.log(`[homevault-backend] backend listening on port ${PORT}`);
});

function shutdown(signal) {
  console.log(`[homevault-backend] Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    db.close();
    console.log("[homevault-backend] Shutdown complete.");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
