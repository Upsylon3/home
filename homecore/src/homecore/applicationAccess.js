const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');
const { createRateLimiter } = require('../rateLimiter');
const { createApplicationAccessStore } = require('./applicationAccessStore');
const store = createApplicationAccessStore(db), router = express.Router();
const fields = (body, keys) => body && typeof body === 'object' && !Array.isArray(body) &&
  Object.keys(body).length === keys.length && Object.keys(body).every(key => keys.includes(key));
const fail = (res, status, code, message) => res.status(status).json({ error: { code, message, requestId: res.req?.requestId } });
const guarded = action => (req, res) => {
  try { action(req, res); }
  catch (error) { fail(res, error.status || 500, error.code || 'ACCESS_ERROR', error.status ? error.message : 'Application access failed.'); }
};
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(createRateLimiter({ windowMs: 60000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));
router.post('/verify', guarded((req, res) => {
  if (!fields(req.body, ['audience', 'permission']) || Object.keys(req.query).length) return fail(res, 400, 'INVALID_ACCESS_REQUEST', 'An explicit audience and permission are required.');
  const header = req.headers.authorization || '';
  const application = store.verify(header.startsWith('Bearer ') ? header.slice(7) : null, req.body.audience, req.body.permission);
  if (!application) return fail(res, 403, 'ACCESS_REFUSED', 'Application access is not authorized.');
  res.json({ application });
}));
router.use(requireAuth);
router.get('/', guarded((req, res) => res.json({ access: store.list(req.user.id) })));
router.post('/', guarded((req, res) => {
  if (!fields(req.body, ['applicationSlug', 'permissions', 'consent']) || typeof req.body.applicationSlug !== 'string' ||
      !/^[a-z][a-z0-9-]{1,31}$/.test(req.body.applicationSlug) || req.body.consent !== true || Object.keys(req.query).length) {
    return fail(res, 400, 'CONSENT_REQUIRED', 'Select an application, explicit permissions and confirm access.');
  }
  res.status(201).json(store.issue(req.user.id, req.sessionTokenVersion, req.body.applicationSlug, req.body.permissions));
}));
router.delete('/:id', guarded((req, res) => { store.revoke(req.user.id, req.params.id); res.status(204).end(); }));
module.exports = router;
