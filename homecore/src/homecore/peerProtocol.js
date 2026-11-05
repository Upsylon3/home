const { fields, uuid, nonce, hash, random, decode, sign, verify, timeClaims, transcript, fail } = require('./peerWire');
const { validateDescriptor } = require('./peerState');
const OFFER_TYPE = 'home-pair-offer+jwt', ACCEPT_TYPE = 'home-pair-accept+jwt', MESSAGE_TYPE = 'home-peer-message+jwt';
const crypto = require('node:crypto');

function createPeerProtocol({ db, privateKey, mutate, audit, store, now, coreDb,
  replayLimit = 4096, totalReplayLimit = 16384 }) {
  db.pragma('foreign_keys = ON');
  db.transaction(() => db.exec(`
    CREATE TABLE IF NOT EXISTS peer_invitations (
      pair_id TEXT PRIMARY KEY, invitation_id TEXT NOT NULL UNIQUE, offer TEXT NOT NULL,
      secret_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, acceptance TEXT, cancelled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS peer_pairings (
      pair_id TEXT PRIMARY KEY, peer_record_id TEXT NOT NULL REFERENCES peers(pair_id),
      side TEXT NOT NULL CHECK (side IN ('A', 'B')), offer TEXT NOT NULL, acceptance TEXT NOT NULL,
      fingerprint TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('pending', 'ready', 'active')),
      local_generation TEXT NOT NULL, expires_at INTEGER NOT NULL, approval TEXT
    );
    CREATE TABLE IF NOT EXISTS peer_replays (
      sender TEXT NOT NULL, message_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
      PRIMARY KEY (sender, message_id)
    );
    CREATE TABLE IF NOT EXISTS peer_transactions (
      pair_id TEXT NOT NULL REFERENCES peer_pairings(pair_id), operation TEXT NOT NULL,
      transaction_id TEXT NOT NULL, request_hash TEXT NOT NULL, result TEXT NOT NULL,
      PRIMARY KEY (pair_id, operation, transaction_id)
    );
    CREATE TABLE IF NOT EXISTS peer_notify (
      pair_id TEXT PRIMARY KEY REFERENCES peer_pairings(pair_id), attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt INTEGER NOT NULL DEFAULT 0
    );
    CREATE TRIGGER IF NOT EXISTS peer_pairing_retained BEFORE DELETE ON peer_pairings
    BEGIN SELECT RAISE(ABORT, 'Pairing transcripts must be retained'); END;
    CREATE TRIGGER IF NOT EXISTS peer_pairing_pins BEFORE UPDATE ON peer_pairings
    WHEN NEW.pair_id != OLD.pair_id OR NEW.peer_record_id != OLD.peer_record_id OR NEW.side != OLD.side
      OR NEW.offer != OLD.offer OR NEW.acceptance != OLD.acceptance OR NEW.fingerprint != OLD.fingerprint
      OR NEW.local_generation != OLD.local_generation OR NEW.expires_at != OLD.expires_at
    BEGIN SELECT RAISE(ABORT, 'Pairing transcripts are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS peer_invitation_retained BEFORE DELETE ON peer_invitations
    BEGIN SELECT RAISE(ABORT, 'Invitations must be retained'); END;
  `)).immediate();
  const identity = () => store.identity();
  const seconds = () => Math.floor(now() / 1000);
  function ownerValid(owner) {
    if (!fields(owner, ['userId', 'tokenVersion', 'approvedAt']) || !Number.isSafeInteger(owner.userId) || owner.userId < 1 ||
        !Number.isSafeInteger(owner.tokenVersion) || !Number.isSafeInteger(owner.approvedAt) ||
        owner.approvedAt > now() + 30000 || now() - owner.approvedAt > 300000) fail(403, 'PEER_REAUTH');
    const user = coreDb.prepare('SELECT role, disabled, token_version FROM users WHERE id = ?').get(owner.userId);
    if (!user || user.role !== 'admin' || user.disabled || user.token_version !== owner.tokenVersion) fail(403, 'PEER_REAUTH');
  }
  function localAudit(operation, pairId, owner, time) {
    db.prepare('INSERT INTO audit (operation, pair_id, at, actor, local_generation) VALUES (?, ?, ?, ?, ?)')
      .run(operation, pairId, time, `core-user:${owner.userId}`, identity().instanceGeneration);
  }
  function pair(pairId) {
    if (!uuid(pairId)) fail(400, 'PEER_PAIR');
    const row = db.prepare('SELECT * FROM peer_pairings WHERE pair_id = ?').get(pairId);
    if (!row) fail(404, 'PEER_PAIR');
    const peer = db.prepare('SELECT * FROM peers WHERE pair_id = ?').get(row.peer_record_id);
    if (!peer) fail();
    return { ...row, peer, remote: validateDescriptor(JSON.parse(peer.descriptor)) };
  }
  function state(row) {
    if (row.peer.status !== 'pending') return row.peer.status;
    if (row.local_generation !== identity().instanceGeneration) return 'suspended';
    if (row.state !== 'active' && row.expires_at < seconds()) return 'expired';
    return row.state;
  }
  function usable(row, terminal = false) {
    const value = state(row);
    if (!terminal && !['pending', 'ready', 'active'].includes(value)) fail(403, 'PEER_INACTIVE');
    return value;
  }
  function describe(row) {
    return { pairId: row.pair_id, peerRecordId: row.peer_record_id, side: row.side, state: state(row),
      transcriptFingerprint: row.fingerprint, peer: row.remote, expiresAt: row.expires_at,
      localApproved: Boolean(row.approval), effectiveActive: false };
  }
  function describeOffer(row) {
    return { pairId: row.pair_id, side: 'A', state: row.cancelled ? 'revoked' : row.expires_at < seconds() ? 'expired' : 'offered',
      expiresAt: row.expires_at, effectiveActive: false };
  }
  function ledger(message) {
    const current = seconds();
    db.prepare('DELETE FROM peer_replays WHERE expires_at < ?').run(current);
    if (db.prepare('SELECT 1 FROM peer_replays WHERE sender = ? AND message_id = ?').get(message.iss, message.jti)) fail(409, 'PEER_REPLAY');
    if (db.prepare('SELECT count(*) AS n FROM peer_replays WHERE sender = ?').get(message.iss).n >= replayLimit ||
        db.prepare('SELECT count(*) AS n FROM peer_replays').get().n >= totalReplayLimit) fail(503, 'PEER_CAPACITY');
    db.prepare('INSERT INTO peer_replays VALUES (?, ?, ?)').run(message.iss, message.jti, message.exp + 30);
  }
  function envelope(row, operation, transactionId, body) {
    const local = identity(), time = seconds();
    return { v: 1, iss: local.serverId, aud: row.remote.serverId, targetOrigin: row.remote.origin,
      senderGeneration: local.instanceGeneration, recipientGeneration: row.remote.instanceGeneration,
      pairId: row.pair_id, operation, transactionId, iat: time, exp: time + 60, jti: random(), body };
  }
  function checkEnvelope(message, row, operation, changedSender = false) {
    const local = identity();
    if (!fields(message, ['v', 'iss', 'aud', 'targetOrigin', 'senderGeneration', 'recipientGeneration',
      'pairId', 'operation', 'transactionId', 'iat', 'exp', 'jti', 'body']) || message.v !== 1 ||
      message.iss !== row.remote.serverId || message.aud !== local.serverId || message.targetOrigin !== local.origin ||
      (!changedSender && message.senderGeneration !== row.remote.instanceGeneration) || !uuid(message.senderGeneration) || message.recipientGeneration !== local.instanceGeneration ||
      message.pairId !== row.pair_id || message.operation !== operation || !uuid(message.transactionId) || !nonce(message.jti)) fail();
    timeClaims(message, now(), 60);
  }
  async function peerMessage(token, row, operation) {
    const message = await verify(token, MESSAGE_TYPE, row.remote);
    if (message && message.senderGeneration !== row.remote.instanceGeneration) {
      // Only an otherwise valid message from the pinned key can suspend a pair.
      // An unauthenticated packet cannot manufacture a generation change.
      checkEnvelope(message, row, operation, true);
      mutate(() => {
        const current = pair(row.pair_id);
        if (current.peer.status === 'pending') store.transition(current.peer_record_id, 'suspended');
      });
      fail(403, 'PEER_GENERATION');
    }
    return message;
  }
  const signed = payload => sign(payload, MESSAGE_TYPE, identity(), privateKey);
  async function checkedOffer(offer, fingerprint) {
    const data = decode(offer).payload;
    if (!fields(data, ['v', 'operation', 'pairId', 'invitationId', 'from', 'nonce', 'iat', 'exp']) || data.v !== 1 ||
        data.operation !== 'offer' || !uuid(data.pairId) || !uuid(data.invitationId) || !nonce(data.nonce)) fail(400, 'PEER_OFFER');
    await verify(offer, OFFER_TYPE, data.from);
    if (data.from.keyId !== fingerprint || data.from.serverId === identity().serverId || data.from.origin === identity().origin ||
        data.from.keyId === identity().keyId) fail(403, 'PEER_FINGERPRINT');
    timeClaims(data, now(), 600);
    return data;
  }
  async function response(row, operation, request, result) {
    const token = await signed(envelope(row, `${operation}-response`, row.pair_id,
      { requestHash: hash(request), transcriptFingerprint: row.fingerprint, state: result }));
    // A local revoke/recovery while asynchronous signing runs wins over success.
    mutate(() => {
      const current = pair(row.pair_id);
      usable(current, operation === 'status' || operation === 'revoke');
      if (operation === 'status' && state(current) !== result) fail(503, 'PEER_CHANGED');
    });
    return { message: token };
  }
  const receiving = new Map();
  const api = {
    list() {
      return mutate(() => [...db.prepare('SELECT pair_id FROM peer_pairings ORDER BY rowid').all().map(row => describe(pair(row.pair_id))),
        ...db.prepare('SELECT * FROM peer_invitations WHERE pair_id NOT IN (SELECT pair_id FROM peer_pairings)').all().map(describeOffer)]);
    },
    get(pairId) {
      return mutate(() => {
        if (!uuid(pairId)) fail(400, 'PEER_PAIR');
        if (db.prepare('SELECT 1 FROM peer_pairings WHERE pair_id = ?').get(pairId)) return describe(pair(pairId));
        const invitation = db.prepare('SELECT * FROM peer_invitations WHERE pair_id = ?').get(pairId);
        if (!invitation) fail(404, 'PEER_PAIR');
        return describeOffer(invitation);
      });
    },
    async offer(owner) {
      mutate(() => {});
      ownerValid(owner);
      const local = identity(), time = seconds(), pairId = crypto.randomUUID();
      const data = { v: 1, operation: 'offer', pairId, invitationId: crypto.randomUUID(), from: local,
        nonce: random(), iat: time, exp: time + 600 };
      const offer = await sign(data, OFFER_TYPE, local, privateKey), secret = random();
      mutate(at => {
        ownerValid(owner);
        if (identity().instanceGeneration !== local.instanceGeneration) fail();
        if (db.prepare('SELECT count(*) AS n FROM peer_invitations WHERE expires_at >= ? AND acceptance IS NULL AND cancelled = 0').get(time).n >= 16 ||
            db.prepare('SELECT count(*) AS n FROM peer_invitations').get().n >= 10000) fail(503, 'PEER_CAPACITY');
        db.prepare('INSERT INTO peer_invitations (pair_id, invitation_id, offer, secret_hash, expires_at) VALUES (?, ?, ?, ?, ?)')
          .run(pairId, data.invitationId, offer, hash(secret), data.exp);
        localAudit('offer-created', pairId, owner, at);
      });
      return { pairId, invitation: { offer, secret }, expiresAt: data.exp };
    },
    async prepareAcceptance(invitation, fingerprint, owner) {
      mutate(() => {});
      ownerValid(owner);
      if (!fields(invitation, ['offer', 'secret']) || !nonce(invitation.secret)) fail(400, 'PEER_INVITATION');
      const offer = await checkedOffer(invitation.offer, fingerprint);
      const existing = db.prepare('SELECT pair_id FROM peer_pairings WHERE pair_id = ?').get(offer.pairId);
      if (existing) return mutate(() => {
        ownerValid(owner);
        const row = pair(offer.pairId); usable(row);
        if (row.side !== 'B' || row.offer !== invitation.offer || row.state !== 'pending') fail(409, 'PEER_CONFLICT');
        return { acceptance: row.acceptance, secret: invitation.secret, origin: row.remote.origin, pairId: row.pair_id };
      });
      const local = identity(), time = seconds();
      const payload = { v: 1, operation: 'accept', pairId: offer.pairId, invitationId: offer.invitationId,
        offer: invitation.offer, from: local, nonce: random(), iat: time, exp: Math.min(time + 600, offer.exp) };
      const acceptance = await sign(payload, ACCEPT_TYPE, local, privateKey);
      return mutate(at => {
        ownerValid(owner);
        if (local.instanceGeneration !== identity().instanceGeneration) fail();
        if (db.prepare('SELECT 1 FROM peer_pairings WHERE pair_id = ?').get(offer.pairId)) fail(409, 'PEER_CONFLICT');
        if (db.prepare('SELECT count(*) AS n FROM peer_pairings').get().n >= 10000) fail(503, 'PEER_CAPACITY');
        const record = store.stage(offer.from, fingerprint);
        if (record.status !== 'pending') fail(403, 'PEER_INACTIVE');
        db.prepare(`INSERT INTO peer_pairings VALUES (?, ?, 'B', ?, ?, ?, 'pending', ?, ?, NULL)`)
          .run(offer.pairId, record.pairId, invitation.offer, acceptance, transcript(invitation.offer, acceptance),
            local.instanceGeneration, offer.exp);
        localAudit('offer-accepted', offer.pairId, owner, at);
        return { acceptance, secret: invitation.secret, origin: offer.from.origin, pairId: offer.pairId };
      });
    },
    async accept({ acceptance, secret }) {
      mutate(() => {});
      if (!nonce(secret)) fail();
      const data = decode(acceptance).payload;
      if (!fields(data, ['v', 'operation', 'pairId', 'invitationId', 'offer', 'from', 'nonce', 'iat', 'exp']) ||
          data.v !== 1 || data.operation !== 'accept' || !uuid(data.pairId) || !uuid(data.invitationId) || !nonce(data.nonce)) fail();
      await verify(acceptance, ACCEPT_TYPE, data.from);
      timeClaims(data, now(), 600);
      const offerRow = db.prepare('SELECT * FROM peer_invitations WHERE pair_id = ?').get(data.pairId);
      if (!offerRow || offerRow.offer !== data.offer || offerRow.invitation_id !== data.invitationId ||
          !crypto.timingSafeEqual(Buffer.from(offerRow.secret_hash), Buffer.from(hash(secret)))) fail();
      const ownOffer = await verify(data.offer, OFFER_TYPE, identity());
      timeClaims(ownOffer, now(), 600);
      const row = mutate(at => {
        const invitation = db.prepare('SELECT * FROM peer_invitations WHERE pair_id = ?').get(data.pairId);
        if (invitation.cancelled || ownOffer.from.instanceGeneration !== identity().instanceGeneration || invitation.expires_at < seconds() || data.exp > ownOffer.exp) fail();
        if (invitation.acceptance) {
          if (invitation.acceptance !== acceptance) fail(409, 'PEER_BOUND');
          const current = pair(data.pairId); usable(current); return current;
        }
        const record = store.stage(data.from, data.from.keyId);
        if (record.status !== 'pending') fail();
        db.prepare('UPDATE peer_invitations SET acceptance = ? WHERE pair_id = ?').run(acceptance, data.pairId);
        db.prepare(`INSERT INTO peer_pairings VALUES (?, ?, 'A', ?, ?, ?, 'pending', ?, ?, NULL)`)
          .run(data.pairId, record.pairId, data.offer, acceptance, transcript(data.offer, acceptance),
            identity().instanceGeneration, ownOffer.exp);
        audit('acceptance-bound', data.pairId, at);
        return pair(data.pairId);
      });
      return response(row, 'accept', acceptance, 'pending');
    },
    approve(pairId, fingerprint, peerFingerprint, owner) {
      return mutate(at => {
        ownerValid(owner);
        const row = pair(pairId); usable(row);
        if (row.fingerprint !== fingerprint || row.remote.keyId !== peerFingerprint) fail(403, 'PEER_FINGERPRINT');
        ownerValid(owner);
        db.prepare("UPDATE peer_pairings SET state = CASE WHEN state = 'active' OR side = 'B' THEN state ELSE 'ready' END, approval = ? WHERE pair_id = ?")
          .run(JSON.stringify(owner), pairId);
        localAudit('transcript-approved', pairId, owner, at);
        return describe(pair(pairId));
      });
    },
    async request(pairId, operation) {
      if (!['confirm', 'activate', 'status', 'revoke'].includes(operation)) fail(400, 'PEER_OPERATION');
      const row = mutate(() => {
        const current = pair(pairId); usable(current, operation === 'revoke' || operation === 'status');
        if (['confirm', 'activate'].includes(operation)) {
          if (current.side !== 'A' || !['ready', 'active'].includes(current.state)) fail();
          ownerValid(JSON.parse(current.approval));
        }
        return current;
      });
      return { origin: row.remote.origin, message: await signed(envelope(row, operation, pairId, { transcriptFingerprint: row.fingerprint })) };
    },
    async receive(operation, token) {
      mutate(() => {});
      if (!['confirm', 'activate', 'status', 'revoke'].includes(operation)) fail(400, 'PEER_OPERATION');
      const untrusted = decode(token).payload;
      if (!untrusted || typeof untrusted !== 'object' || Array.isArray(untrusted)) fail(400, 'PEER_JWS');
      const initial = pair(untrusted.pairId);
      const sender = initial.remote.serverId;
      if ((receiving.get(sender) || 0) >= 4) fail(503, 'PEER_CAPACITY');
      receiving.set(sender, (receiving.get(sender) || 0) + 1);
      try {
        const message = await peerMessage(token, initial, operation);
        const result = mutate(at => {
          const row = pair(initial.pair_id);
          checkEnvelope(message, row, operation);
          if (message.transactionId !== row.pair_id || !fields(message.body, ['transcriptFingerprint']) || message.body.transcriptFingerprint !== row.fingerprint) fail();
          usable(row, operation === 'status' || operation === 'revoke');
          ledger(message);
          if (operation === 'status') return { row, value: state(row) };
          if (operation === 'revoke') {
            store.transition(row.peer_record_id, 'revoked');
            return { row: pair(row.pair_id), value: 'revoked' };
          }
          if (row.side !== 'B') fail();
          if (row.state !== 'active') ownerValid(JSON.parse(row.approval));
          const digest = hash(JSON.stringify(message.body));
          const receipt = db.prepare('SELECT * FROM peer_transactions WHERE pair_id = ? AND operation = ? AND transaction_id = ?')
            .get(row.pair_id, operation, message.transactionId);
          if (receipt) {
            if (receipt.request_hash !== digest) fail(409, 'PEER_CONFLICT');
            return { row, value: receipt.result };
          }
          if (operation === 'activate' && !['ready', 'active'].includes(row.state)) fail();
          const value = operation === 'confirm' ? 'ready' : 'active';
          db.prepare("UPDATE peer_pairings SET state = CASE WHEN state = 'active' THEN state ELSE ? END WHERE pair_id = ?").run(value, row.pair_id);
          db.prepare('INSERT INTO peer_transactions VALUES (?, ?, ?, ?, ?)').run(row.pair_id, operation, message.transactionId, digest, value);
          audit(`peer-${value}`, row.pair_id, at);
          return { row: pair(row.pair_id), value };
        });
        return await response(result.row, operation, token, result.value);
      } finally {
        const remaining = receiving.get(sender) - 1;
        if (remaining) receiving.set(sender, remaining); else receiving.delete(sender);
      }
    },
    async receiveResponse(pairId, operation, requestToken, body) {
      mutate(() => {});
      if (!fields(body, ['message'])) fail(502, 'PEER_RESPONSE');
      const row = pair(pairId), message = await peerMessage(body.message, row, `${operation}-response`);
      return mutate(at => {
        const current = pair(pairId);
        checkEnvelope(message, current, `${operation}-response`);
        usable(current, operation === 'status' || operation === 'revoke');
        if (message.transactionId !== pairId || !fields(message.body, ['requestHash', 'transcriptFingerprint', 'state']) ||
            message.body.requestHash !== hash(requestToken) || message.body.transcriptFingerprint !== current.fingerprint ||
            !['pending', 'ready', 'active', 'suspended', 'revoked', 'expired'].includes(message.body.state)) fail();
        ledger(message);
        if (operation === 'confirm') {
          if (current.side !== 'A' || message.body.state !== 'ready' || !['ready', 'active'].includes(current.state)) fail();
          ownerValid(JSON.parse(current.approval));
          if (current.state !== 'active') {
            db.prepare("UPDATE peer_pairings SET state = 'active' WHERE pair_id = ?").run(pairId);
            audit('peer-active', pairId, at);
          }
        }
        if (operation === 'activate' && (current.side !== 'A' || current.state !== 'active' || message.body.state !== 'active')) fail();
        return message.body.state;
      });
    },
    revoke(pairId, owner) {
      return mutate(at => {
        ownerValid(owner);
        if (!uuid(pairId)) fail(400, 'PEER_PAIR');
        if (!db.prepare('SELECT 1 FROM peer_pairings WHERE pair_id = ?').get(pairId)) {
          const invitation = db.prepare('SELECT * FROM peer_invitations WHERE pair_id = ?').get(pairId);
          if (!invitation) fail(404, 'PEER_PAIR');
          if (!invitation.cancelled) {
            db.prepare('UPDATE peer_invitations SET cancelled = 1 WHERE pair_id = ?').run(pairId);
            localAudit('offer-revoked', pairId, owner, at);
          }
          return api.get(pairId);
        }
        const row = pair(pairId);
        store.transition(row.peer_record_id, 'revoked');
        localAudit('pair-revoked', pairId, owner, at);
        return describe(pair(pairId));
      });
    },
    async liveStatus(pairId, send) {
      const current = mutate(() => api.get(pairId).state);
      if (current !== 'active') return { pairId, localState: current, effectiveActive: false };
      const request = await api.request(pairId, 'status');
      const response = await send(request.origin, 'status', { message: request.message });
      const remoteState = await api.receiveResponse(pairId, 'status', request.message, response);
      const localState = mutate(() => state(pair(pairId)));
      return { pairId, localState, remoteState, effectiveActive: localState === 'active' && remoteState === 'active' };
    },
    async flushNotifications(send) {
      mutate(() => {});
      const pending = db.prepare('SELECT * FROM peer_notify WHERE next_attempt <= ? ORDER BY next_attempt LIMIT 4').all(now());
      for (const notification of pending) {
        try {
          const row = pair(notification.pair_id);
          if (row.local_generation !== identity().instanceGeneration) {
            mutate(at => {
              db.prepare('DELETE FROM peer_notify WHERE pair_id = ?').run(row.pair_id);
              audit('notification-obsolete-generation', row.pair_id, at);
            });
            continue;
          }
          const request = await api.request(row.pair_id, 'revoke');
          const result = await send(request.origin, 'revoke', { message: request.message });
          if (await api.receiveResponse(row.pair_id, 'revoke', request.message, result) !== 'revoked') fail();
          mutate(at => {
            db.prepare('DELETE FROM peer_notify WHERE pair_id = ?').run(row.pair_id);
            audit('revocation-notified', row.pair_id, at);
          });
        } catch {
          // Delivery is best effort; local tombstones and live status remain
          // authoritative. Never log a signed body or a transport exception.
          try { mutate(at => db.prepare('UPDATE peer_notify SET attempts = attempts + 1, next_attempt = ? WHERE pair_id = ?')
            .run(at + Math.min(1800000, 30000 * 2 ** Math.min(notification.attempts, 6)), notification.pair_id)); }
          catch { /* Clock/recovery gate still blocks all effective trust. */ }
        }
      }
    }
  };
  return api;
}

module.exports = { createPeerProtocol, OFFER_TYPE, ACCEPT_TYPE, MESSAGE_TYPE };
