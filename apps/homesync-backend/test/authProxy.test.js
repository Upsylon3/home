const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestApp, stopTestApp } = require("./helpers/app");
const { makeClient, registerHomeSyncUser } = require("./helpers/client");

let homesyncUrl, homecloud;

before(async () => {
  const started = await startTestApp();
  homesyncUrl = started.baseUrl;
  homecloud = started.homecloud;
});

after(async () => {
  await stopTestApp();
});

// The Android app only ever talks to one address (HomeSync's) — this
// confirms that alone is enough to actually log in, not just to reach
// the already-authenticated sync endpoints.
test("login works entirely through HomeSync's proxy, with no direct call to HomeCloud", async () => {
  const client = makeClient(homesyncUrl);

  // Register directly against HomeCloud first (there's no register proxy —
  // account creation happens once, from a browser; only login needs to
  // work from the phone with just one address).
  const { username, password } = await registerHomeSyncUser(homecloud, homesyncUrl, {
    username: "proxy_login_user"
  });

  const login = await client.post("/api/homesync/auth/login", { username, password });
  assert.equal(login.status, 200);
  assert.ok(login.body.token);

  client.setToken(login.body.token);
  const me = await client.get("/api/homesync/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.username, username);
});

test("a wrong password proxies through HomeCloud's real 401, not a generic error", async () => {
  const client = makeClient(homesyncUrl);
  const { username } = await registerHomeSyncUser(homecloud, homesyncUrl, { username: "proxy_wrongpass_user" });

  const res = await client.post("/api/homesync/auth/login", { username, password: "TotallyWrongPassword1" });
  assert.equal(res.status, 401);
});

test("2FA verify proxies through correctly for an account with 2FA enabled", async () => {
  const { username, password } = await registerHomeSyncUser(homecloud, homesyncUrl, {
    username: "proxy_2fa_user"
  });

  // Set up 2FA directly against HomeCloud — an authenticated
  // account-management action a phone wouldn't be doing on first login
  // anyway, so it doesn't need to go through the proxy.
  const directLogin = await makeClient(homecloud.baseUrl).post("/api/auth/login", { username, password });
  const hc = makeClient(homecloud.baseUrl);
  hc.setToken(directLogin.body.token);

  const { TOTP, Secret } = require("otpauth");
  const setup = await hc.post("/api/auth/2fa/setup");
  const totp = new TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(setup.body.secret) });
  await hc.post("/api/auth/2fa/confirm", { code: totp.generate() });

  const proxyClient = makeClient(homesyncUrl);
  const loginAttempt = await proxyClient.post("/api/homesync/auth/login", { username, password });
  assert.equal(loginAttempt.body.requires2fa, true);

  const verify = await proxyClient.post("/api/homesync/auth/2fa/verify", {
    pendingToken: loginAttempt.body.pendingToken,
    code: totp.generate()
  });
  assert.equal(verify.status, 200);
  assert.ok(verify.body.token);
});
