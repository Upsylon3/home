const { HOMECORE_URL } = require("./verify");
const TOKEN_RE = /^hc_dg_[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const problem = (message, status = 502) => Object.assign(new Error(message), { status });

function createDelegationVerifier({ homecoreUrl = HOMECORE_URL, timeoutMs = 5000, maxPendingRequests = 100, now = Date.now } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 0xffffffff ||
      !Number.isSafeInteger(maxPendingRequests) || maxPendingRequests < 1) {
    throw new Error("Positive delegation timeout and pending-request limits are required.");
  }
  const url = new URL(homecoreUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Delegation verification requires a fixed HTTP(S) Core origin.");
  }
  let pending = 0;
  return async function verifyDelegation(token, { audience, action } = {}) {
    if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
    if (typeof audience !== "string" || !audience || audience.length > 64 || typeof action !== "string" || !action || action.length > 64) {
      throw problem("An explicit delegation audience and action are required.");
    }
    if (pending >= maxPendingRequests) throw problem("Delegation verification is busy. Try again.", 503);
    pending++;
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const res = await fetch(`${url.origin}/api/core/delegations/verify`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ audience, action }), signal, redirect: "error"
      });
      if (res.status === 401 || res.status === 403) { await res.body?.cancel(); return null; }
      if (res.status === 429 || res.status === 503) { await res.body?.cancel(); throw problem("Delegation verification is busy. Try again.", 503); }
      if (res.status !== 200 || !res.headers.get("content-type")?.includes("application/json")) {
        await res.body?.cancel(); throw problem("HomeCore could not verify this delegation. Try again.");
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of res.body) {
        size += chunk.length;
        if (size > 8192) throw problem("HomeCore returned an invalid delegation response.");
        chunks.push(chunk);
      }
      const principal = JSON.parse(Buffer.concat(chunks).toString("utf8")).delegation;
      if (!principal || principal.kind !== "delegation" || !Number.isSafeInteger(principal.subjectUserId) || principal.subjectUserId <= 0 ||
          !UUID_RE.test(principal.grantId) || !UUID_RE.test(principal.credentialId) || principal.integrationId !== "monitor-followup-v1" ||
          principal.audience !== audience || principal.action !== action || principal.dailyCreateLimit !== 20 ||
          typeof principal.expiresAt !== "string" || !Number.isFinite(Date.parse(principal.expiresAt)) || Date.parse(principal.expiresAt) <= now()) {
        throw problem("HomeCore returned an invalid delegation response.");
      }
      // Do not copy unknown fields, credentials or session identities through
      // an otherwise valid reply. Never cache or coalesce successful checks.
      return Object.freeze({ kind: "delegation", subjectUserId: principal.subjectUserId, grantId: principal.grantId,
        credentialId: principal.credentialId, integrationId: principal.integrationId, audience, action,
        expiresAt: principal.expiresAt, dailyCreateLimit: 20 });
    } catch (error) {
      if (signal.aborted) throw problem("HomeCore took too long to verify this delegation. Try again.", 504);
      if ([502, 503].includes(error.status)) throw error;
      throw problem("Couldn't reach HomeCore or read its delegation response. Try again.");
    } finally { pending--; }
  };
}

// Lazy initialization keeps legacy browser-session clients independent of
// configuration for the optional capability path.
let defaultVerifier;
async function verifyDelegation(token, context) {
  defaultVerifier ||= createDelegationVerifier();
  return defaultVerifier(token, context);
}
function requireDelegation({ audience, action, verifier = verifyDelegation }) {
  if (typeof audience !== "string" || !audience || typeof action !== "string" || !action) throw new Error("A fixed audience and action are required.");
  return async (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    try {
      const principal = await verifier(token, { audience, action });
      if (!principal) return res.status(403).json({ error: "Delegation is not authorized." });
      req.delegation = principal;
      next();
    } catch (error) {
      res.status(error.status || 502).json({ error: "Couldn't verify this delegation. Try again." });
    }
  };
}

module.exports = { createDelegationVerifier, verifyDelegation, requireDelegation };
