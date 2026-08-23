// A thin wrapper around Node's built-in fetch (stable since Node 18) so
// tests can write `api.post("/api/auth/login", {...})` instead of
// repeating fetch/JSON boilerplate everywhere. Deliberately not a new
// npm dependency (e.g. supertest) — Node already ships everything needed
// to drive a real HTTP request against the app under test.
function makeClient(baseUrl) {
  let token = null;

  async function request(method, path, body, { headers = {}, raw = false } = {}) {
    const opts = { method, headers: { ...headers } };
    if (token) opts.headers.Authorization = `Bearer ${token}`;

    if (raw) {
      // body is already a fetch-compatible body (e.g. FormData) — don't
      // touch Content-Type, let fetch set the multipart boundary itself.
      opts.body = body;
    } else if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(`${baseUrl}${path}`, opts);
    const contentType = res.headers.get("content-type") || "";
    let data = null;
    if (contentType.includes("application/json")) {
      data = await res.json();
    } else {
      data = await res.arrayBuffer();
    }
    return { status: res.status, headers: res.headers, body: data };
  }

  return {
    setToken(t) {
      token = t;
    },
    get: (path, opts) => request("GET", path, undefined, opts),
    post: (path, body, opts) => request("POST", path, body, opts),
    patch: (path, body, opts) => request("PATCH", path, body, opts),
    delete: (path, body, opts) => request("DELETE", path, body, opts)
  };
}

// Registers a brand-new user with a randomized username (so parallel
// tests within one file never collide) and returns a ready-to-use client
// already carrying that user's auth token, plus the raw credentials.
async function registerUser(baseUrl, overrides = {}) {
  const client = makeClient(baseUrl);
  const username = overrides.username || `user_${Math.random().toString(36).slice(2, 10)}`;
  const password = overrides.password || "CorrectHorseBattery1";

  const res = await client.post("/api/auth/register", { username, password });
  if (res.status !== 201) {
    throw new Error(`registerUser failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  client.setToken(res.body.token);
  return { client, username, password, user: res.body.user, token: res.body.token };
}

module.exports = { makeClient, registerUser };
