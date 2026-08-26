// makeClient is a generic fetch wrapper (any baseUrl works) — reused as-is
// for talking to HomeSync. registerUser only knows how to register
// against HomeCloud, so it's used against the real HomeCloud instance
// test/helpers/app.js boots, and the resulting token is handed to a
// HomeSync-pointed client — exactly mirroring how a real phone would get
// a token from HomeCloud and then use it against HomeSync.
const { makeClient, registerUser } = require("../../../../homecore/test/helpers/client");

async function registerHomeSyncUser(homecloud, homesyncBaseUrl, overrides = {}) {
  const { username, password, user, token } = await registerUser(homecloud.baseUrl, overrides);
  const client = makeClient(homesyncBaseUrl);
  client.setToken(token);
  return { client, username, password, user, token };
}

module.exports = { makeClient, registerHomeSyncUser };
