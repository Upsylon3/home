const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { origin, getJSON } = require("../src/upstream");

async function serve(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test("only fixed HTTP(S) origins are accepted", () => {
  assert.equal(origin("http://localhost:4900/"), "http://localhost:4900");
  for (const value of ["file:///etc/passwd", "https://user:pass@example.com", "https://example.com/path", "https://example.com/?x=1", "https://example.com/#x"]) {
    assert.throws(() => origin(value));
  }
});

test("redirects never receive forwarded credentials", async t => {
  let hits = 0;
  const destination = await serve(t, (req, res) => { hits++; res.end("{}"); });
  const upstream = await serve(t, (req, res) => { res.writeHead(307, { Location: destination }); res.end(); });
  await assert.rejects(getJSON(upstream, "disposable-test-token"));
  assert.equal(hits, 0);
});

test("deadline covers stalled headers and stalled bodies", async t => {
  for (const body of [false, true]) {
    const upstream = await serve(t, (req, res) => {
      if (body) { res.writeHead(200, { "Content-Type": "application/json" }); res.write('{"unfinished":'); }
    });
    await assert.rejects(getJSON(upstream, "disposable-test-token", { timeoutMs: 100 }));
  }
});

test("oversized streamed replies, bad JSON and non-JSON replies fail", async t => {
  for (const [contentType, body, maxBytes] of [["application/json", JSON.stringify({ value: "x".repeat(200) }), 100],
    ["application/json", "{broken", 1024], ["text/html", "<html>private</html>", 1024]]) {
    const upstream = await serve(t, (req, res) => { res.writeHead(200, { "Content-Type": contentType }); res.end(body); });
    await assert.rejects(getJSON(upstream, "disposable-test-token", { maxBytes }));
  }
});

test("a normal response uses only the supplied bearer token", async t => {
  const upstream = await serve(t, (req, res) => {
    assert.equal(req.headers.authorization, "Bearer disposable-test-token");
    res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}');
  });
  assert.deepEqual(await getJSON(upstream, "disposable-test-token"), { ok: true });
});
