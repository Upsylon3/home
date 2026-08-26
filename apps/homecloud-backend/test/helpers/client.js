// makeClient is a generic fetch wrapper (any baseUrl works) — reused as-is
// for talking to this service. registerUser only knows how to register
// against HomeCore (which still embeds HomeCloud's own auth today — see
// homecore/src/app.js's TRANSITIONAL notice), so it's used against the
// real HomeCore instance test/helpers/app.js boots, and the resulting
// token is handed to a client pointed at this service instead — exactly
// mirroring how a real browser gets a token from logging in and then uses
// it against this service.
const { makeClient, registerUser } = require("../../../../homecore/test/helpers/client");

async function registerHomecloudBackendUser(homecore, homecloudBackendBaseUrl, overrides = {}) {
  const { username, password, user, token } = await registerUser(homecore.baseUrl, overrides);
  const client = makeClient(homecloudBackendBaseUrl);
  client.setToken(token);
  return { client, username, password, user, token };
}

module.exports = { makeClient, registerHomecloudBackendUser };
