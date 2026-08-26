// Boots two real, isolated services for a test file: a genuine HomeCore
// instance (reusing HomeCore's own test helper — same monorepo, so this
// is a real integration test against real HomeCore code, not a mock of
// it) and this service pointed at it via HOMECLOUD_INTERNAL_URL. Both get
// their own fresh temp data directories; nothing here touches a real
// deployment or another test file's data. Same pattern as
// homemedia-backend/test/helpers/app.js — see its comment for why relying
// on `node --test` running each file in its own child process matters
// here (env vars set sequentially, each app require()'d right after).
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const homecoreTestApp = require("../../../../homecore/test/helpers/app");

let started = null;

async function startTestApp() {
  if (started) return started;

  const homecore = await homecoreTestApp.startTestApp();

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "homecloud-backend-test-"));
  process.env.DATA_DIR = dataDir;
  process.env.HOMECLOUD_INTERNAL_URL = homecore.baseUrl;
  process.env.CORS_ORIGIN = "*";
  delete process.env.PORT; // avoid ever accidentally colliding with a fixed port in tests

  // homecore's own test harness (booted just above) already sets these to
  // the same values, and since everything here runs in one process they'd
  // be inherited either way — set explicitly anyway so this harness stays
  // correct and self-documenting even if that ever changes upstream.
  // Small quota (2 MB, matching homecore/test/files.test.js's own value)
  // so quota-exceeded tests don't need to actually upload huge files.
  process.env.QUOTA_BYTES = String(2 * 1024 * 1024);
  process.env.TRASH_RETENTION_DAYS = "30";

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
