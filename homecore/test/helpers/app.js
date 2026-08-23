// Boots one isolated instance of the HomeCloud/HomeCore app for a test
// file: a fresh temp directory (so its SQLite database and uploaded files
// never touch a real deployment, or another test file's data) and a real
// TCP listener on an OS-assigned port, so tests exercise the exact same
// Express/multer/helmet stack a real client would hit.
//
// This relies on `node --test` running each test file in its own child
// process (verified: this is the default), since it sets env vars and
// then requires ../../src/app for the first time in that process — a
// second require in the same process would just hit Node's module cache
// and reuse whatever database the first call already opened.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

let started = null;

// disableRateLimit defaults to true: almost every test file cares about
// the behavior *behind* an auth/share route, not about the rate limiter
// itself, and would otherwise be flaky depending on how many requests ran
// before it (see src/rateLimiter.js). test/rateLimiting.test.js is the one
// place that passes { disableRateLimit: false } to actually exercise the
// real limiter.
async function startTestApp({ disableRateLimit = true } = {}) {
  if (started) return started;

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "homecloud-test-"));
  process.env.DATA_DIR = dataDir;
  process.env.JWT_SECRET = `test_secret_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  process.env.JWT_EXPIRES_IN = "1h";
  // Deliberately small so quota-enforcement tests don't need to upload
  // huge files to trip the limit.
  process.env.QUOTA_BYTES = String(2 * 1024 * 1024); // 2 MB
  process.env.TRASH_RETENTION_DAYS = "30";
  process.env.CORS_ORIGIN = "*";
  process.env.DISABLE_RATE_LIMIT_FOR_TESTS = disableRateLimit ? "true" : "false";

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
    dataDir
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
  started = null;
}

module.exports = { startTestApp, stopTestApp };
