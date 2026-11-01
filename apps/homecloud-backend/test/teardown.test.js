const { test } = require("node:test");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// A child bounds a broken teardown: a leaked upstream listener must fail
// the regression instead of leaving the entire test runner alive forever.
function runTeardownFixture(failCleanup, media = false) {
  execFileSync(process.execPath, ["-e", `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const { startTestApp, stopTestApp } = require(process.argv[1]);
    const { registerUser, makeClient } = require(process.argv[2]);
    (async () => {
      const started = await startTestApp();
      const { token } = await registerUser(started.homecore.baseUrl);
      const client = makeClient(started.homecloudBackend?.baseUrl || started.baseUrl);
      client.setToken(token);
      const form = new FormData();
      form.append('file', new Blob([Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')], { type: 'image/gif' }), 'fixture.gif');
      const upload = await client.post('/api/homecloud/files/upload', form, { raw: true });
      assert.equal(upload.status, 201);
      assert.equal(upload.body.file.hasThumbnail, true);
      const remove = fs.rmSync;
      const failure = new Error('Injected temporary directory cleanup failure');
      if (${failCleanup}) {
        fs.rmSync = (directory, options) => {
          if (directory === started.dataDir) throw failure;
          return remove(directory, options);
        };
      }
      try {
        if (${failCleanup}) await assert.rejects(stopTestApp(), error => error === failure);
        else await stopTestApp();
        assert.equal(started.server.listening, false);
        assert.equal(started.homecore.server.listening, false);
        assert.equal(started.db.open, false);
        assert.equal(started.homecore.db.open, false);
        assert.equal(fs.existsSync(started.homecore.dataDir), false);
        if (started.homecloudBackend) {
          assert.equal(started.homecloudBackend.server.listening, false);
          assert.equal(started.homecloudBackend.db.open, false);
          assert.equal(fs.existsSync(started.homecloudBackend.dataDir), false);
        }
        if (!${failCleanup}) assert.equal(fs.existsSync(started.dataDir), false);
      } finally {
        fs.rmSync = remove;
        remove(started.dataDir, { recursive: true, force: true });
      }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `, path.resolve(__dirname, media ? "../../homemedia-backend/test/helpers/app.js" : "helpers/app.js"), path.resolve(__dirname, "../../../homecore/test/helpers/client.js")], {
    timeout: 20000, stdio: "pipe"
  });
}

test("thumbnail teardown releases Windows file handles and closes both services", () => {
  runTeardownFixture(false);
});

test("cleanup failure remains visible and still closes the upstream identity service", () => {
  runTeardownFixture(true);
});

test("HomeMedia cleanup failure still closes HomeCloud and HomeCore", () => {
  runTeardownFixture(true, true);
});
