const { HOMECORE_URL } = require('./verify');
const TOKEN_RE = /^hc_app_[A-Za-z0-9_-]{43}$/;
const PERMISSIONS = ['files.read', 'files.write', 'files.delete', 'files.share'];
const problem = (message, status = 502) => Object.assign(new Error(message), { status });
function createApplicationVerifier({ homecoreUrl = HOMECORE_URL, timeoutMs = 5000, maxPendingRequests = 100, now = Date.now } = {}) {
  const url = new URL(homecoreUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 0xffffffff || !Number.isSafeInteger(maxPendingRequests) || maxPendingRequests < 1) {
    throw new Error('A fixed Core origin and positive verification limits are required.');
  }
  let pending = 0;
  return async (token, { audience, permission }) => {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
    if (audience !== 'homecloud' || !PERMISSIONS.includes(permission)) throw problem('An explicit supported application permission is required.');
    if (pending >= maxPendingRequests) throw problem('Application verification is busy. Try again.', 503);
    pending++;
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetch(url.origin + '/api/core/application-access/verify', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience, permission }), signal, redirect: 'error'
      });
      if ([401, 403].includes(response.status)) { await response.body?.cancel(); return null; }
      if ([429, 503].includes(response.status)) { await response.body?.cancel(); throw problem('Application verification is busy. Try again.', 503); }
      if (response.status !== 200 || !response.headers.get('content-type')?.includes('application/json')) {
        await response.body?.cancel(); throw problem('HomeCore could not verify application access. Try again.');
      }
      let size = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 8192) throw problem('HomeCore returned invalid application access.');
        chunks.push(chunk);
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8')).application;
      if (!value || value.kind !== 'application' || value.audience !== audience || value.permission !== permission ||
          typeof value.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.id) ||
          typeof value.applicationSlug !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(value.applicationSlug) ||
          !value.user || !Number.isSafeInteger(value.user.id) || value.user.id <= 0 || typeof value.user.username !== 'string' || !value.user.username ||
          value.user.role !== 'user' || !(value.user.quotaOverride === null || (Number.isFinite(value.user.quotaOverride) && value.user.quotaOverride >= 0)) ||
          typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= now()) {
        throw problem('HomeCore returned invalid application access.');
      }
      // No successful cache/coalescing: revocations and manifest changes are live.
      return Object.freeze({ kind: 'application', id: value.id, applicationSlug: value.applicationSlug, audience, permission,
        expiresAt: value.expiresAt, user: Object.freeze({ id: value.user.id, username: value.user.username, role: 'user', quotaOverride: value.user.quotaOverride }) });
    } catch (error) {
      if (signal.aborted) throw problem('HomeCore took too long to verify application access. Try again.', 504);
      if ([502, 503].includes(error.status)) throw error;
      throw problem('Could not verify application access. Try again.');
    } finally { pending--; }
  };
}
let defaultVerifier;
const verifyApplication = (token, context) => (defaultVerifier ||= createApplicationVerifier())(token, context);
function requirePermission(permission, { audience = 'homecloud', verifier = verifyApplication } = {}) {
  if (audience !== 'homecloud' || !PERMISSIONS.includes(permission)) throw new Error('A supported fixed audience and permission are required.');
  return async (req, res, next) => {
    const header = req.headers.authorization || '', token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token?.startsWith('hc_app_')) return require('./middleware').requireAuth(req, res, next);
    try {
      const application = await verifier(token, { audience, permission });
      if (!application) return res.status(403).json({ error: 'Application access is not authorized.' });
      req.application = application;
      req.user = application.user;
      next();
    } catch (error) {
      res.status(error.status || 502).json({ error: 'Could not verify application access. Try again.' });
    }
  };
}
module.exports = { createApplicationVerifier, verifyApplication, requirePermission };
