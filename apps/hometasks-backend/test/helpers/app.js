// Starts REAL, isolated copies of the services a test needs:
//   1. HomeCore (identity), booted through its own test helper, and
//   2. HomeTasks, pointed at that HomeCore.
// No mocks: a test registers a real user in HomeCore, gets a real token, and
// uses it against HomeTasks, exactly like a browser would.
//
// IMPORTANT TRICK: `node --test` runs each test FILE in its own process, so
// each file gets a fresh app and a fresh temporary database. We set the
// environment variables first and only THEN require the app, because db.js
// reads DATA_DIR once, the moment it is first loaded.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const homecoreTestApp = require("../../../../homecore/test/helpers/app");

let started = null;

async function startTestApp() {
  if (started) return started;

  const homecore = await homecoreTestApp.startTestApp();

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hometasks-test-"));
  process.env.DATA_DIR = dataDir;
  process.env.HOMECORE_INTERNAL_URL = homecore.baseUrl;
  process.env.CORS_ORIGIN = "*";
  delete process.env.PORT;

  // eslint-disable-next-line global-require -- must load after the env vars are set
  const { app, db } = require("../../src/app");

  const server = http.createServer(app);
  // Port 0 means "pick any free port", so tests never collide with each other.
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  started = { app, db, server, baseUrl: `http://127.0.0.1:${port}`, dataDir, homecore };
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
