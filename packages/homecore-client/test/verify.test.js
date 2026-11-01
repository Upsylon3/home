const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createVerifier } = require("../src/verify");

const USER = { id: 1, username: "test-user", role: "user", quotaOverride: null };

async function upstream(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function sendUser(res, user = USER) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(user));
}

test("only explicit authentication refusals invalidate a session", async (t) => {
  for (const status of [401, 403, 429, 500, 502, 503, 404]) {
    await t.test(`HTTP ${status}`, async (t) => {
      const url = await upstream(t, (_req, res) => {
        res.writeHead(status);
        res.end("upstream detail that must not reach the client");
      });
      const verify = createVerifier({ homecoreUrl: url });
      if (status === 401 || status === 403) {
        assert.equal(await verify("test-token"), null);
      } else {
        await assert.rejects(verify("test-token"), (err) => {
          assert.equal(err.status, 502);
          assert.doesNotMatch(err.message, /upstream detail|test-token/);
          return true;
        });
      }
    });
  }
});

test("invalid JSON and malformed successful identities fail closed", async (t) => {
  for (const body of ["<html>offline</html>", "null", "{}", "[]",
    JSON.stringify({ ...USER, id: 0 }), JSON.stringify({ ...USER, role: "root" }),
    JSON.stringify({ ...USER, username: null })]) {
    await t.test(body, async (t) => {
      const url = await upstream(t, (_req, res) => res.end(body));
      await assert.rejects(createVerifier({ homecoreUrl: url })("test-token"), { status: 502 });
    });
  }
});

test("redirects are not followed with an identity credential", async (t) => {
  let redirected = false;
  const url = await upstream(t, (req, res) => {
    if (req.url !== "/api/auth/me") redirected = true;
    res.writeHead(302, { Location: "/another-endpoint" });
    res.end();
  });
  await assert.rejects(createVerifier({ homecoreUrl: url })("test-token"), { status: 502 });
  assert.equal(redirected, false);
});

test("connection failure remains retryable", async (t) => {
  const url = await upstream(t, (req) => req.socket.destroy());
  await assert.rejects(createVerifier({ homecoreUrl: url })("test-token"), { status: 502 });
});

test("the deadline covers both missing headers and an incomplete body", async (t) => {
  for (const sendHeaders of [false, true]) {
    await t.test(sendHeaders ? "stalled body" : "stalled headers", async (t) => {
      let stalled = true;
      const url = await upstream(t, (_req, res) => {
        if (!stalled) return sendUser(res);
        if (sendHeaders) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.write('{"id":');
        }
      });
      const verify = createVerifier({ homecoreUrl: url, timeoutMs: 100 });
      await assert.rejects(verify("test-token"), { status: 504 });
      stalled = false;
      assert.deepEqual(await verify("test-token"), USER, "a timed-out request must release its pending entry");
    });
  }
});

test("a failed verification is not cached and the same session recovers", async (t) => {
  let status = 503;
  const url = await upstream(t, (_req, res) => {
    if (status === 200) return sendUser(res);
    res.writeHead(status);
    res.end();
  });
  const verify = createVerifier({ homecoreUrl: url });
  await assert.rejects(verify("test-token"), { status: 502 });
  status = 401;
  assert.equal(await verify("test-token"), null);
  status = 200;
  assert.deepEqual(await verify("test-token"), USER);
});

test("concurrent requests for the same token share one verification", async (t) => {
  const requests = [];
  const url = await upstream(t, (req, res) => {
    requests.push({ path: req.url, authorization: req.headers.authorization });
    sendUser(res);
  });
  const verify = createVerifier({ homecoreUrl: `${url}/` });
  const users = await Promise.all(Array.from({ length: 20 }, () => verify("test-token")));
  assert.ok(users.every((user) => user.id === USER.id));
  assert.deepEqual(requests, [{ path: "/api/auth/me", authorization: "Bearer test-token" }]);
});

test("cache expiry cannot be extended by a slow verification or cache hits", async (t) => {
  let clock = 0;
  let calls = 0;
  let status = 200;
  const url = await upstream(t, (_req, res) => {
    calls++;
    if (status !== 200) { res.writeHead(status); res.end(); return; }
    clock += 4000;
    sendUser(res);
  });
  const verify = createVerifier({ homecoreUrl: url, now: () => clock });
  await verify("test-token");
  clock = 4999;
  await verify("test-token");
  assert.equal(calls, 1);
  clock = 5000;
  status = 401;
  assert.equal(await verify("test-token"), null);
  assert.equal(calls, 2);
});

test("cache capacity is bounded and never confuses different users", async (t) => {
  const calls = [];
  const url = await upstream(t, (req, res) => {
    const username = req.headers.authorization.slice(7);
    calls.push(username);
    sendUser(res, { ...USER, username });
  });
  const verify = createVerifier({ homecoreUrl: url, maxCacheEntries: 2 });
  for (const token of ["one", "two", "three", "two", "one"]) {
    assert.equal((await verify(token)).username, token);
  }
  assert.deepEqual(calls, ["one", "two", "three", "one"]);
});

test("distinct pending requests are bounded without rejecting shared requests", async (t) => {
  let respond;
  let received;
  const requestReceived = new Promise((resolve) => { received = resolve; });
  const url = await upstream(t, (_req, res) => {
    respond = () => sendUser(res);
    received();
  });
  const verify = createVerifier({ homecoreUrl: url, maxPendingRequests: 1 });
  const first = verify("one");
  await requestReceived;
  const duplicate = verify("one");
  await assert.rejects(verify("two"), { status: 503 });
  respond();
  assert.deepEqual(await first, USER);
  assert.deepEqual(await duplicate, USER);
});
