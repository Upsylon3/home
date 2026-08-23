const { verifyUser } = require("./homecloudClient");

// Unlike HomeCloud's own authMiddleware (which owns the users table and
// can check token_version/disabled locally), HomeMedia has no identity of
// its own — every request is authenticated by asking HomeCloud (see
// homecloudClient.js). req.user ends up with the exact same shape
// HomeCloud's /api/auth/me returns: { id, username, role, ... }.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Sign in required." });

  try {
    const user = await verifyUser(token);
    if (!user) return res.status(401).json({ error: "Your session has expired. Please sign in again." });
    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || "Couldn't verify this session." });
  }
}

module.exports = { requireAuth };
