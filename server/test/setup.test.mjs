import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initialize, configure, issueCode, readState } from '../setup.mjs';
import { runtimeCompose, validateDomain } from '../runtime.mjs';
import { normalizeAddress } from '../portal/address.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-installer-'));
  const template = {
    services: {
      homecore: { build: {}, environment: {}, env_file: [{ path: './homecore/.env' }], volumes: [{ type: 'volume', source: 'homecore_data', target: '/data' }] },
      gateway: { build: {}, ports: [{ target: 80, published: '8080' }] },
      tls: { image: 'caddy:2-alpine', profiles: ['public'], environment: {}, volumes: [{ type: 'volume', source: 'caddy_data', target: '/data' }] }
    }, volumes: { homecore_data: {}, caddy_data: {} }
  };
  fs.writeFileSync(path.join(root, 'compose-template.json'), JSON.stringify(template));
  fs.writeFileSync(path.join(root, 'bundle.json'), JSON.stringify({ version: '1.6.2' }));
  return { root, template, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('setup persists credentials and files across repeat starts and access changes', () => {
  const { root, cleanup } = fixture();
  try {
    assert.equal(initialize(root), true);
    const env = fs.readFileSync(path.join(root, 'configuration/core.env'), 'utf8');
    const state = readState(root);
    assert.match(env, /JWT_SECRET=[a-f0-9]{64}/);
    assert.match(env, /HOMECORE_INTERNAL_SECRET=[a-f0-9]{64}/);
    const userFile = path.join(root, 'data/homecore_data/keep.txt');
    fs.writeFileSync(userFile, 'existing data');
    configure(root, { mode: 'public', domain: 'myhome.duckdns.org' });
    assert.equal(initialize(root), false);
    assert.equal(readState(root).access.mode, 'public');
    assert.equal(readState(root).installationId, state.installationId);
    assert.equal(fs.readFileSync(path.join(root, 'configuration/core.env'), 'utf8'), env);
    assert.equal(fs.readFileSync(userFile, 'utf8'), 'existing data');
    const code = issueCode(root);
    assert.match(code, /^(?:[a-f0-9]{4}-){7}[a-f0-9]{4}$/);
    const record = fs.readFileSync(path.join(root, 'data/homecore_data/registration-code.json'), 'utf8');
    assert.ok(!record.includes(code.replaceAll('-', '')));
    assert.equal(JSON.parse(record).expiresAt - JSON.parse(record).issuedAt, 900_000);
    assert.notEqual(issueCode(root), code);
  } finally { cleanup(); }
});

test('setup refuses unidentified data and missing or partial credentials', () => {
  for (const kind of ['data', 'partial', 'missing']) {
    const { root, cleanup } = fixture();
    try {
      if (kind === 'data') {
        fs.mkdirSync(path.join(root, 'data')); fs.writeFileSync(path.join(root, 'data/important'), 'keep');
      } else {
        initialize(root);
        fs.unlinkSync(path.join(root, kind === 'partial' ? 'configuration/installation.json' : 'configuration/core.env'));
      }
      assert.throws(() => initialize(root), /Existing data|Incomplete setup|credentials are missing/);
    } finally { cleanup(); }
  }
});

test('runtime uses prebuilt images, persistent bind mounts, protected registration and local-only ports', () => {
  const { template, cleanup } = fixture();
  try {
    const local = runtimeCompose(template, '1.6.2');
    assert.equal(local.services.homecore.build, undefined);
    assert.equal(local.services.homecore.environment.HOME_SETUP_REQUIRED, 'true');
    assert.equal(local.services.homecore.pull_policy, 'never');
    assert.equal(local.services.homecore.volumes[0].source, './data/homecore_data');
    assert.equal(local.services.gateway.ports[0].host_ip, '127.0.0.1');
    assert.deepEqual(local.services.tls.profiles, ['public']);
    assert.equal(runtimeCompose(template, '1.6.2', { mode: 'lan' }).services.gateway.ports[0].host_ip, '0.0.0.0');
    const remote = runtimeCompose(template, '1.6.2', { mode: 'public', domain: 'home.example.org' });
    assert.equal(remote.services.tls.profiles, undefined);
    assert.equal(remote.services.gateway.ports[0].host_ip, '127.0.0.1');
    assert.equal(template.services.homecore.build !== undefined, true);
  } finally { cleanup(); }
});

test('hostname and portal addresses refuse script URLs, credentials, secrets and unencrypted public access', () => {
  assert.equal(validateDomain('MyHome.duckdns.org'), 'myhome.duckdns.org');
  for (const bad of ['https://example.org', 'example.org/path', '127.0.0.1', 'a..org', 'example.org:443', '${SECRET}', 'example.org\n{']) assert.throws(() => validateDomain(bad));
  assert.equal(normalizeAddress('192.168.1.50:8080'), 'http://192.168.1.50:8080/');
  assert.equal(normalizeAddress('https://home.example.org'), 'https://home.example.org/');
  assert.equal(normalizeAddress('http://[::1]:8080'), 'http://[::1]:8080/');
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'http://example.org', 'https://user:password@example.org', 'https://example.org/?code=secret', 'https://example.org/#secret', 'https://example.org/login']) assert.throws(() => normalizeAddress(bad));
});
