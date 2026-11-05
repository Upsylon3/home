const express = require('express');
const bcrypt = require('bcryptjs');
const { TOTP, Secret } = require('otpauth');
const fs = require('node:fs');
const path = require('node:path');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { createRateLimiter } = require('../rateLimiter');
const { openPeerState } = require('./peerState');
const { createPeerTransport, ROUTES } = require('./peerTransport');
const { LIMIT, fields, strictJSON, fail } = require('./peerWire');

function createPeerRuntime({ db, dataDir, enabled = process.env.HOME_PEER_PROTOCOL_ENABLED === 'true',
  stateDir = process.env.HOME_PEER_STATE_DIR, send = createPeerTransport(), background = true } = {}) {
  const admin = express.Router(), peer = express.Router();
  for (const router of [admin, peer]) router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  let store, protocol, timer, working = false;
  const unavailable = (req, res) => res.status(enabled ? 503 : 404).json({ error: { code: enabled ? 'PEER_UNAVAILABLE' : 'NOT_FOUND', message: 'Peer protocol unavailable.' } });
  if (!enabled) { admin.use(unavailable); peer.use(unavailable); return { admin, peer, close() {} }; }
  try {
    if (!stateDir || !path.isAbsolute(stateDir)) fail();
    const root = fs.realpathSync(dataDir), authority = fs.realpathSync(stateDir);
    const contains = (a, b) => { const relative = path.relative(a, b); return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
    if (contains(root, authority) || contains(authority, root)) fail();
    const namespaceId = db.prepare('SELECT namespace_id FROM hc_peer_namespace WHERE id = 1').get()?.namespace_id;
    store = openPeerState({ stateDir, namespaceId });
    protocol = store.protocol({ coreDb: db });
  } catch {
    store?.close(); admin.use(requireAuth, requireAdmin, unavailable); peer.use(unavailable);
    return { admin, peer, close() {} };
  }
  const errorResponse = (res, error) => res.writableEnded || res.destroyed ? undefined : res.status(error.status || 503).json({ error: {
    code: error.code && /^PEER_[A-Z_]+$/.test(error.code) ? error.code : 'PEER_UNAVAILABLE', message: 'Peer operation refused or unavailable.'
  } });
  let actions = 0;
  const guarded = action => async (req, res) => {
    if (actions >= 32) return errorResponse(res, { status: 503, code: 'PEER_CAPACITY' });
    actions++;
    try { await action(req, res); } catch (error) { errorResponse(res, error); }
    finally { actions--; }
  };
  let active = 0;
  for (const router of [admin, peer]) {
    router.use((req, res, next) => {
      if (req.originalUrl.includes('?') || !req.secure) return res.status(400).json({ error: { code: 'PEER_HTTPS', message: 'HTTPS without query parameters is required.' } });
      if (active >= 32) return res.status(503).json({ error: { code: 'PEER_CAPACITY', message: 'Peer capacity exhausted.' } });
      active++;
      const deadline = setTimeout(() => {
        errorResponse(res, { status: 504, code: 'PEER_TIMEOUT' }); req.destroy();
      }, router === peer ? 5000 : 15000);
      deadline.unref();
      let released = false;
      const release = () => { if (!released) { clearTimeout(deadline); active--; released = true; } };
      res.once('finish', release); res.once('close', release); next();
    });
    router.use(createRateLimiter({ windowMs: router === admin ? 900000 : 60000,
      limit: router === admin ? 10 : 120, standardHeaders: 'draft-7', legacyHeaders: false,
      message: { error: { code: 'PEER_RATE', message: 'Peer request rate exceeded.' } } }));
    // A private parser avoids the general Express error logger retaining raw
    // invitations/passwords on malformed JSON. Reject duplicate keys too.
    router.use(express.raw({ type: 'application/json', limit: LIMIT }));
    router.use((req, res, next) => {
      try {
        if (req.method !== 'GET') {
          if (!Buffer.isBuffer(req.body)) fail(400, 'PEER_JSON');
          req.body = strictJSON(req.body);
        }
        next();
      } catch (error) { errorResponse(res, error); }
    });
    router.use((error, req, res, next) => errorResponse(res, { status: error.status === 413 ? 413 : 400, code: 'PEER_JSON' }));
  }
  admin.use(requireAuth, requireAdmin);
  admin.use((req, res, next) => {
    if (req.get('X-HOME-PEER-ADMIN') !== '1' || (req.get('Origin') && req.get('Origin') !== store.identity().origin) ||
        (req.get('Sec-Fetch-Site') && !['same-origin', 'none'].includes(req.get('Sec-Fetch-Site')))) {
      return errorResponse(res, { status: 403, code: 'PEER_ORIGIN' });
    }
    next();
  });
  async function owner(req, names) {
    const keys = [...names, 'password', 'consent', ...(Object.hasOwn(req.body || {}, 'totpCode') ? ['totpCode'] : [])];
    if (!fields(req.body, keys) || req.body.consent !== true || typeof req.body.password !== 'string' ||
        !req.body.password.length || req.body.password.length > 1024) fail(400, 'PEER_CONSENT');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user || user.disabled || user.role !== 'admin' || user.token_version !== req.sessionTokenVersion ||
        !await bcrypt.compare(req.body.password, user.password_hash)) fail(403, 'PEER_REAUTH');
    if (user.totp_enabled) {
      if (typeof req.body.totpCode !== 'string' || !/^\d{6}$/.test(req.body.totpCode)) fail(403, 'PEER_REAUTH');
      const totp = new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(user.totp_secret) });
      if (totp.validate({ token: req.body.totpCode, window: 1 }) === null) fail(403, 'PEER_REAUTH');
    }
    const current = db.prepare('SELECT role, disabled, token_version, password_hash, totp_secret, totp_enabled FROM users WHERE id = ?').get(user.id);
    if (!current || current.disabled || current.role !== 'admin' || current.token_version !== user.token_version ||
        current.password_hash !== user.password_hash || current.totp_secret !== user.totp_secret || current.totp_enabled !== user.totp_enabled) fail(403, 'PEER_REAUTH');
    return { userId: user.id, tokenVersion: user.token_version, approvedAt: Date.now() };
  }
  admin.get('/', guarded((req, res) => res.json({ identity: store.identity(), pairs: protocol.list() })));
  admin.post('/offers', guarded(async (req, res) => res.status(201).json(await protocol.offer(await owner(req, [])))));
  admin.post('/accept', guarded(async (req, res) => {
    const approval = await owner(req, ['invitation', 'peerFingerprint']);
    const prepared = await protocol.prepareAcceptance(req.body.invitation, req.body.peerFingerprint, approval);
    const result = await send(prepared.origin, 'accept', { acceptance: prepared.acceptance, secret: prepared.secret });
    await protocol.receiveResponse(prepared.pairId, 'accept', prepared.acceptance, result);
    res.json(protocol.get(prepared.pairId));
  }));
  admin.post('/:pairId/approve', guarded(async (req, res) => {
    const approval = await owner(req, ['transcriptFingerprint', 'peerFingerprint']);
    const approved = protocol.approve(req.params.pairId, req.body.transcriptFingerprint, req.body.peerFingerprint, approval);
    if (approved.side === 'A') {
      for (const operation of ['confirm', 'activate']) {
        const request = await protocol.request(req.params.pairId, operation);
        const result = await send(request.origin, operation, { message: request.message });
        await protocol.receiveResponse(req.params.pairId, operation, request.message, result);
      }
    }
    res.json(protocol.get(req.params.pairId));
  }));
  admin.post('/:pairId/status', guarded(async (req, res) => {
    await owner(req, []);
    res.json(await protocol.liveStatus(req.params.pairId, send));
  }));
  admin.post('/:pairId/revoke', guarded(async (req, res) => {
    const approval = await owner(req, []);
    const result = protocol.revoke(req.params.pairId, approval);
    // Revocation commits before notification, even if the peer is unreachable.
    res.json(result);
    flush();
  }));
  peer.post('/accept', guarded(async (req, res) => {
    if (!fields(req.body, ['acceptance', 'secret'])) fail(400, 'PEER_JSON');
    res.json(await protocol.accept(req.body));
  }));
  for (const operation of Object.keys(ROUTES).filter(value => value !== 'accept')) {
    peer.post(`/${operation}`, guarded(async (req, res) => {
      if (!fields(req.body, ['message'])) fail(400, 'PEER_JSON');
      res.json(await protocol.receive(operation, req.body.message));
    }));
  }
  for (const router of [admin, peer]) router.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }));
  for (const router of [admin, peer]) router.use((error, req, res, next) => errorResponse(res, { status: 503, code: 'PEER_UNAVAILABLE' }));
  async function flush() {
    if (working) return;
    working = true;
    try { await protocol.flushNotifications(send); } catch { /* Fail closed; retry later. */ }
    finally { working = false; }
  }
  if (background) { timer = setInterval(flush, 30000); timer.unref(); }
  return { admin, peer, close() { clearInterval(timer); store.close(); } };
}

module.exports = { createPeerRuntime };
