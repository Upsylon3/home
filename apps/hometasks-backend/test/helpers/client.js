// Re-uses HomeCore's tiny fetch wrapper. Registering a user happens against
// HomeCore (it owns accounts); the token we get back is then handed to a
// client that talks to HomeTasks. That mirrors a real browser.
const { makeClient, registerUser } = require("../../../../homecore/test/helpers/client");

async function registerHomeTasksUser(homecore, homeTasksBaseUrl, overrides = {}) {
  const { username, password, user, token } = await registerUser(homecore.baseUrl, overrides);
  const client = makeClient(homeTasksBaseUrl);
  client.setToken(token);
  return { client, username, password, user, token };
}

module.exports = { makeClient, registerHomeTasksUser };
