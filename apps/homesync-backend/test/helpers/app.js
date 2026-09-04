// Boots real, isolated services for a test file: apps/homecloud-backend
// (which, as part of its own setup, boots a real HomeCore instance too —
// see its test helper) and HomeSync pointed at both: HOMECORE_INTERNAL_URL
// for identity verification (HomeCore, via @home/homecore-client) and
// HOMECLOUD_BACKEND_INTERNAL_URL for actual file/folder operations
// (apps/homecloud-backend, via src/homecloudClient.js) — two different
// services, not one. Reusing
// homecloud-backend's already-booted `homecore` reference (rather than
// separately require()-ing and booting homecore/test/helpers/app.js a
// second time here) relies on that module being require()'d from the
// exact same resolved path either way, so Node's module cache hands back
// the same singleton `started` state — verified, not assumed: booting
// three services with two independent HomeCore instances would silently
// break auth (a token from one wouldn't verify against the other).
//
// This relies on `node --test` running each test file in its own child
// process — env vars are set sequentially and each app is require()'d
// immediately after, so each one's db.js captures the right DATA_DIR at
// the moment it's first loaded.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const homecloudBackendTestApp = require("../../../homecloud-backend/test/helpers/app");

let started = null;

async function startTestApp() {
  if (started) return started;

  const homecloudBackend = await homecloudBackendTestApp.startTestApp();
  const homecore = homecloudBackend.homecore;

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "homesync-test-"));
  process.env.DATA_DIR = dataDir;
  process.env.HOMECORE_INTERNAL_URL = homecore.baseUrl;
  process.env.HOMECLOUD_BACKEND_INTERNAL_URL = homecloudBackend.baseUrl;
  process.env.CORS_ORIGIN = "*";
  delete process.env.PORT; // avoid ever accidentally colliding with a fixed port in tests

  // eslint-disable-next-line global-require -- must load after env vars are set
  const { app, db } = require("../../src/app");

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  started = {
    app,
    db,
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    dataDir,
    homecore,
    homecloudBackend
  };
  return started;
}

async function stopTestApp() {
  if (!started) return;
  await new Promise((resolve) => started.server.close(resolve));
  try {
    started.db.close();
  } catch {
    // already closed, fine
  }
  fs.rmSync(started.dataDir, { recursive: true, force: true });
  await homecloudBackendTestApp.stopTestApp(); // also stops the homecore instance it booted
  started = null;
}

module.exports = { startTestApp, stopTestApp };
