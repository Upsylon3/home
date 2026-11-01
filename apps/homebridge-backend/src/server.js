const { app } = require("./app");

const port = Number(process.env.PORT || 4900);
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`[homebridge] listening on ${port}`);
});

function shutdown(signal) {
  console.log(`[homebridge] ${signal}; shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
