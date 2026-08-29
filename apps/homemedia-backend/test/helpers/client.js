// makeClient is a generic fetch wrapper (any baseUrl works) — reused as-is
// for talking to HomeMedia. registerUser only knows how to register
// against HomeCore (which owns /api/auth/register), so it's used against
// the real HomeCore instance test/helpers/app.js boots (via
// apps/homecloud-backend's own test harness — see that file's header
// comment), and the resulting token is handed to a HomeMedia-pointed
// client — exactly mirroring how a real browser gets a token from
// HomeCore and then uses it against HomeMedia.
const { makeClient, registerUser } = require("../../../../homecore/test/helpers/client");

async function registerHomeMediaUser(homecore, homemediaBaseUrl, overrides = {}) {
  const { username, password, user, token } = await registerUser(homecore.baseUrl, overrides);
  const client = makeClient(homemediaBaseUrl);
  client.setToken(token);
  return { client, username, password, user, token };
}

module.exports = { makeClient, registerHomeMediaUser };
