// Only disposable GitHub runners: never point this at a personal Docker host.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initialize, issueCode } from './setup.mjs';
import { runtimeCompose } from './runtime.mjs';
if (process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'linux') throw new Error('Run this smoke check only on a disposable Linux GitHub runner.');
function docker(args, capture = false) {
  const result = spawnSync('docker', args, { stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Docker smoke operation failed.');
  return result.stdout?.trim();
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-server-smoke-'));
const bundle = process.argv[2];
if (bundle) docker(['load', '-i', path.join(bundle, 'images.tar')]);
const template = bundle ? JSON.parse(fs.readFileSync(path.join(bundle, 'compose-template.json'))) :
  JSON.parse(docker(['compose', '--profile', 'bridge', '--profile', 'public', 'config', '--no-env-resolution', '--no-path-resolution', '--no-interpolate', '--format', 'json'], true));
const version = JSON.parse(fs.readFileSync('package.json')).version;
const runtime = runtimeCompose(template, version);
for (const [name, service] of Object.entries(template.services)) {
  if (service.build && !bundle) {
    const id = docker(['compose', '--profile', 'bridge', 'images', '-q', name], true).split('\n')[0];
    assert.ok(id, 'Missing built image: ' + name);
    docker(['image', 'tag', id, runtime.services[name].image]);
  }
}
fs.writeFileSync(path.join(root, 'bundle.json'), JSON.stringify({ version }));
fs.writeFileSync(path.join(root, 'compose-template.json'), JSON.stringify(template));
initialize(root);
fs.copyFileSync('gateway/Caddyfile', path.join(root, 'configuration/Caddyfile'));
const code = issueCode(root);
const compose = args => docker(['compose', '-f', path.join(root, 'compose.json'), ...args]);
const origin = 'http://127.0.0.1:8080';
async function request(route, body, token) {
  const response = await fetch(origin + route, {
    method: body ? 'POST' : 'GET',
    // Synchronous Docker stop/start blocks Node's socket-close callbacks.
    // Each probe must open a new connection instead of reusing a pre-stop socket.
    headers: { Connection: 'close', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000)
  });
  return response;
}
try {
  if (!bundle) docker(['compose', 'stop', 'gateway']);
  compose(['up', '-d', '--wait', '--wait-timeout', '180']);
  for (const route of ['/', '/register', '/cloud/', '/media/', '/notes/', '/tasks/', '/monitor/', '/vault/']) assert.equal((await request(route)).status, 200);
  const account = { username: 'installer-owner', password: 'Disposable-Installer-Password1' };
  assert.equal((await request('/api/auth/register', account)).status, 403);
  const created = await request('/api/core/auth/register', { ...account, setupCode: code });
  assert.equal(created.status, 201);
  const { token, user } = await created.json();
  assert.equal(user.role, 'admin');
  assert.equal((await request('/api/auth/register', { ...account, username: 'replay-user', setupCode: code })).status, 403);
  const form = new FormData();
  form.append('file', new Blob(['installer persistence proof']), 'proof.txt');
  const upload = await fetch(origin + '/api/homecloud/files/upload', { method: 'POST', headers: { Connection: 'close', Authorization: 'Bearer ' + token }, body: form });
  assert.equal(upload.status, 201);
  await upload.json();
  const before = fs.readFileSync(path.join(root, 'configuration/core.env'), 'utf8');
  compose(['stop']);
  assert.equal(initialize(root), false);
  assert.equal(fs.readFileSync(path.join(root, 'configuration/core.env'), 'utf8'), before);
  compose(['up', '-d', '--wait', '--wait-timeout', '180']);
  assert.equal((await request('/api/auth/login', account)).status, 200);
  const listing = await request('/api/homecloud/files', undefined, token);
  const files = (await listing.json()).files;
  const file = files.find(item => item.name === 'proof.txt');
  assert.ok(file, 'Uploaded file persists after restart');
  assert.equal(await (await request(`/api/homecloud/files/${file.id}/download`, undefined, token)).text(), 'installer persistence proof');
  console.log('Runtime installation: protected claim, upload, restart and exact-byte download verified.');
} catch (error) {
  compose(['logs', '--tail', '50']);
  throw error;
} finally {
  compose(['down']);
}
