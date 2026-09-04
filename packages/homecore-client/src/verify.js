// The one thing every app in this file duplicated three times: asking
// HomeCore's own "who is this token?" route, with a short cache so a
// single page load that fires off a few dozen requests in parallel (a
// gallery grid, say) doesn't turn into a few dozen near-simultaneous
// network round-trips for the exact same answer.
//
// Shared by every app that has no identity of its own —
// apps/homemedia-backend, apps/homesync-backend, and
// apps/homenotes-backend all use this instead of each maintaining their
// own copy. Each app's own homecloudClient.js still exists — it only
// contains the app-specific HomeCloud calls (listFiles, uploadFile,
// resolveFolderPath, and so on) that are genuinely different per app.

const HOMECORE_URL = (process.env.HOMECORE_INTERNAL_URL || "http://homecore:4000").replace(/\/$/, "");

// Verifying every request against HomeCore's own /api/auth/me is what
// makes every app that has no identity of its own respect exactly the
// same account state HomeCore already tracks — disabled accounts,
// logout-everywhere, password changes, all of it — without any of them
// keeping their own copy of any of that (see ARCHITECTURE.md's "delegated
// auth" principle). The cost is a network hop per request; this cache
// exists purely to absorb a burst of near-simultaneous requests, not to
// compromise on how fresh "signed out" is. 5 seconds of staleness is a
// fair trade.
const meCache = new Map(); // token -> { user, expiresAt }
const ME_CACHE_TTL_MS = 5000;

async function verifyUser(token) {
  const cached = meCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  let res;
  try {
    res = await fetch(`${HOMECORE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  } catch (err) {
    const wrapped = new Error("Couldn't reach HomeCore to verify this session.");
    wrapped.status = 502;
    throw wrapped;
  }
  if (!res.ok) {
    meCache.delete(token);
    return null;
  }
  const user = await res.json();
  meCache.set(token, { user, expiresAt: Date.now() + ME_CACHE_TTL_MS });
  return user;
}

module.exports = { verifyUser, HOMECORE_URL };
