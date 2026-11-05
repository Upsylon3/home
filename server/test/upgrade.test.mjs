import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initialize, configure, readState } from '../setup.mjs';
import { planUpgrade, upgradeBundle } from '../upgrade.mjs';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'home-upgrade-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'old bundle'), target = path.join(root, 'new bundle');
  const template = {
    services: {
      homecore: { build: {}, environment: {}, env_file: ['unused'], volumes: [{ type: 'volume', source: 'homecore_data', target: '/data' }] },
      gateway: { build: {} },
      tls: { image: 'caddy:2-alpine', profiles: ['public'], environment: {}, volumes: [{ type: 'volume', source: 'caddy_data', target: '/data' }] }
    }, volumes: { homecore_data: {}, caddy_data: {} }
  };
  for (const [folder, version] of [[source, '1.7.0'], [target, '1.8.0']]) {
    fs.mkdirSync(path.join(folder, 'configuration'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'configuration/Caddyfile'), 'new-default');
    fs.writeFileSync(path.join(folder, 'compose-template.json'), JSON.stringify(template));
    fs.writeFileSync(path.join(folder, 'bundle.json'), JSON.stringify({ schema: 1, arch: 'x64', version,
      ...(folder === target ? { upgrade: { schema: 1, minimumSourceVersion: '1.7.0' } } : {}) }));
  }
  initialize(source);
  fs.writeFileSync(path.join(source, 'data/homecore_data/homecore.db'), 'opaque database bytes');
  fs.writeFileSync(path.join(source, 'data/homecore_data/homecore.db-wal'), 'committed WAL bytes');
  fs.writeFileSync(path.join(source, 'data/homecore_data/upload.bin'), Buffer.alloc(2_100_000, 73));
  fs.writeFileSync(path.join(source, 'backups/retained.tar.gz'), 'protected existing backup');
  fs.writeFileSync(path.join(source, 'configuration/Caddyfile'), 'retained operator configuration');
  const file = (folder, name) => path.join(folder, name);
  const update = (folder, name, change) => {
    const location = file(folder, name), value = JSON.parse(fs.readFileSync(location));
    fs.writeFileSync(location, JSON.stringify(change(value)));
  };
  return { root, source, target, file, update };
}

test('offline transfer preserves identity, credentials, access, bytes, sidecars and backups with new images', t => {
  const { source, target, file } = fixture(t);
  configure(source, { mode: 'public', domain: 'family.example.org' });
  const state = readState(source), credentials = fs.readFileSync(file(source, 'configuration/core.env'));
  assert.equal(planUpgrade(source, target).project, 'home-server-' + state.installationId);
  assert.equal(upgradeBundle(source, target, { confirmStopped: true }), true);
  assert.deepEqual(readState(target), state);
  for (const name of ['configuration/core.env', 'configuration/Caddyfile', 'data/homecore_data/homecore.db',
    'data/homecore_data/homecore.db-wal', 'data/homecore_data/upload.bin', 'backups/retained.tar.gz']) {
    assert.deepEqual(fs.readFileSync(file(target, name)), fs.readFileSync(file(source, name)), name);
  }
  assert.deepEqual(fs.readFileSync(file(source, 'configuration/core.env')), credentials);
  const compose = JSON.parse(fs.readFileSync(file(target, 'compose.json')));
  assert.equal(compose.services.homecore.image, 'home-server-homecore:1.8.0');
  assert.equal(compose.name, 'home-server-' + state.installationId);
  assert.equal(compose.services.gateway.ports[0].host_ip, '127.0.0.1');
  assert.equal(initialize(target), false);
  fs.appendFileSync(file(target, 'data/homecore_data/homecore.db'), 'new writes');
  assert.equal(upgradeBundle(source, target, { confirmStopped: true }), false);
  assert.match(fs.readFileSync(file(target, 'data/homecore_data/homecore.db'), 'utf8'), /new writes$/);
  assert.doesNotMatch(fs.readFileSync(file(source, 'data/homecore_data/homecore.db'), 'utf8'), /new writes/);
});

test('read-only preflight and explicit offline confirmation precede any destination writes', t => {
  const { source, target, file } = fixture(t);
  planUpgrade(source, target);
  assert.equal(fs.existsSync(file(target, 'upgrade-state.json')), false);
  assert.throws(() => upgradeBundle(source, target), /Stop all source writers/);
  assert.equal(fs.existsSync(file(target, 'data')), false);
});

test('upgrade refuses unsupported versions, downgrades and processor changes', t => {
  for (const change of [v => ({ ...v, version: '1.6.2' }), v => ({ ...v, version: '1.9.0' }),
    v => ({ ...v, arch: 'arm64' }), v => ({ ...v, version: '1.7.0-beta.1' })]) {
    const { source, target, update } = fixture(t);
    update(source, 'bundle.json', change);
    assert.throws(() => planUpgrade(source, target), /not support|architecture|stable release/);
  }
});

test('upgrade refuses same or nested folders, existing installations and customized topology', t => {
  const { source, target, update } = fixture(t);
  assert.throws(() => planUpgrade(source, source), /non-nested/);
  const nested = path.join(source, 'nested'); fs.mkdirSync(nested);
  assert.throws(() => planUpgrade(source, nested), /non-nested/);
  initialize(target);
  assert.throws(() => planUpgrade(source, target), /fresh destination/);
  update(source, 'compose.json', value => ({ ...value, name: 'another-project' }));
  assert.throws(() => planUpgrade(source, target), /Customized Compose/);
});

test('missing credentials, missing storage and removed volumes fail closed', t => {
  for (const kind of ['credentials', 'database', 'storage']) {
    const { source, target, file, update } = fixture(t);
    if (kind === 'credentials') fs.writeFileSync(file(source, 'configuration/core.env'), 'not credentials');
    if (kind === 'database') fs.unlinkSync(file(source, 'data/homecore_data/homecore.db'));
    if (kind === 'storage') update(target, 'compose-template.json', v => ({ ...v, volumes: {} }));
    assert.throws(() => planUpgrade(source, target));
    assert.equal(fs.existsSync(file(target, 'upgrade-state.json')), false);
  }
});

test('symbolic links cannot introduce outside files into the copy', { skip: process.platform === 'win32' ? 'Symlink privilege is not assumed on Windows.' : false }, t => {
  const { source, target, file } = fixture(t);
  fs.symlinkSync(file(source, 'configuration/core.env'), file(source, 'data/homecore_data/link'));
  assert.throws(() => planUpgrade(source, target), /symbolic links/);
  assert.equal(fs.existsSync(file(target, 'upgrade-state.json')), false);
});

test('interrupted copy blocks startup and retries without changing the source', t => {
  const { source, target, file } = fixture(t);
  const originalCopy = fs.copyFileSync;
  const copying = mock.method(fs, 'copyFileSync', (from, to, flags) => {
    if (from.endsWith('upload.bin')) throw new Error('Simulated disk full');
    return originalCopy(from, to, flags);
  });
  assert.throws(() => upgradeBundle(source, target, { confirmStopped: true }), /disk full/);
  copying.mock.restore();
  assert.throws(() => initialize(target), /Upgrade is incomplete/);
  assert.equal(fs.readFileSync(file(source, 'data/homecore_data/homecore.db'), 'utf8'), 'opaque database bytes');
  assert.equal(upgradeBundle(source, target, { confirmStopped: true }), true);
  assert.equal(initialize(target), false);
});

test('interrupted publication resumes even between configuration removal and rename', t => {
  const { source, target, file } = fixture(t);
  const originalRename = fs.renameSync;
  const renaming = mock.method(fs, 'renameSync', (from, to) => {
    if (to === file(target, 'configuration')) throw new Error('Simulated interruption');
    return originalRename(from, to);
  });
  assert.throws(() => upgradeBundle(source, target, { confirmStopped: true }), /interruption/);
  renaming.mock.restore();
  assert.throws(() => initialize(target), /Upgrade is incomplete/);
  assert.equal(upgradeBundle(source, target, { confirmStopped: true }), true);
  assert.equal(initialize(target), false);
});

test('a mismatched or traversal-shaped journal never authorizes cleanup or overwrite', t => {
  const { source, target, file } = fixture(t);
  fs.writeFileSync(file(target, 'upgrade-state.json'), JSON.stringify({ schema: 1, stage: '..' }));
  assert.throws(() => planUpgrade(source, target), /unrecognized upgrade/);
  assert.equal(fs.readFileSync(file(source, 'data/homecore_data/homecore.db'), 'utf8'), 'opaque database bytes');
});

test('publication retry refuses a stale staged snapshot after the original receives new writes', t => {
  const { source, target, file } = fixture(t);
  const originalRename = fs.renameSync;
  const renaming = mock.method(fs, 'renameSync', (from, to) => {
    if (to === file(target, 'data')) throw new Error('Simulated interruption before storage publication');
    return originalRename(from, to);
  });
  assert.throws(() => upgradeBundle(source, target, { confirmStopped: true }), /interruption/);
  renaming.mock.restore();
  fs.appendFileSync(file(source, 'data/homecore_data/homecore.db'), 'new source writes');
  assert.throws(() => upgradeBundle(source, target, { confirmStopped: true }), /original changed after copying/);
  assert.throws(() => initialize(target), /Upgrade is incomplete/);
  assert.match(fs.readFileSync(file(source, 'data/homecore_data/homecore.db'), 'utf8'), /new source writes$/);
});
