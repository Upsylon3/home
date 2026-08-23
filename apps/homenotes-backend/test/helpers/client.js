// makeClient is a generic fetch wrapper (any baseUrl works) — reused as-is
// for talking to HomeNotes. registerUser only knows how to register
// against HomeCloud, so it's used against the real HomeCloud instance
// test/helpers/app.js boots, and the resulting token is handed to a
// HomeNotes-pointed client — exactly mirroring how a real browser would
// get a token from HomeCloud and then use it against HomeNotes.
const { makeClient, registerUser } = require("../../../backend/test/helpers/client");

async function registerHomeNotesUser(homecloud, homenotesBaseUrl, overrides = {}) {
  const { username, password, user, token } = await registerUser(homecloud.baseUrl, overrides);
  const client = makeClient(homenotesBaseUrl);
  client.setToken(token);
  return { client, username, password, user, token };
}

module.exports = { makeClient, registerHomeNotesUser };
