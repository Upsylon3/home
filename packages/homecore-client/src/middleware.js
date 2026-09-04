const { verifyUser } = require("./verify");

// Every app that has no identity of its own (see verify.js's header
// comment) needs exactly this: pull a Bearer token off the request, ask
// HomeCore whether it's valid, and either attach the resulting user to
// `req` or reject with 401. Shared here instead of duplicated per app.
//
// Unlike HomeCore's own internal auth check (which owns the users table
// directly and can check token_version/disabled locally — see
// homecore/src/middleware/authMiddleware.js), this middleware has no
// identity of its own to check against; `req.user` ends up with exactly
// the shape HomeCore's /api/auth/me returns: { id, username, role, ... }.
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
