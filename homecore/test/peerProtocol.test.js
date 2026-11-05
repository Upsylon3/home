const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { openPeerState, FILE_NAME } = require('../src/homecore/peerState');
const wire = require('../src/homecore/peerWire');
const { MESSAGE_TYPE } = require('../src/homecore/peerProtocol');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-peer-protocol-'));
const fixtures = [];
after(() => {
  for (const f of fixtures) { f.store.close(); f.core.close(); }
  fs.rmSync(root, { recursive: true, force: true });
});
function fixture(name) {
  const stateDir = fs.mkdtempSync(path.join(root, 'state-'));
  const core = new Database(':memory:');
  core.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, disabled INTEGER, token_version INTEGER); INSERT INTO users VALUES (1, 'admin', 0, 0)");
  const f = { core, stateDir, time: 2000000000000, namespaceId: crypto.randomUUID(), origin: `https://${name}.example.com` };
  f.settings = { stateDir, namespaceId: f.namespaceId, origin: f.origin, now: () => f.time };
  f.store = openPeerState({ ...f.settings, initialize: true });
  f.protocol = f.store.protocol({ coreDb: core });
  f.owner = () => ({ userId: 1, tokenVersion: 0, approvedAt: f.time });
  f.reopen = options => { f.store.close(); f.store = openPeerState(f.settings); f.protocol = f.store.protocol({ coreDb: core, ...options }); };
  fixtures.push(f); return f;
}
async function accepted(a, b) {
  const offer = await a.protocol.offer(a.owner());
  const prepared = await b.protocol.prepareAcceptance(offer.invitation, a.store.identity().keyId, b.owner());
  const result = await a.protocol.accept(prepared);
  await b.protocol.receiveResponse(prepared.pairId, 'accept', prepared.acceptance, result);
  return { pairId: offer.pairId, offer, prepared, fingerprint: b.protocol.get(offer.pairId).transcriptFingerprint };
}
async function exchange(a, b, pairId, operation) {
  const request = await a.protocol.request(pairId, operation);
  const result = await b.protocol.receive(operation, request.message);
  await a.protocol.receiveResponse(pairId, operation, request.message, result);
  return { request, result };
}
async function active(a, b) {
  const context = await accepted(a, b), { pairId, fingerprint } = context;
  b.protocol.approve(pairId, fingerprint, a.store.identity().keyId, b.owner());
  a.protocol.approve(pairId, fingerprint, b.store.identity().keyId, a.owner());
  await exchange(a, b, pairId, 'confirm');
  await exchange(a, b, pairId, 'activate');
  return context;
}
const sender = destination => async (origin, operation, body) => {
  assert.equal(origin, destination.origin);
  return operation === 'accept' ? destination.protocol.accept(body) : destination.protocol.receive(operation, body.message);
};
function key(f) {
  const db = new Database(path.join(f.stateDir, FILE_NAME));
  try { return crypto.createPrivateKey(db.prepare('SELECT private_key FROM authority').get().private_key); }
  finally { db.close(); }
}
async function changed(f, token, change, type = MESSAGE_TYPE) {
  const payload = wire.decode(token).payload; change(payload);
  return wire.sign(payload, type, f.store.identity(), key(f));
}

test('two owners approve the same signed transcript; local active state alone never establishes effective trust', async () => {
  const a = fixture('a'), b = fixture('b'), { pairId, fingerprint } = await accepted(a, b);
  assert.equal(a.protocol.get(pairId).state, 'pending');
  assert.equal(b.protocol.get(pairId).state, 'pending');
  a.protocol.approve(pairId, fingerprint, b.store.identity().keyId, a.owner());
  await assert.rejects(exchange(a, b, pairId, 'confirm'), error => error.code === 'PEER_REAUTH');
  b.protocol.approve(pairId, fingerprint, a.store.identity().keyId, b.owner());
  await exchange(a, b, pairId, 'confirm');
  assert.equal(a.protocol.get(pairId).state, 'active');
  assert.equal(b.protocol.get(pairId).state, 'ready');
  assert.equal((await a.protocol.liveStatus(pairId, sender(b))).effectiveActive, false);
  await exchange(a, b, pairId, 'activate');
  assert.equal((await a.protocol.liveStatus(pairId, sender(b))).effectiveActive, true);
  assert.equal((await b.protocol.liveStatus(pairId, sender(a))).effectiveActive, true);
  assert.equal(a.protocol.get(pairId).effectiveActive, false);
});

test('invitations bind once under competing acceptances; secrets never enter either authority database', async () => {
  const a = fixture('offer'), b = fixture('b'), c = fixture('c');
  const offer = await a.protocol.offer(a.owner());
  const prepared = await Promise.all([b, c].map(f => f.protocol.prepareAcceptance(offer.invitation, a.store.identity().keyId, f.owner())));
  const results = await Promise.allSettled(prepared.map(value => a.protocol.accept(value)));
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(results.filter(value => value.status === 'rejected').length, 1);
  assert.equal(a.protocol.list().length, 1);
  for (const f of [a, b, c]) assert.equal(fs.readFileSync(path.join(f.stateDir, FILE_NAME)).includes(Buffer.from(offer.invitation.secret)), false);
  const winner = results.findIndex(value => value.status === 'fulfilled');
  await assert.doesNotReject(a.protocol.accept(prepared[winner]));
  await assert.rejects(a.protocol.accept({ ...prepared[winner], secret: wire.random() }));
});

test('unbound offers can be revoked; neither retries nor expiry create active pairings', async () => {
  const a = fixture('offer'), b = fixture('accept');
  const offer = await a.protocol.offer(a.owner());
  const prepared = await b.protocol.prepareAcceptance(offer.invitation, a.store.identity().keyId, b.owner());
  assert.equal(a.protocol.revoke(offer.pairId, a.owner()).state, 'revoked');
  assert.equal(a.protocol.revoke(offer.pairId, a.owner()).state, 'revoked');
  await assert.rejects(a.protocol.accept(prepared));
  const later = await a.protocol.offer(a.owner());
  a.time += 631000; b.time = a.time;
  assert.equal(a.protocol.get(later.pairId).state, 'expired');
  await assert.rejects(b.protocol.prepareAcceptance(later.invitation, a.store.identity().keyId, b.owner()));
});

test('lost acknowledgements retry with new message IDs and durable semantic receipts after restart', async () => {
  const a = fixture('a'), b = fixture('b'), { pairId, fingerprint } = await accepted(a, b);
  a.protocol.approve(pairId, fingerprint, b.store.identity().keyId, a.owner());
  b.protocol.approve(pairId, fingerprint, a.store.identity().keyId, b.owner());
  const request = await a.protocol.request(pairId, 'confirm');
  await b.protocol.receive('confirm', request.message); // reply lost
  b.reopen();
  await assert.rejects(b.protocol.receive('confirm', request.message), error => error.code === 'PEER_REPLAY');
  await exchange(a, b, pairId, 'confirm');
  const activation = await a.protocol.request(pairId, 'activate');
  await b.protocol.receive('activate', activation.message); // final reply lost
  a.reopen(); b.reopen();
  await exchange(a, b, pairId, 'activate');
  assert.equal((await a.protocol.liveStatus(pairId, sender(b))).effectiveActive, true);
});

test('replay ledger covers responses and rejects stale status replies for a new request', async () => {
  const a = fixture('a'), b = fixture('b'), { pairId } = await active(a, b);
  const request = await a.protocol.request(pairId, 'status');
  const response = await b.protocol.receive('status', request.message);
  await a.protocol.receiveResponse(pairId, 'status', request.message, response);
  a.reopen();
  await assert.rejects(a.protocol.receiveResponse(pairId, 'status', request.message, response), error => error.code === 'PEER_REPLAY');
  const newer = await a.protocol.request(pairId, 'status');
  await assert.rejects(a.protocol.receiveResponse(pairId, 'status', newer.message, response));
});

test('revocation wins over retry receipts, survives Core-side restarts and uses a durable notification outbox', async () => {
  const a = fixture('a'), b = fixture('b'), { pairId } = await active(a, b);
  a.protocol.revoke(pairId, a.owner());
  await a.protocol.flushNotifications(async () => { throw new Error('offline'); });
  assert.equal((await a.protocol.liveStatus(pairId, sender(b))).effectiveActive, false);
  assert.equal((await b.protocol.liveStatus(pairId, sender(a))).effectiveActive, false);
  b.reopen();
  await assert.rejects(exchange(a, b, pairId, 'confirm'));
  a.time += 31000; b.time = a.time;
  await a.protocol.flushNotifications(sender(b));
  assert.equal(b.protocol.get(pairId).state, 'revoked');
  const db = new Database(path.join(a.stateDir, FILE_NAME));
  try { assert.equal(db.prepare('SELECT count(*) AS n FROM peer_notify').get().n, 0); }
  finally { db.close(); }
});

test('changed transcripts and disabled/stale local owners never approve another peer', async () => {
  const a = fixture('a'), b = fixture('b'), { pairId, fingerprint } = await accepted(a, b);
  assert.throws(() => a.protocol.approve(pairId, wire.random(), b.store.identity().keyId, a.owner()));
  assert.throws(() => a.protocol.approve(pairId, fingerprint, wire.random(), a.owner()));
  b.core.exec('UPDATE users SET disabled = 1 WHERE id = 1');
  assert.throws(() => b.protocol.approve(pairId, fingerprint, a.store.identity().keyId, b.owner()));
  b.core.exec('UPDATE users SET disabled = 0, token_version = 1 WHERE id = 1');
  assert.throws(() => b.protocol.approve(pairId, fingerprint, a.store.identity().keyId, b.owner()));
  assert.throws(() => a.protocol.approve(pairId, fingerprint, b.store.identity().keyId, { ...a.owner(), approvedAt: a.time - 301000 }));
});

test('operation, audience, issuer, origin, generation, type and lifetime are verified independently of signatures', async () => {
  const a = fixture('a'), b = fixture('b'), { pairId } = await active(a, b);
  const request = await a.protocol.request(pairId, 'status');
  for (const mutate of [p => { p.aud = crypto.randomUUID(); }, p => { p.iss = crypto.randomUUID(); },
    p => { p.targetOrigin = 'https://other.example.com'; }, p => { p.senderGeneration = crypto.randomUUID(); },
    p => { p.recipientGeneration = crypto.randomUUID(); }, p => { p.operation = 'activate'; },
    p => { p.exp = p.iat + 61; }, p => { p.iat += 1000; p.exp += 1000; },
    p => { p.iat -= 1000; p.exp -= 1000; }, p => { p.extra = true; }, p => { p.body.extra = 'untrusted'; }]) {
    await assert.rejects(b.protocol.receive('status', await changed(a, request.message, mutate)));
  }
  await assert.rejects(b.protocol.receive('status', await changed(a, request.message, () => {}, 'JWT')));
  const wrongKey = crypto.generateKeyPairSync('ed25519').privateKey;
  await assert.rejects(b.protocol.receive('status', await wire.sign(wire.decode(request.message).payload, MESSAGE_TYPE, a.store.identity(), wrongKey)));
});

test('ledger capacity fails closed without evicting valid nonces; expiry allows new status checks', async () => {
  const a = fixture('a'), b = fixture('b'), { pairId } = await active(a, b);
  b.reopen({ replayLimit: 1 });
  await assert.rejects(a.protocol.liveStatus(pairId, sender(b)), error => error.code === 'PEER_CAPACITY');
  a.time += 91000; b.time = a.time;
  assert.equal((await a.protocol.liveStatus(pairId, sender(b))).effectiveActive, true);
});

test('live status never uses a positive cache and local revocation during a remote request wins', async () => {
  const a = fixture('a'), b = fixture('b'), { pairId } = await active(a, b);
  assert.equal((await a.protocol.liveStatus(pairId, sender(b))).effectiveActive, true);
  await assert.rejects(a.protocol.liveStatus(pairId, async () => { throw new Error('offline'); }), /offline/);
  const result = await a.protocol.liveStatus(pairId, async (...args) => {
    const response = await sender(b)(...args);
    a.protocol.revoke(pairId, a.owner());
    return response;
  });
  assert.equal(result.effectiveActive, false);
  assert.equal(result.localState, 'revoked');
});

test('authenticated generation changes suspend old pairings and per-peer verification capacity is bounded', async () => {
  const a = fixture('a'), b = fixture('b'), { pairId } = await active(a, b);
  const requests = await Promise.all(Array.from({ length: 8 }, () => a.protocol.request(pairId, 'status')));
  const results = await Promise.allSettled(requests.map(request => b.protocol.receive('status', request.message)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 4);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'PEER_CAPACITY').length, 4);
  const changedGeneration = await changed(a, requests[0].message, payload => { payload.senderGeneration = crypto.randomUUID(); payload.jti = wire.random(); });
  await assert.rejects(b.protocol.receive('status', changedGeneration), error => error.code === 'PEER_GENERATION');
  assert.equal(b.protocol.get(pairId).state, 'suspended');
});

test('recovery/clock rollback cannot resurrect active protocol state or old invitations', async () => {
  const a = fixture('a'), b = fixture('b'), { pairId } = await active(a, b);
  const invitation = await a.protocol.offer(a.owner());
  a.time -= 1000;
  await assert.rejects(a.protocol.liveStatus(pairId, sender(b)), /Clock rollback/);
  a.reopen(); a.time += 2000;
  await assert.rejects(a.protocol.liveStatus(pairId, sender(b)), /Clock rollback/);
  a.store.recover();
  assert.equal(a.protocol.get(pairId).state, 'revoked');
  assert.equal((await a.protocol.liveStatus(pairId, sender(b))).effectiveActive, false);
  b.time = a.time;
  const prepared = await b.protocol.prepareAcceptance(invitation.invitation, a.store.identity().keyId, b.owner());
  await assert.rejects(a.protocol.accept(prepared));
});

test('strict wire JSON rejects duplicate/escaped keys, invalid UTF-8 and excessive nesting', () => {
  for (const raw of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"nested":{"x":1,"x":2}}', '['.repeat(18) + '0' + ']'.repeat(18)]) {
    assert.throws(() => wire.strictJSON(raw));
  }
  assert.throws(() => wire.strictJSON(Buffer.from([0xff])));
  assert.deepEqual(wire.strictJSON('{"text":"escaped \\" punctuation: {},","list":[1,true,null]}'),
    { text: 'escaped " punctuation: {},', list: [1, true, null] });
});

test('observed expiry cannot reverse after clock correction, including read-only inspection', async () => {
  const a = fixture('clock'), offer = await a.protocol.offer(a.owner());
  a.time += 700000;
  assert.equal(a.protocol.get(offer.pairId).state, 'expired');
  a.time -= 700000;
  assert.throws(() => a.protocol.get(offer.pairId), /Clock rollback/);
  a.time += 701000; a.store.recover();
  assert.equal(a.protocol.get(offer.pairId).state, 'revoked');
});

test('protected headers cannot select another algorithm, remote key URL, critical extension or duplicate key', async () => {
  const a = fixture('a'), b = fixture('b'), { pairId } = await active(a, b);
  const request = await a.protocol.request(pairId, 'status'), parts = request.message.split('.');
  const original = wire.decode(request.message).header;
  for (const header of [{ ...original, alg: 'HS256' }, { ...original, alg: 'none' },
    { ...original, jku: 'https://127.0.0.1/keys' }, { ...original, crit: ['unknown'] }]) {
    await assert.rejects(b.protocol.receive('status', [Buffer.from(JSON.stringify(header)).toString('base64url'), parts[1], parts[2]].join('.')));
  }
  const duplicate = JSON.stringify(original).replace('{', '{"alg":"EdDSA",');
  await assert.rejects(b.protocol.receive('status', [Buffer.from(duplicate).toString('base64url'), parts[1], parts[2]].join('.')),
    error => error.code === 'PEER_JSON');
});

test('public v1 wire vector verifies exact signed bytes, transcript and request-response binding', async () => {
  const vector = require('./fixtures/peer-v1.json');
  const offer = await wire.verify(vector.offer, 'home-pair-offer+jwt', vector.initiator);
  const acceptance = await wire.verify(vector.acceptance, 'home-pair-accept+jwt', vector.acceptor);
  assert.equal(acceptance.offer, vector.offer);
  assert.equal(acceptance.pairId, offer.pairId);
  assert.equal(wire.transcript(vector.offer, vector.acceptance), vector.transcriptFingerprint);
  const request = await wire.verify(vector.statusRequest, MESSAGE_TYPE, vector.initiator);
  const response = await wire.verify(vector.statusResponse, MESSAGE_TYPE, vector.acceptor);
  wire.timeClaims(offer, vector.now, 600); wire.timeClaims(acceptance, vector.now, 600);
  wire.timeClaims(request, vector.now, 60); wire.timeClaims(response, vector.now, 60);
  assert.equal(response.body.requestHash, wire.hash(vector.statusRequest));
  assert.equal(response.body.transcriptFingerprint, vector.transcriptFingerprint);
  assert.equal(response.transactionId, request.transactionId);
  assert.equal(response.aud, request.iss);
  assert.equal(response.iss, request.aud);
  assert.ok(!JSON.stringify(vector).includes('PRIVATE KEY'));
  assert.equal(Object.hasOwn(vector.initiator.publicKey, 'd'), false);
  assert.equal(Object.hasOwn(vector.acceptor.publicKey, 'd'), false);
});
