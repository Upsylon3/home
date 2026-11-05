import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareSourceImport, validateSourceContainers, validateSourceVolume, importSource, readSourceImportPlan, parseImportJson } from '../source-import.mjs';
import { initialize, readState } from '../setup.mjs';
import { upgradeBundle } from '../upgrade.mjs';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'home-source-import-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'bundle'), sourceRoot = path.join(root, 'source'), adapter = path.join(root, 'adapter');
  fs.mkdirSync(path.join(target, 'configuration'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'gateway'), { recursive: true });
  fs.mkdirSync(path.join(adapter, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'gateway/Caddyfile'), 'preserved operator gateway');
  fs.writeFileSync(path.join(target, 'configuration/Caddyfile'), 'bundle default');
  fs.writeFileSync(path.join(adapter, 'backups/retained.tar.gz'), 'original archive');
  const services = {};
  for (const [name, volume, port] of [['homecore', 'homecore_data', '4000'],
    ['homecloud-backend', 'homecloud_backend_data', '4500'], ['homemonitor-backend', 'homemonitor_data', '4800']]) {
    services[name] = { build: { context: '.' }, environment: { DATA_DIR: '/data', PORT: port },
      env_file: [{ path: './homecore/.env', required: true }], expose: [port],
      volumes: [{ type: 'volume', source: volume, target: '/data' }] };
  }
  services.gateway = { build: { context: './gateway' }, ports: [{ target: 80, published: '8080' }] };
  services['homemonitor-backend'].environment.JWT_SECRET = '';
  services.tls = { image: 'caddy:2-alpine', profiles: ['public'], environment: { HOME_DOMAIN: '${HOME_DOMAIN:-}' },
    volumes: [{ type: 'bind', source: './gateway/Caddyfile', target: '/etc/caddy/Caddyfile', read_only: true, bind: { create_host_path: true } },
      { type: 'volume', source: 'caddy_data', target: '/data' }, { type: 'volume', source: 'caddy_config', target: '/config' }] };
  const template = { name: 'home', services, volumes: Object.fromEntries(['homecore_data', 'homecloud_backend_data', 'homemonitor_data', 'caddy_data', 'caddy_config'].map(name => [name, { name: 'home_' + name }])), networks: { default: { name: 'home_default' } } };
  const config = structuredClone(template);
  config.networks.default.ipam = {};
  config.services.tls.environment.HOME_DOMAIN = 'family.example.org';
  const credentials = { JWT_SECRET: 'a'.repeat(64), HOMECORE_INTERNAL_SECRET: 'b'.repeat(64) };
  for (const [name, service] of Object.entries(config.services)) {
    service.command = null; service.entrypoint = null;
    for (const mount of service.volumes || []) if (mount.bind) delete mount.bind.create_host_path;
    if (service.env_file) {
      Object.assign(service.environment, credentials, { QUOTA_BYTES: '123456789', JWT_EXPIRES_IN: '3d', CORS_ORIGIN: 'https://family.example.org', IMPORT_NOTE: 'Unicode Δ with spaces\nand lines', IMPORT_LITERAL: '$$HOME_SHOULD_NOT_EXPAND' });
      if (name === 'homemonitor-backend') service.environment.JWT_SECRET = '';
      delete service.env_file;
    }
  }
  fs.writeFileSync(path.join(target, 'compose-template.json'), JSON.stringify(template));
  fs.writeFileSync(path.join(target, 'bundle.json'), JSON.stringify({ schema: 1, version: '1.7.1', arch: 'x64',
    upgrade: { schema: 1, minimumSourceVersion: '1.7.0' }, sourceImport: { schema: 1, minimumSourceVersion: '1.7.0' } }));
  for (const logical of ['homecore_data', 'homecloud_backend_data', 'homemonitor_data']) {
    const dir = path.join(adapter, 'data', logical);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, logical === 'homecloud_backend_data' ? 'homecloud.db' : logical.replace('_data', '.db')), 'opaque preserved database ' + logical);
  }
  fs.writeFileSync(path.join(adapter, 'data/homecore_data/homecore.db-wal'), 'committed WAL bytes');
  fs.writeFileSync(path.join(adapter, 'data/homecloud_backend_data/upload.bin'), Buffer.alloc(1_100_000, 37));
  const containers = Object.entries(config.services).map(([name, service]) => ({ Config: {
    Labels: { 'com.docker.compose.project': 'home', 'com.docker.compose.service': name },
    Env: Object.entries(service.environment || {}).map(([key, value]) => key + '=' + value.replaceAll('$$', () => '$'))
  }, Mounts: (service.volumes || []).filter(mount => mount.type === 'volume').map(mount => ({ Type: 'volume', Destination: mount.target, Name: config.volumes[mount.source].name })) }));
  return { root, target, sourceRoot, adapter, config, template, credentials, containers,
    prepare: () => prepareSourceImport(target, config, '1.7.0'),
    transfer: () => importSource(target, { sourceRoot, adapter, confirmStopped: true }) };
}

test('source import preserves credentials, opaque databases/WAL/uploads/backups/settings and starts locally', t => {
  const f = fixture(t), plan = f.prepare();
  assert.equal(f.prepare().installationId, plan.installationId);
  assert.throws(() => initialize(f.target), /Source import is incomplete/);
  validateSourceContainers(f.target, f.containers);
  for (const [logical, name] of Object.entries(plan.volumes)) validateSourceVolume(f.target, logical, [{ Name: name, Driver: 'local', Options: null,
    Labels: { 'com.docker.compose.project': 'home', 'com.docker.compose.volume': logical } }]);
  assert.equal(f.transfer(), true);
  assert.equal(initialize(f.target), false);
  assert.equal(readState(f.target).installationId, plan.installationId);
  assert.equal(readState(f.target).access.mode, 'local');
  const compose = JSON.parse(fs.readFileSync(path.join(f.target, 'compose.json')));
  assert.equal(compose.services.homecore.environment.QUOTA_BYTES, '123456789');
  assert.equal(compose.services.homecore.environment.IMPORT_NOTE, 'Unicode Δ with spaces\nand lines');
  assert.equal(compose.services.homecore.environment.IMPORT_LITERAL, '$$HOME_SHOULD_NOT_EXPAND');
  assert.equal(compose.services.homecore.environment.HOME_SETUP_REQUIRED, 'true');
  assert.equal(compose.services['homemonitor-backend'].environment.JWT_SECRET, '', 'Monitor never receives the signing key');
  assert.equal(compose.services.gateway.ports[0].host_ip, '127.0.0.1');
  assert.equal(compose.services.tls.environment.HOME_DOMAIN, '');
  assert.match(fs.readFileSync(path.join(f.target, 'configuration/core.env'), 'utf8'), new RegExp('JWT_SECRET=' + f.credentials.JWT_SECRET));
  assert.doesNotMatch(fs.readFileSync(path.join(f.target, 'configuration/source-settings.json'), 'utf8'), /JWT_SECRET|HOMECORE_INTERNAL_SECRET/);
  assert.doesNotMatch(fs.readFileSync(path.join(f.target, 'source-import-plan.json'), 'utf8'), /"credentials"|"services"/);
  for (const name of ['homecore_data/homecore.db', 'homecore_data/homecore.db-wal', 'homecloud_backend_data/upload.bin']) {
    assert.deepEqual(fs.readFileSync(path.join(f.target, 'data', name)), fs.readFileSync(path.join(f.adapter, 'data', name)));
  }
  assert.equal(fs.readFileSync(path.join(f.target, 'backups/retained.tar.gz'), 'utf8'), 'original archive');
  fs.appendFileSync(path.join(f.target, 'data/homecore_data/homecore.db'), 'new destination writes');
  assert.equal(f.transfer(), false);
  assert.equal(f.prepare().status, 'complete');
  assert.match(fs.readFileSync(path.join(f.target, 'data/homecore_data/homecore.db'), 'utf8'), /new destination writes$/);
  assert.doesNotMatch(fs.readFileSync(path.join(f.adapter, 'data/homecore_data/homecore.db'), 'utf8'), /new destination writes/);
});

test('container, effective environment and mounted volume provenance must match before import', t => {
  for (const alter of [rows => rows.slice(1), rows => [...rows, rows[0]],
    rows => { rows[0].Config.Env.push('JWT_SECRET=different'); return rows; },
    rows => { rows[0].Mounts[0].Name = 'other_home'; return rows; },
    rows => { rows[0].Config.Labels['com.docker.compose.project'] = 'other'; return rows; }]) {
    const f = fixture(t); f.prepare();
    assert.throws(() => validateSourceContainers(f.target, alter(structuredClone(f.containers))));
    assert.equal(fs.existsSync(path.join(f.target, 'data')), false);
  }
});

test('volume metadata rejects foreign projects, external drivers and missing ownership labels', t => {
  const f = fixture(t); f.prepare();
  for (const metadata of [{ Name: 'other', Driver: 'local' }, { Name: 'home_homecore_data', Driver: 'nfs' },
    { Name: 'home_homecore_data', Driver: 'local', Labels: { 'com.docker.compose.project': 'other' } }]) {
    assert.throws(() => validateSourceVolume(f.target, 'homecore_data', metadata), /does not match/);
  }
});

test('unsupported versions, custom mounts/addresses/privileges and changed source plans are refused', t => {
  const f = fixture(t);
  assert.throws(() => prepareSourceImport(f.target, f.config, '1.6.2'), /cannot import/);
  assert.throws(() => prepareSourceImport(f.target, f.config, '2.0.0'), /cannot import/);
  for (const mutate of [v => { v.services.homecore.privileged = true; },
    v => { v.services.homecore.volumes[0].type = 'bind'; },
    v => { v.services.homecore.environment.DATA_DIR = '/elsewhere'; },
    v => { v.volumes.homecore_data.external = true; },
    v => { v.networks.default.ipam = { config: [{ subnet: '172.28.0.0/16' }] }; },
    v => { v.networks.default.driver = 'host'; },
    v => { v.services.tls.volumes[0].source = '/outside'; },
    v => { v.services.tls.volumes[0].read_only = false; },
    v => { v.services['homemonitor-backend'].environment.JWT_SECRET = v.services.homecore.environment.JWT_SECRET; },
    v => { v.services.homecore.environment.JWT_SECRET = 'unsafe$dotenv'; }]) {
    const changed = structuredClone(f.config); mutate(changed);
    assert.throws(() => prepareSourceImport(f.target, changed, '1.7.0'));
  }
  f.prepare();
  const changed = structuredClone(f.config); changed.services.homecore.environment.QUOTA_BYTES = '1';
  assert.throws(() => prepareSourceImport(f.target, changed, '1.7.0'), /changed source import/);
});

test('empty/missing application volumes and unconfirmed writers never create an installation', t => {
  const f = fixture(t); f.prepare();
  assert.throws(() => importSource(f.target, { sourceRoot: f.sourceRoot, adapter: f.adapter }), /Stop and verify/);
  fs.unlinkSync(path.join(f.adapter, 'data/homecloud_backend_data/homecloud.db'));
  assert.throws(() => f.transfer(), /storage is missing/);
  assert.equal(fs.existsSync(path.join(f.target, 'compose.json')), false);
});

test('failed import resumes without changing the source, and imported HOME remains upgradeable', t => {
  const f = fixture(t); f.prepare();
  const copy = fs.copyFileSync;
  const fault = mock.method(fs, 'copyFileSync', (from, to, flags) => {
    if (from.endsWith('upload.bin')) throw new Error('Simulated disk full');
    return copy(from, to, flags);
  });
  assert.throws(() => f.transfer(), /disk full/); fault.mock.restore();
  assert.throws(() => initialize(f.target), /Source import is incomplete/);
  assert.equal(f.transfer(), true);
  const next = path.join(f.root, 'later bundle');
  fs.mkdirSync(path.join(next, 'configuration'), { recursive: true });
  fs.writeFileSync(path.join(next, 'configuration/Caddyfile'), 'default');
  fs.copyFileSync(path.join(f.target, 'compose-template.json'), path.join(next, 'compose-template.json'));
  const manifest = JSON.parse(fs.readFileSync(path.join(f.target, 'bundle.json'))); manifest.version = '1.8.0';
  fs.writeFileSync(path.join(next, 'bundle.json'), JSON.stringify(manifest));
  assert.equal(upgradeBundle(f.target, next, { confirmStopped: true }), true);
  assert.equal(initialize(next), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(next, 'compose.json'))).services.homecore.environment.QUOTA_BYTES, '123456789');
});

test('private metadata parse/settings failures never echo credential-bearing JSON', t => {
  assert.throws(() => parseImportJson('{"secret":"do-not-print-this'), error => !error.message.includes('do-not-print-this'));
  const f = fixture(t); f.prepare(); f.transfer();
  fs.writeFileSync(path.join(f.target, 'configuration/source-settings.json'), '{"secret":"do-not-print-this');
  assert.throws(() => initialize(f.target), error => /settings are missing or invalid/.test(error.message) && !error.message.includes('do-not-print-this'));
});
