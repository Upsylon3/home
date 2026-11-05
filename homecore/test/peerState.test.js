const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const { ensureAccountSubjects } = require('../src/homecore/accountSubjects');
const { openPeerState, validateDescriptor, keyThumbprint, FILE_NAME } = require('../src/homecore/peerState');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-peer-foundation-'));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
after(() => fs.rmSync(root, { recursive: true, force: true }));
function directory() { return fs.mkdtempSync(path.join(root, 'authority-')); }
function identity(origin = 'https://remote.example.com') {
  const publicKey = crypto.generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' });
  return { version: 1, serverId: crypto.randomUUID(), origin, instanceGeneration: crypto.randomUUID(),
    publicKey, keyId: keyThumbprint(publicKey) };
}
function fixture(options = {}) {
  const stateDir = directory(), namespaceId = crypto.randomUUID();
  const settings = { stateDir, namespaceId, origin: 'https://local.example.com', ...options };
  return { settings, stateDir, store: openPeerState({ ...settings, initialize: true }) };
}
function userDatabase(file = ':memory:') {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL)');
  return db;
}

test('existing accounts gain durable subjects without changing local identity; deletion retains tombstones', () => {
  const db = userDatabase();
  try {
    db.prepare('INSERT INTO users (username) VALUES (?)').run('existing');
    ensureAccountSubjects(db);
    const original = db.prepare('SELECT * FROM hc_account_subjects WHERE user_id = 1').get();
    const namespace = db.prepare('SELECT namespace_id FROM hc_peer_namespace').get();
    assert.match(original.subject, uuid);
    db.exec("UPDATE users SET username = 'renamed' WHERE id = 1");
    ensureAccountSubjects(db);
    assert.deepEqual(db.prepare('SELECT * FROM hc_account_subjects WHERE user_id = 1').get(), original);
    assert.deepEqual(db.prepare('SELECT namespace_id FROM hc_peer_namespace').get(), namespace);
    assert.throws(() => db.prepare('UPDATE hc_account_subjects SET subject = ?').run(crypto.randomUUID()), /immutable/);
    assert.throws(() => db.exec('DELETE FROM hc_peer_namespace'), /retained/);
    db.exec('DELETE FROM users WHERE id = 1');
    assert.equal(db.prepare('SELECT user_id FROM hc_account_subjects WHERE subject = ?').get(original.subject).user_id, null);
    db.exec("INSERT INTO users (username) VALUES ('renamed')");
    const replacement = db.prepare('SELECT subject FROM hc_account_subjects WHERE user_id = 2').get().subject;
    assert.match(replacement, uuid);
    assert.notEqual(replacement, original.subject);
    assert.throws(() => db.exec('DELETE FROM hc_account_subjects'), /retained/);
    assert.throws(() => db.prepare('UPDATE hc_account_subjects SET user_id = 2 WHERE subject = ?').run(original.subject), /immutable/);
  } finally { db.close(); }
});

test('new account inserts receive distinct UUIDs, including writes outside the registration route', () => {
  const db = userDatabase();
  try {
    ensureAccountSubjects(db);
    for (let i = 0; i < 50; i++) db.prepare('INSERT INTO users (username) VALUES (?)').run(`user${i}`);
    const subjects = db.prepare('SELECT subject FROM hc_account_subjects').all().map(row => row.subject);
    assert.equal(new Set(subjects).size, 50);
    assert.ok(subjects.every(subject => uuid.test(subject)));
  } finally { db.close(); }
});

test('public fingerprint matches RFC 8037 Ed25519 example, independent of property order', () => {
  const key = { kty: 'OKP', crv: 'Ed25519', x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' };
  // RFC 8037 Appendix A.3 SHA-256 thumbprint of the fixed public key.
  assert.equal(keyThumbprint(key), 'kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k');
  assert.equal(keyThumbprint({ x: key.x, crv: key.crv, kty: key.kty }), keyThumbprint(key));
});

test('initialization is explicit, restart preserves keys, and wrong Core/origin cannot replace identity', () => {
  const stateDir = directory(), namespaceId = crypto.randomUUID();
  assert.throws(() => openPeerState({ stateDir, namespaceId }), /missing/);
  const settings = { stateDir, namespaceId, origin: 'https://local.example.com' };
  let store = openPeerState({ ...settings, initialize: true });
  const original = store.identity();
  store.close();
  store = openPeerState(settings);
  assert.deepEqual(store.identity(), original);
  store.close();
  assert.throws(() => openPeerState({ ...settings, namespaceId: crypto.randomUUID() }), /namespace/);
  assert.throws(() => openPeerState({ ...settings, initialize: true, origin: 'https://changed.example.com' }), /origin/);
  store = openPeerState({ ...settings, initialize: true });
  assert.deepEqual(store.identity(), original);
  assert.ok(!JSON.stringify(store.identity()).includes('PRIVATE KEY'));
  assert.equal(Object.hasOwn(store.identity().publicKey, 'd'), false);
  store.close();
});

test('partial or corrupt authority never generates replacement keys', () => {
  const stateDir = directory(), file = path.join(stateDir, FILE_NAME);
  fs.writeFileSync(file, '', { mode: 0o600 });
  assert.throws(() => openPeerState({ stateDir, namespaceId: crypto.randomUUID(), initialize: true, origin: 'https://local.example.com' }));
  assert.equal(fs.statSync(file).size, 0);
  const f = fixture(); f.store.close();
  const db = new Database(path.join(f.stateDir, FILE_NAME));
  db.prepare('UPDATE authority SET private_key = ?').run(crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }));
  db.close();
  assert.throws(() => openPeerState(f.settings), /key/);
});

test('staging requires explicit full fingerprint, is idempotent and grants no active state', () => {
  const f = fixture(), remote = identity();
  try {
    assert.throws(() => f.store.stage(remote, remote.keyId.slice(0, 8)), /fingerprint/);
    assert.deepEqual(f.store.list(), []);
    const pair = f.store.stage(remote, remote.keyId);
    assert.equal(pair.status, 'pending');
    assert.deepEqual(pair.descriptor, remote);
    assert.deepEqual(f.store.stage(remote, remote.keyId), pair);
    assert.throws(() => f.store.transition(pair.pairId, 'active'), /Only suspend/);
    assert.equal(f.store.list().length, 1);
    assert.throws(() => f.store.stage(f.store.identity(), f.store.identity().keyId), /itself/);
  } finally { f.store.close(); }
});

test('suspension and revocation survive restart; revoked pair IDs cannot revive', () => {
  const f = fixture(), remote = identity();
  let store = f.store;
  try {
    const pair = store.stage(remote, remote.keyId);
    assert.equal(store.transition(pair.pairId, 'suspended').status, 'suspended');
    assert.equal(store.stage(remote, remote.keyId).status, 'suspended');
    store.transition(pair.pairId, 'revoked');
    store.close(); store = openPeerState(f.settings);
    assert.equal(store.transition(pair.pairId, 'revoked').status, 'revoked');
    assert.throws(() => store.transition(pair.pairId, 'suspended'), /cannot be changed/);
    const fresh = store.stage(remote, remote.keyId);
    assert.notEqual(fresh.pairId, pair.pairId);
    assert.equal(fresh.status, 'pending');
    assert.equal(store.list().length, 2);
  } finally { store.close(); }
  const db = new Database(path.join(f.stateDir, FILE_NAME));
  try {
    assert.throws(() => db.exec("UPDATE peers SET status = 'active' WHERE status = 'pending'"), /CHECK/);
    assert.throws(() => db.exec('DELETE FROM peers'), /retained/);
    assert.throws(() => db.exec("UPDATE peers SET status = 'pending' WHERE status = 'revoked'"), /permanent/);
    assert.equal(db.prepare("SELECT count(*) AS n FROM audit WHERE operation = 'revoked'").get().n, 1);
    assert.throws(() => db.exec('DELETE FROM audit'), /retained/);
  } finally { db.close(); }
});

test('changed keys/origins and competing identities do not silently replace pins', () => {
  const f = fixture(), remote = identity();
  try {
    const pair = f.store.stage(remote, remote.keyId);
    const differentKey = { ...identity(), serverId: remote.serverId };
    assert.throws(() => f.store.stage(differentKey, differentKey.keyId), /pins changed/);
    assert.throws(() => f.store.stage({ ...remote, origin: 'https://other.example.com' }, remote.keyId), /pins changed/);
    const impostor = identity(remote.origin);
    assert.throws(() => f.store.stage(impostor, impostor.keyId), /different pending identity/);
    f.store.transition(pair.pairId, 'revoked');
    assert.throws(() => f.store.stage(differentKey, differentKey.keyId), /pins changed/);
  } finally { f.store.close(); }
});

test('recovery retains server/key identity, changes generation, revokes every pending/suspended pair atomically', () => {
  const f = fixture(), a = identity(), b = identity('https://second.example.com');
  try {
    const local = f.store.identity();
    const pair = f.store.stage(a, a.keyId), other = f.store.stage(b, b.keyId);
    f.store.transition(other.pairId, 'suspended');
    const recovered = f.store.recover();
    assert.notEqual(recovered.instanceGeneration, local.instanceGeneration);
    assert.equal(recovered.serverId, local.serverId);
    assert.equal(recovered.keyId, local.keyId);
    assert.ok(f.store.list().every(row => row.status === 'revoked'));
    const fresh = f.store.stage(a, a.keyId);
    assert.notEqual(fresh.pairId, pair.pairId);
    assert.equal(fresh.localGeneration, recovered.instanceGeneration);
    const remoteRecovered = { ...a, instanceGeneration: crypto.randomUUID() };
    assert.throws(() => f.store.stage(remoteRecovered, a.keyId), /Revoke the old pair/);
    f.store.transition(fresh.pairId, 'revoked');
    assert.equal(f.store.stage(remoteRecovered, a.keyId).status, 'pending');
  } finally { f.store.close(); }
});

test('clock rollback persists a recovery gate across restart and cannot mint new pending pairs', () => {
  let time = 10000;
  const f = fixture({ now: () => time }), remote = identity();
  f.store.stage(remote, remote.keyId);
  time = 9000;
  assert.throws(() => f.store.stage(identity('https://second.example.com'), remote.keyId), /fingerprint/);
  assert.throws(() => f.store.stage(remote, remote.keyId), /Clock rollback/);
  f.store.close();
  time = 11000;
  const store = openPeerState(f.settings);
  try {
    assert.throws(() => store.stage(remote, remote.keyId), /Clock rollback/);
    store.recover();
    assert.equal(store.stage(remote, remote.keyId).status, 'pending');
    assert.equal(store.list().filter(row => row.status === 'revoked').length, 1);
  } finally { store.close(); }
});

test('private/public key confusion, malformed descriptors and noncanonical origins are rejected', () => {
  const value = identity();
  const bad = [null, { ...value, extra: true }, { ...value, serverId: [value.serverId] },
    { ...value, publicKey: { ...value.publicKey, d: 'private' } },
    { ...value, publicKey: { ...value.publicKey, crv: 'X25519' } }, { ...value, keyId: 'wrong' }];
  for (const origin of ['http://host.example.com', 'https://127.0.0.1', 'https://[::1]', 'https://localhost',
    'https://home.local', 'https://host.example.com/', 'https://host.example.com/path',
    'https://user:pass@host.example.com', 'https://HOST.example.com', 'https://host.example.com#x',
    'https://host.example.com?x']) bad.push({ ...value, origin });
  for (const candidate of bad) assert.throws(() => validateDescriptor(candidate));
});

test('authority path refuses broad Unix permissions and symbolic links', { skip: process.platform === 'win32' }, () => {
  const stateDir = directory(), namespaceId = crypto.randomUUID();
  fs.chmodSync(stateDir, 0o755);
  assert.throws(() => openPeerState({ stateDir, namespaceId, initialize: true, origin: 'https://local.example.com' }), /inaccessible/);
  fs.chmodSync(stateDir, 0o700);
  const f = fixture(); f.store.close();
  fs.chmodSync(path.join(f.stateDir, FILE_NAME), 0o644);
  assert.throws(() => openPeerState(f.settings), /inaccessible/);
  const link = path.join(root, 'linked-authority'); fs.symlinkSync(stateDir, link);
  assert.throws(() => openPeerState({ stateDir: link, namespaceId, initialize: true, origin: 'https://local.example.com' }), /linked/);
});

const cliPath = path.join(__dirname, '../scripts/peer-state.js');
function cli(command, database, stateDir, extra = []) {
  return spawnSync(process.execPath, [cliPath, command, '--database', database, '--state-dir', stateDir,
    '--confirm-offline', ...extra], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
}
function cliCore() {
  const dataDir = directory(), database = path.join(dataDir, 'homecore.db'), stateDir = directory();
  const db = userDatabase(database); ensureAccountSubjects(db); db.close();
  return { database, stateDir };
}

test('two isolated Core namespaces prepare/exchange only public descriptors through real CLI', () => {
  const a = cliCore(), b = cliCore();
  const initialized = cli('init', a.database, a.stateDir, ['--origin', 'https://a.example.com']);
  assert.equal(initialized.status, 0, initialized.stderr);
  const original = JSON.parse(initialized.stdout);
  assert.equal(cli('init', b.database, b.stateDir, ['--origin', 'https://b.example.com']).status, 0);
  const exported = cli('identity', b.database, b.stateDir);
  const peer = path.join(root, 'peer.json'); fs.writeFileSync(peer, exported.stdout);
  const remote = JSON.parse(exported.stdout);
  const staged = cli('stage', a.database, a.stateDir, ['--peer', peer, '--fingerprint', remote.keyId]);
  assert.equal(staged.status, 0, staged.stderr);
  const pair = JSON.parse(staged.stdout);
  assert.equal(pair.status, 'pending');
  assert.equal(cli('revoke', a.database, a.stateDir, ['--pair', pair.pairId]).status, 0);
  assert.equal(JSON.parse(cli('list', a.database, a.stateDir).stdout)[0].status, 'revoked');
  const recovered = JSON.parse(cli('recover', a.database, a.stateDir).stdout);
  assert.equal(recovered.serverId, original.serverId);
  assert.notEqual(recovered.instanceGeneration, original.instanceGeneration);
  assert.equal(cli('identity', b.database, a.stateDir).status, 1);
  for (const output of [initialized.stdout, exported.stdout, staged.stdout]) {
    assert.ok(!output.includes('PRIVATE KEY'));
    assert.ok(!output.includes('private_key'));
    assert.ok(!output.includes('namespace_id'));
  }
});

test('CLI refuses nested authority, implicit paths, duplicate JSON and unknown options without echoing input', () => {
  const a = cliCore(), peer = path.join(root, 'bad-peer.json');
  const nested = path.join(path.dirname(a.database), 'state'); fs.mkdirSync(nested, { mode: 0o700 });
  assert.equal(cli('init', a.database, nested, ['--origin', 'https://a.example.com']).status, 1);
  assert.equal(cli('init', a.database, a.stateDir, ['--origin', 'https://a.example.com', '--activate', 'true']).status, 1);
  assert.equal(cli('identity', 'relative.db', a.stateDir).status, 1);
  assert.equal(cli('init', a.database, a.stateDir, ['--origin', 'https://a.example.com']).status, 0);
  const remote = identity();
  fs.writeFileSync(peer, JSON.stringify(remote).replace('{', '{"secret":"DO-NOT-ECHO",'));
  let failed = cli('stage', a.database, a.stateDir, ['--peer', peer, '--fingerprint', remote.keyId]);
  assert.equal(failed.status, 1); assert.ok(!failed.stderr.includes('DO-NOT-ECHO'));
  fs.writeFileSync(peer, JSON.stringify(remote).replace('{', '{"version":1,'));
  failed = cli('stage', a.database, a.stateDir, ['--peer', peer, '--fingerprint', remote.keyId]);
  assert.equal(failed.status, 1);
  assert.deepEqual(JSON.parse(cli('list', a.database, a.stateDir).stdout), []);
});

test('competing CLI processes stage one pending pair and preserve its single audit event', async () => {
  const a = cliCore(), remote = identity(), peer = path.join(directory(), 'peer.json');
  assert.equal(cli('init', a.database, a.stateDir, ['--origin', 'https://a.example.com']).status, 0);
  fs.writeFileSync(peer, JSON.stringify(remote));
  function run() {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cliPath, 'stage', '--database', a.database, '--state-dir', a.stateDir,
        '--confirm-offline', '--peer', peer, '--fingerprint', remote.keyId], { env: { ...process.env, NODE_OPTIONS: '' } });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', status => resolve({ status, stdout, stderr }));
    });
  }
  const results = await Promise.all([run(), run()]);
  assert.ok(results.every(result => result.status === 0), JSON.stringify(results));
  assert.equal(JSON.parse(results[0].stdout).pairId, JSON.parse(results[1].stdout).pairId);
  const db = new Database(path.join(a.stateDir, FILE_NAME));
  try { assert.equal(db.prepare("SELECT count(*) AS n FROM audit WHERE operation = 'staged'").get().n, 1); }
  finally { db.close(); }
});

test('restoring an older Core database cannot restore external revoked pair state', () => {
  const a = cliCore(), backup = path.join(directory(), 'old-core.db'), remote = identity();
  fs.copyFileSync(a.database, backup);
  assert.equal(cli('init', a.database, a.stateDir, ['--origin', 'https://a.example.com']).status, 0);
  const peer = path.join(directory(), 'peer.json'); fs.writeFileSync(peer, JSON.stringify(remote));
  const pair = JSON.parse(cli('stage', a.database, a.stateDir, ['--peer', peer, '--fingerprint', remote.keyId]).stdout);
  assert.equal(cli('revoke', a.database, a.stateDir, ['--pair', pair.pairId]).status, 0);
  fs.copyFileSync(backup, a.database);
  assert.equal(JSON.parse(cli('list', a.database, a.stateDir).stdout)[0].status, 'revoked');
});

// Real HTTP boundary: public descriptors and staging records are not credentials,
// and the operator tool does not accidentally publish administration routes.
let context, admin;
before(async () => {
  const { startTestApp } = require('./helpers/app');
  const { registerUser } = require('./helpers/client');
  context = await startTestApp(); admin = await registerUser(context.baseUrl);
});
after(async () => { await require('./helpers/app').stopTestApp(); });
test('normal login still uses numeric local subjects; no federation endpoint is enabled', async () => {
  const jwt = require('jsonwebtoken');
  const client = require('./helpers/client').makeClient(context.baseUrl);
  const login = await client.post('/api/core/auth/login', { username: admin.username, password: admin.password });
  const decoded = jwt.decode(login.body.token);
  assert.equal(decoded.sub, admin.user.id);
  assert.equal(decoded.kind, undefined);
  const subject = context.db.prepare('SELECT subject FROM hc_account_subjects WHERE user_id = ?').get(admin.user.id).subject;
  assert.match(subject, uuid);
  client.setToken(JSON.stringify(identity()));
  assert.equal((await client.get('/api/core/users/me')).status, 401);
  for (const route of ['/api/core/peers', '/api/core/federation', '/api/core/guest']) {
    assert.equal((await admin.client.get(route)).status, 404);
  }
});
