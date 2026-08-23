// Boots two real, isolated services for a test file: a genuine HomeCloud
// instance (reusing HomeCloud's own test helper — same monorepo, so this
// is a real integration test against real HomeCloud code, not a mock of
// it) and HomeNotes pointed at it via HOMECLOUD_INTERNAL_URL. Both get
// their own fresh temp data directories; nothing here touches a real
// deployment or another test file's data.
//
// As with HomeCloud's own test helper, this relies on `node --test`
// running each test file in its own child process (verified once, see
// backend/README.md's testing section) — env vars are set sequentially
// and each app is require()'d immediately after, so each one's db.js
// captures the right DATA_DIR at the moment it's first loaded.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const homecloudTestApp = require("../../../backend/test/helpers/app");

let started = null;

async function startTestApp() {
  if (started) return started;

  const homecloud = await homecloudTestApp.startTestApp();

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "homenotes-test-"));
  process.env.DATA_DIR = dataDir;
  process.env.HOMECLOUD_INTERNAL_URL = homecloud.baseUrl;
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
    homecloud
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
  await homecloudTestApp.stopTestApp();
  started = null;
}

module.exports = { startTestApp, stopTestApp };
