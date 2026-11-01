const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

test("a HomeCore outage does not invalidate the user's shared session", async (t) => {
  const upstream = http.createServer((_req, res) => {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Service unavailable" }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  process.env.HOMECORE_INTERNAL_URL = `http://127.0.0.1:${upstream.address().port}`;
  const { requireAuth } = require("../src/middleware");

  const response = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; }
  };
  await requireAuth(
    { headers: { authorization: "Bearer disposable-outage-test-token" } },
    response,
    () => assert.fail("an unavailable identity service must not grant access")
  );
  // Every frontend clears the shared token on 401. A 5xx must instead
  // leave it in place so the same session can retry after recovery.
  assert.equal(response.statusCode, 502);
  assert.match(response.body.error, /HomeCore/);
});
