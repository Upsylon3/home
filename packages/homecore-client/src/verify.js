// All seven Tier 1 backends delegate identity to HomeCore. Only an
// explicit authentication refusal may expire a session: an upstream
// outage must stay a retryable error, never a frontend-triggering 401.
const HOMECORE_URL = (process.env.HOMECORE_INTERNAL_URL || "http://homecore:4000").replace(/\/$/, "");

function verificationError(message, status = 502) {
  return Object.assign(new Error(message), { status });
}

// A separate verifier owns each cache. Options let tests exercise time and
// capacity boundaries using real HTTP without sleeping through cache TTLs.
function createVerifier({
  homecoreUrl = HOMECORE_URL,
  timeoutMs = 5000,
  cacheTtlMs = 5000,
  maxCacheEntries = 1000,
  maxPendingRequests = 100,
  now = () => performance.now()
} = {}) {
  const cache = new Map();
  const pending = new Map();

  async function fetchUser(token, startedAt) {
    const signal = AbortSignal.timeout(timeoutMs);
    let res;
    try {
      res = await fetch(`${homecoreUrl.replace(/\/$/, "")}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
        redirect: "error"
      });
      if (res.status === 401 || res.status === 403) {
        await res.body?.cancel();
        return null;
      }
      if (res.status !== 200) {
        await res.body?.cancel();
        throw verificationError("HomeCore couldn't verify this session. Please try again.");
      }
      // The deadline covers the body too, including a server that sends
      // headers promptly and then stalls before completing its JSON.
      const user = await res.json();
      if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 ||
          typeof user.username !== "string" || !user.username ||
          !["admin", "user"].includes(user.role)) {
        throw verificationError("HomeCore returned an invalid session response. Please try again.");
      }

      // Start the TTL before the request so a slow reply doesn't extend
      // the existing five-second window for observing account revocation.
      const expiresAt = startedAt + cacheTtlMs;
      if (expiresAt > now()) {
        if (cache.size >= maxCacheEntries) cache.delete(cache.keys().next().value);
        cache.set(token, { user, expiresAt });
      }
      return user;
    } catch (err) {
      if (signal.aborted) {
        throw verificationError("HomeCore took too long to verify this session. Please try again.", 504);
      }
      if (err.status === 502) throw err;
      // Never expose upstream bodies, URLs, tokens or parser exceptions.
      throw verificationError("Couldn't reach HomeCore or read its session response. Please try again.");
    }
  }

  return async function verifyUser(token) {
    const startedAt = now();
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= startedAt) cache.delete(key);
    }
    const cached = cache.get(token);
    if (cached) return cached.user;
    if (pending.has(token)) return pending.get(token);
    // Bound requests for distinct tokens as well as successful cache
    // entries; a slow HomeCore must not grow either map without limit.
    if (pending.size >= maxPendingRequests) {
      throw verificationError("Session verification is busy. Please try again.", 503);
    }
    const request = fetchUser(token, startedAt);
    pending.set(token, request);
    try {
      return await request;
    } finally {
      pending.delete(token);
    }
  };
}

const verifyUser = createVerifier();
module.exports = { verifyUser, HOMECORE_URL, createVerifier };
