const { createApp } = require("./app");
const port = Number(process.env.PORT || 4900);
const server = createApp().listen(port, () => console.log(`[homebridge] listening on ${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
