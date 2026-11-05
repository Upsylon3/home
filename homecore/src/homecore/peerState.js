// Protected identity/pin authority. Network protocol support is loaded only by
// the explicit opt-in runtime; the offline tool never activates a pairing.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const os = require('node:os');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FILE_NAME = 'peer-authority.sqlite';
function refuse(message) { throw Object.assign(new Error(message), { safePeerError: true }); }
function exactFields(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
}
function originValue(value) {
  let url;
  try { url = new URL(value); } catch { refuse('An exact public HTTPS origin is required.'); }
  if (typeof value !== 'string' || url.protocol !== 'https:' || url.origin !== value ||
      url.username || url.password || net.isIP(url.hostname) || url.hostname.includes(':') ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname) ||
      /\.(?:localhost|local|internal)$/.test(url.hostname)) refuse('An exact public HTTPS origin is required.');
  return value;
}
function keyThumbprint(publicKey) {
  if (!exactFields(publicKey, ['crv', 'kty', 'x']) || publicKey.kty !== 'OKP' ||
      publicKey.crv !== 'Ed25519' || typeof publicKey.x !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(publicKey.x) ||
      Buffer.from(publicKey.x, 'base64url').toString('base64url') !== publicKey.x) {
    refuse('Only a public Ed25519 JWK is accepted.');
  }
  crypto.createPublicKey({ key: publicKey, format: 'jwk' });
  // RFC 7638 / RFC 8037: only the required OKP members, in lexical order.
  return crypto.createHash('sha256').update(JSON.stringify({
    crv: publicKey.crv, kty: publicKey.kty, x: publicKey.x
  })).digest('base64url');
}
function validateDescriptor(value) {
  if (!exactFields(value, ['version', 'serverId', 'origin', 'instanceGeneration', 'publicKey', 'keyId']) ||
      value.version !== 1 || typeof value.serverId !== 'string' || !UUID.test(value.serverId) ||
      typeof value.instanceGeneration !== 'string' || !UUID.test(value.instanceGeneration)) {
    refuse('Invalid public server descriptor.');
  }
  originValue(value.origin);
  if (value.keyId !== keyThumbprint(value.publicKey)) refuse('Public key fingerprint does not match.');
  return value;
}
function protectedPath(target, directory = false) {
  const info = fs.lstatSync(target);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()) ||
      (!directory && info.nlink !== 1)) refuse('Authority paths must be regular, private and not linked.');
  const resolved = path.resolve(target), real = fs.realpathSync(target);
  if ((process.platform === 'win32' ? real.toLowerCase() !== resolved.toLowerCase() : real !== resolved)) {
    refuse('Authority paths must not contain symbolic links.');
  }
  if (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid())) {
    refuse('Authority paths must be owned by this account and inaccessible to other users.');
  }
}

function openPeerState({ stateDir, namespaceId, initialize = false, origin, now = Date.now }) {
  if (!path.isAbsolute(stateDir) || !UUID.test(namespaceId)) refuse('Explicit authority directory and Core namespace required.');
  protectedPath(stateDir, true);
  const file = path.join(stateDir, FILE_NAME);
  const exists = fs.existsSync(file);
  if (!exists && !initialize) refuse('Authority state is missing; it is never regenerated automatically.');
  if (!exists) {
    originValue(origin);
    // Exclusive creation also serializes competing initializers. A partial file
    // is retained and blocks reinitialization rather than replacing an identity.
    const fd = fs.openSync(file, 'wx', 0o600);
    fs.closeSync(fd);
  }
  protectedPath(file);
  const db = new Database(file, { fileMustExist: true });
  try {
    const actor = process.platform === 'win32' ? os.userInfo().username : `uid:${process.getuid()}`;
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = DELETE');
    db.pragma('synchronous = FULL');
    if (!exists) db.transaction(() => {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const jwk = publicKey.export({ format: 'jwk' });
      const descriptor = { version: 1, serverId: crypto.randomUUID(), origin,
        instanceGeneration: crypto.randomUUID(), publicKey: jwk, keyId: keyThumbprint(jwk) };
      db.exec(`
        CREATE TABLE authority (
          id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL CHECK (version = 1),
          namespace_id TEXT NOT NULL, descriptor TEXT NOT NULL, private_key TEXT NOT NULL,
          high_water INTEGER NOT NULL, recovery_required INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE peers (
          pair_id TEXT PRIMARY KEY, server_id TEXT NOT NULL, descriptor TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'suspended', 'revoked')),
          local_generation TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE INDEX peers_server ON peers(server_id);
        CREATE TRIGGER peer_tombstone BEFORE DELETE ON peers
        BEGIN SELECT RAISE(ABORT, 'Peer records must be retained'); END;
        CREATE TRIGGER peer_revoked BEFORE UPDATE ON peers WHEN OLD.status = 'revoked'
        BEGIN SELECT RAISE(ABORT, 'Revoked pair IDs are permanent'); END;
        CREATE TRIGGER peer_pin_immutable BEFORE UPDATE ON peers
        WHEN NEW.pair_id != OLD.pair_id OR NEW.server_id != OLD.server_id OR NEW.descriptor != OLD.descriptor
          OR NEW.local_generation != OLD.local_generation OR NEW.created_at != OLD.created_at
        BEGIN SELECT RAISE(ABORT, 'Peer pins are immutable'); END;
        CREATE TABLE audit (
          id INTEGER PRIMARY KEY, operation TEXT NOT NULL, pair_id TEXT, at INTEGER NOT NULL,
          actor TEXT NOT NULL, local_generation TEXT NOT NULL
        );
        CREATE TRIGGER audit_retained BEFORE DELETE ON audit
        BEGIN SELECT RAISE(ABORT, 'Peer audit must be retained'); END;
        CREATE TRIGGER audit_immutable BEFORE UPDATE ON audit
        BEGIN SELECT RAISE(ABORT, 'Peer audit is immutable'); END;
      `);
      const time = now();
      db.prepare('INSERT INTO authority (id, version, namespace_id, descriptor, private_key, high_water) VALUES (1, 1, ?, ?, ?, ?)')
        .run(namespaceId, JSON.stringify(descriptor), privateKey.export({ format: 'pem', type: 'pkcs8' }), time);
      db.prepare("INSERT INTO audit (operation, at, actor, local_generation) VALUES ('initialized', ?, ?, ?)")
        .run(time, actor, descriptor.instanceGeneration);
    }).immediate();

    const authority = db.prepare('SELECT * FROM authority WHERE id = 1').get();
    if (!authority || authority.version !== 1 || authority.namespace_id !== namespaceId) refuse('Authority does not match this Core namespace.');
    let descriptor = validateDescriptor(JSON.parse(authority.descriptor));
    const privateKey = crypto.createPrivateKey(authority.private_key);
    if (privateKey.asymmetricKeyType !== 'ed25519' ||
        keyThumbprint(crypto.createPublicKey(privateKey).export({ format: 'jwk' })) !== descriptor.keyId) {
      refuse('Authority key does not match its pinned identity.');
    }
    if (initialize && origin !== descriptor.origin) refuse('Existing identity cannot change origin during initialization.');

    const auditStatement = db.prepare('INSERT INTO audit (operation, pair_id, at, actor, local_generation) VALUES (?, ?, ?, ?, ?)');
    const audit = (operation, pairId, time) => auditStatement.run(operation, pairId, time, actor, descriptor.instanceGeneration);
    const load = () => db.prepare('SELECT * FROM authority WHERE id = 1').get();
    const queueRevocation = recordId => {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'peer_notify'").get()) {
        db.prepare('INSERT OR IGNORE INTO peer_notify (pair_id) SELECT pair_id FROM peer_pairings WHERE peer_record_id = ?').run(recordId);
      }
    };
    const publicPeer = row => ({ pairId: row.pair_id, descriptor: JSON.parse(row.descriptor),
      status: row.status, localGeneration: row.local_generation, createdAt: row.created_at, updatedAt: row.updated_at });
    function mutate(action, recovery = false) {
      const result = db.transaction(() => {
        const row = load(), time = now();
        descriptor = validateDescriptor(JSON.parse(row.descriptor));
        if (!Number.isSafeInteger(time) || time < 0) refuse('Invalid authority clock.');
        if (time < row.high_water) {
          db.prepare('UPDATE authority SET recovery_required = 1 WHERE id = 1').run();
          return { clockError: true };
        }
        if (row.recovery_required && !recovery) return { clockError: true };
        db.prepare('UPDATE authority SET high_water = ? WHERE id = 1').run(time);
        return { value: action(time) };
      }).immediate();
      if (result.clockError) refuse('Clock rollback detected; repair time and run recover before staging peers.');
      return result.value;
    }
    const store = {
      identity() { return JSON.parse(load().descriptor); },
      list() { return db.prepare('SELECT * FROM peers ORDER BY created_at, pair_id').all().map(publicPeer); },
      stage(value, confirmedFingerprint) {
        validateDescriptor(value);
        if (confirmedFingerprint !== value.keyId) refuse('Confirm the full peer fingerprint through a trusted channel.');
        return mutate(time => {
          if (value.serverId === descriptor.serverId || value.origin === descriptor.origin || value.keyId === descriptor.keyId) {
            refuse('A server cannot stage itself as a peer.');
          }
          const previous = db.prepare('SELECT * FROM peers WHERE server_id = ?').all(value.serverId);
          for (const row of previous) {
            const old = JSON.parse(row.descriptor);
            if (old.origin !== value.origin || old.keyId !== value.keyId) refuse('Peer pins changed; rotation is not implemented.');
            if (row.status !== 'revoked' && old.instanceGeneration !== value.instanceGeneration) {
              refuse('Revoke the old pair before staging a recovered instance.');
            }
          }
          if (db.prepare('SELECT server_id FROM peers WHERE json_extract(descriptor, \'$.origin\') = ? AND server_id != ? AND status != \'revoked\'')
            .get(value.origin, value.serverId)) refuse('This origin already has a different pending identity.');
          const pending = previous.find(row => row.status !== 'revoked');
          if (pending) return publicPeer(pending);
          if (db.prepare('SELECT count(*) AS n FROM peers').get().n >= 10000) refuse('Peer preparation capacity exhausted.');
          const id = crypto.randomUUID();
          db.prepare('INSERT INTO peers VALUES (?, ?, ?, \'pending\', ?, ?, ?)')
            .run(id, value.serverId, JSON.stringify(value), descriptor.instanceGeneration, time, time);
          audit('staged', id, time);
          return publicPeer(db.prepare('SELECT * FROM peers WHERE pair_id = ?').get(id));
        });
      },
      transition(pairId, status) {
        if (!UUID.test(pairId) || !['suspended', 'revoked'].includes(status)) refuse('Only suspend and revoke transitions are supported.');
        return mutate(time => {
          const row = db.prepare('SELECT * FROM peers WHERE pair_id = ?').get(pairId);
          if (!row) refuse('Peer pair ID not found.');
          if (row.status === status) return publicPeer(row);
          if (row.status === 'revoked') refuse('Revoked pair IDs cannot be changed.');
          db.prepare('UPDATE peers SET status = ?, updated_at = ? WHERE pair_id = ?').run(status, time, pairId);
          if (status === 'revoked') queueRevocation(pairId);
          audit(status, pairId, time);
          return publicPeer(db.prepare('SELECT * FROM peers WHERE pair_id = ?').get(pairId));
        });
      },
      recover() {
        return mutate(time => {
          if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'peer_invitations'").get()) {
            db.prepare('UPDATE peer_invitations SET cancelled = 1 WHERE acceptance IS NULL').run();
          }
          for (const row of db.prepare("SELECT pair_id FROM peers WHERE status != 'revoked'").all()) {
            db.prepare("UPDATE peers SET status = 'revoked', updated_at = ? WHERE pair_id = ?").run(time, row.pair_id);
            queueRevocation(row.pair_id);
            audit('revoked', row.pair_id, time);
          }
          descriptor.instanceGeneration = crypto.randomUUID();
          db.prepare('UPDATE authority SET descriptor = ?, recovery_required = 0 WHERE id = 1').run(JSON.stringify(descriptor));
          audit('recovered', null, time);
          return descriptor;
        }, true);
      },
      close() { db.close(); }
    };
    store.protocol = options => require('./peerProtocol').createPeerProtocol({
      ...options, db, privateKey, mutate, audit, store, now
    });
    return store;
  } catch (error) {
    db.close();
    throw error;
  }
}

module.exports = { openPeerState, validateDescriptor, keyThumbprint, originValue, FILE_NAME };
