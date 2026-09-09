// Boots two real, isolated services for a test file: a genuine HomeCore
// instance (reusing HomeCore's own test helper — same monorepo, so this
// is a real integration test against real HomeCore code, not a mock of
// it) and this service pointed at it via HOMECORE_INTERNAL_URL. That's
// the only upstream dependency HomeVault has — unlike HomeMedia/HomeSync/
// HomeNotes, it never touches apps/homecloud-backend at all, since it
// stores nothing but its own encrypted blobs (see src/db.js's header
// comment). Both services get their own fresh temp data directories;
// nothing here touches a real deployment or another test file's data.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const homecoreTestApp = require("../../../../homecore/test/helpers/app");

let started = null;

async function startTestApp() {
  if (started) return started;

  const homecore = await homecoreTestApp.startTestApp();

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "homevault-backend-test-"));
  process.env.DATA_DIR = dataDir;
  process.env.HOMECORE_INTERNAL_URL = homecore.baseUrl;
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
    homecore
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
  await homecoreTestApp.stopTestApp();
  started = null;
}

module.exports = { startTestApp, stopTestApp };
