// Real disposable source Compose -> packaged launcher -> managed runtime proof.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runtimeCompose } from './runtime.mjs';

export async function sourceImportSmoke(bundle) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'linux') throw new Error('Disposable Linux GitHub runners only.');
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'home-source-import-proof-'));
  const source = path.join(parent, 'source'), target = path.join(parent, 'managed');
  const project = 'home-import-' + crypto.randomBytes(6).toString('hex');
  function command(executable, args, capture = false) {
    const result = spawnSync(executable, args, { encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', timeout: 240_000 });
    if (result.error || result.status !== 0) {
      // Do not dump resolved environment/inspect payloads on an assertion failure.
      throw new Error('Disposable import command failed: ' + executable + ' ' + args[0] + (result.stderr ? '\n' + result.stderr : ''));
    }
    return result.stdout?.trim();
  }
  const docker = (args, capture = false) => command('docker', args, capture);
  const compose = args => docker(['compose', '--project-directory', source, '-f', path.join(source, 'docker-compose.yml'), ...args]);
  const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'bundle.json')));
  const template = JSON.parse(fs.readFileSync(path.join(bundle, 'compose-template.json')));
  const runtime = runtimeCompose(template, manifest.version);
  fs.mkdirSync(path.join(source, 'homecore'), { recursive: true });
  fs.mkdirSync(path.join(source, 'gateway'));
  fs.mkdirSync(path.join(source, 'backups'));
  fs.mkdirSync(path.join(target, 'configuration'), { recursive: true });
  fs.mkdirSync(path.join(target, 'setup'));
  fs.copyFileSync('docker-compose.yml', path.join(source, 'docker-compose.yml'));
  fs.copyFileSync('gateway/Caddyfile', path.join(source, 'gateway/Caddyfile'));
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ version: manifest.version }));
  fs.writeFileSync(path.join(source, '.env'), `COMPOSE_PROJECT_NAME=${project}\n`);
  fs.writeFileSync(path.join(source, 'homecore/.env'), [
    'JWT_SECRET=' + crypto.randomBytes(32).toString('hex'),
    'HOMECORE_INTERNAL_SECRET=' + crypto.randomBytes(32).toString('hex'),
    'JWT_EXPIRES_IN=3d', 'QUOTA_BYTES=7340032', 'HOME_SETUP_REQUIRED=false', 'PORT=4000', "IMPORT_LITERAL='$HOME_IMPORT_LITERAL'", ''
  ].join('\n'), { mode: 0o600 });
  fs.writeFileSync(path.join(source, 'backups/operator-proof.txt'), 'retained operator backup');
  for (const file of ['bundle.json', 'compose-template.json', 'installer-image.txt', 'home.sh']) fs.copyFileSync(path.join(bundle, file), path.join(target, file));
  fs.copyFileSync(path.join(bundle, 'configuration/Caddyfile'), path.join(target, 'configuration/Caddyfile'));
  for (const file of fs.readdirSync(path.join(bundle, 'setup'))) fs.copyFileSync(path.join(bundle, 'setup', file), path.join(target, 'setup', file));
  for (const [name, service] of Object.entries(template.services)) {
    if (!service.build) continue;
    fs.mkdirSync(path.resolve(source, service.build.context), { recursive: true });
    docker(['image', 'tag', runtime.services[name].image, `${project}-${name}:latest`]);
  }
  const origin = 'http://127.0.0.1:8080';
  let token;
  async function request(route, body, expected = 200, method = body ? 'POST' : 'GET') {
    const response = await fetch(origin + route, { method,
      headers: { Connection: 'close', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, expected, route);
    return response.json();
  }
  async function upload(name, text) {
    const form = new FormData(); form.append('file', new Blob([text]), name);
    const response = await fetch(origin + '/api/homecloud/files/upload', { method: 'POST', headers: { Connection: 'close', Authorization: 'Bearer ' + token }, body: form, signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 201); await response.arrayBuffer();
  }
  try {
    compose(['up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '180']);
    const account = { username: 'source-import-owner', password: 'Disposable-Import-Password1' };
    const created = await request('/api/auth/register', account, 201); token = created.token;
    const available = await request('/api/core/app-catalog');
    for (const manifest of available.applications) {
      await request(`/api/core/apps/${manifest.slug}/install`, {}, 201);
      await request(`/api/core/apps/${manifest.slug}`, { enabled: true }, 200, 'PATCH');
    }
    await upload('source-proof.bin', 'exact source upload bytes');
    const file = (await request('/api/homecloud/files')).files.find(value => value.name === 'source-proof.bin');
    const note = await request('/api/homenotes/notes', { title: 'Source note', content: 'source **Markdown** body' }, 201);
    const task = await request('/api/hometasks/tasks', { title: 'Source task', notes: 'retained task notes' }, 201);
    const envelope = { kdfParams: { m: 19456, t: 2, p: 1 } };
    for (const key of ['kdfSalt', 'wrappedKeyMaster', 'wrappedKeyMasterIv', 'wrappedKeyRecovery', 'wrappedKeyRecoveryIv', 'verifier', 'verifierIv']) envelope[key] = Buffer.from('dummy opaque ' + key).toString('base64');
    await request('/api/homevault/vault', envelope, 201);
    const item = await request('/api/homevault/vault/items', { type: 'note', encryptedTitle: 'dummy-ciphertext-title', encryptedTitleIv: 'dummy-title-iv', encryptedData: 'dummy-ciphertext-body', encryptedDataIv: 'dummy-data-iv' }, 201);
    const vaultBefore = await request('/api/homevault/vault');
    const me = await request('/api/core/auth/me');
    const volumesBefore = docker(['volume', 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project], true).split('\n').sort();
    const first = command('sh', [path.join(target, 'home.sh'), 'import', source], true);
    assert.match(first, /HOME imported/);
    assert.deepEqual(await request('/api/core/auth/me'), me, 'Original session remains valid for the same account');
    assert.equal((await request('/api/auth/login', account)).user.id, me.id);
    const bytes = await fetch(origin + `/api/homecloud/files/${file.id}/download`, { headers: { Connection: 'close', Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15_000) });
    assert.equal(await bytes.text(), 'exact source upload bytes');
    assert.deepEqual(await request(`/api/homenotes/notes/${note.note.id}`), note);
    assert.deepEqual(await request(`/api/hometasks/tasks/${task.task.id}`), task);
    assert.deepEqual(await request('/api/homevault/vault'), vaultBefore);
    assert.deepEqual(await request(`/api/homevault/vault/items/${item.item.id}`), item);
    assert.equal(fs.readFileSync(path.join(target, 'backups/operator-proof.txt'), 'utf8'), 'retained operator backup');
    assert.deepEqual(docker(['volume', 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project], true).split('\n').sort(), volumesBefore, 'Original named volumes remain');
    assert.equal(docker(['ps', '-q', '--filter', 'label=com.docker.compose.project=' + project], true), '', 'Source remains stopped');
    await upload('after-import.bin', 'new managed writes');
    command('sh', [path.join(target, 'home.sh'), 'import', source], true);
    assert.ok((await request('/api/homecloud/files')).files.some(value => value.name === 'after-import.bin'));
    const settings = JSON.parse(fs.readFileSync(path.join(target, 'compose.json')));
    assert.equal(settings.services.homecore.environment.QUOTA_BYTES, '7340032');
    const core = docker(['compose', '-f', path.join(target, 'compose.json'), 'ps', '-q', 'homecore'], true);
    const environment = JSON.parse(docker(['inspect', '--format', '{{json .Config.Env}}', core], true));
    assert.ok(environment.includes('IMPORT_LITERAL=$HOME_IMPORT_LITERAL'), 'Literal dollars must not be re-interpolated');
    const monitor = docker(['compose', '-f', path.join(target, 'compose.json'), 'ps', '-q', 'homemonitor-backend'], true);
    const monitorEnvironment = JSON.parse(docker(['inspect', '--format', '{{json .Config.Env}}', monitor], true));
    assert.ok(monitorEnvironment.includes('JWT_SECRET='), 'Monitor must retain its blank signing-key override');
    assert.equal(settings.services.gateway.ports[0].host_ip, '127.0.0.1');
    console.log('Source import: actual launcher, named-volume provenance, original login/session, file bytes, notes/tasks, opaque Vault records, retained backups/volumes and no replay over new writes verified.');
  } finally {
    if (fs.existsSync(path.join(target, 'compose.json'))) docker(['compose', '-f', path.join(target, 'compose.json'), 'down']);
    compose(['--profile', '*', 'down', '-v']); // This function only creates its own disposable project.
  }
}
