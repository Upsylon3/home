// Only disposable GitHub runners: never point this at a personal Docker host.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initialize, issueCode } from './setup.mjs';
import { runtimeCompose } from './runtime.mjs';
import { sourceImportSmoke } from './source-import-smoke.mjs';
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
fs.writeFileSync(path.join(root, 'bundle.json'), JSON.stringify({ schema: 1, version, arch: process.arch }));
fs.writeFileSync(path.join(root, 'compose-template.json'), JSON.stringify(template));
initialize(root);
fs.copyFileSync('gateway/Caddyfile', path.join(root, 'configuration/Caddyfile'));
const code = issueCode(root);
const compose = args => docker(['compose', '-f', path.join(root, 'compose.json'), ...args]);
let upgradedRoot;
const origin = 'http://127.0.0.1:8080';
async function request(route, body, token, method = body ? 'POST' : 'GET') {
  const response = await fetch(origin + route, {
    method,
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
  assert.deepEqual((await (await request('/api/core/apps', undefined, token)).json()).applications, []);
  const available = (await (await request('/api/core/app-catalog', undefined, token)).json()).applications;
  assert.equal(available.length, 7);
  for (const manifest of available) {
    const installed = await request(`/api/core/apps/${manifest.slug}/install`, {}, token);
    assert.equal(installed.status, 201);
    assert.equal((await installed.json()).application.enabled, false);
    assert.equal((await request(`/api/core/apps/${manifest.slug}`, { enabled: true }, token, 'PATCH')).status, 200);
  }
  const retainedNote = await (await request('/api/homenotes/notes', { title: 'Keep on uninstall', content: 'retained app data' }, token)).json();
  assert.equal((await request('/api/core/apps/homenotes', undefined, token, 'DELETE')).status, 200);
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
  assert.equal((await request('/api/core/apps/homenotes', undefined, token)).status, 404);
  const reinstalled = await request('/api/core/apps/homenotes/install', {}, token);
  assert.equal(reinstalled.status, 201);
  assert.equal((await reinstalled.json()).application.enabled, false);
  assert.equal((await request('/api/core/apps/homenotes', { enabled: true }, token, 'PATCH')).status, 200);
  const restoredNote = await (await request(`/api/homenotes/notes/${retainedNote.note.id}`, undefined, token)).json();
  assert.equal(restoredNote.note.content, 'retained app data');
  const listing = await request('/api/homecloud/files', undefined, token);
  const files = (await listing.json()).files;
  const file = files.find(item => item.name === 'proof.txt');
  assert.ok(file, 'Uploaded file persists after restart');
  assert.equal(await (await request(`/api/homecloud/files/${file.id}/download`, undefined, token)).text(), 'installer persistence proof');
  compose(['--profile', '*', 'stop']);
  upgradedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'home-server-upgrade-smoke-'));
  const parts = version.split('.').map(Number);
  const nextVersion = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  const nextRuntime = runtimeCompose(template, nextVersion);
  for (const [name, service] of Object.entries(runtime.services)) {
    if (!bundle && name === 'tls') continue; // Inactive public profile need not be downloaded for source-only proof.
    docker(['image', 'tag', service.image, nextRuntime.services[name].image]);
  }
  fs.mkdirSync(path.join(upgradedRoot, 'configuration'));
  fs.writeFileSync(path.join(upgradedRoot, 'configuration/Caddyfile'), 'fresh-bundle-default');
  fs.writeFileSync(path.join(upgradedRoot, 'compose-template.json'), JSON.stringify(template));
  fs.writeFileSync(path.join(upgradedRoot, 'bundle.json'), JSON.stringify({ schema: 1, version: nextVersion, arch: process.arch,
    upgrade: { schema: 1, minimumSourceVersion: '1.7.0' } }));
  fs.mkdirSync(path.join(upgradedRoot, 'setup'));
  for (const name of ['setup.mjs', 'runtime.mjs', 'upgrade.mjs', 'source-import.mjs', 'diagnose.mjs', 'coordinated.mjs', 'cli.mjs']) {
    fs.copyFileSync(bundle ? path.join(bundle, 'setup', name) : path.join('server', name), path.join(upgradedRoot, 'setup', name));
  }
  const transfer = () => docker(['run', '--rm',
    '--mount', `type=bind,source=${upgradedRoot},target=/bundle`,
    '--mount', `type=bind,source=${root},target=/previous,readonly`,
    '--entrypoint', 'node', nextRuntime.services.homecore.image, '/bundle/setup/cli.mjs', 'upgrade', '--confirm-stopped'], true);
  const oldDatabase = fs.readFileSync(path.join(root, 'data/homecore_data/homecore.db'));
  assert.match(transfer(), /Upgrade copied and verified/);
  assert.equal(fs.readFileSync(path.join(upgradedRoot, 'configuration/core.env'), 'utf8'), before);
  const upgradedCompose = args => docker(['compose', '-f', path.join(upgradedRoot, 'compose.json'), ...args]);
  upgradedCompose(['up', '-d', '--wait', '--wait-timeout', '180', '--remove-orphans']);
  const stateBeforeDiagnostics = fs.readFileSync(path.join(upgradedRoot, 'configuration/installation.json'));
  const diagnosticOutput = docker(['run', '--rm', '--user', `${process.getuid()}:${process.getgid()}`,
    '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--mount', `type=bind,source=${upgradedRoot},target=/bundle,readonly`, '--entrypoint', 'node',
    nextRuntime.services.homecore.image, '/bundle/setup/cli.mjs', 'diagnose'], true);
  assert.match(diagnosticOutput, /Public HTTPS is not enabled/);
  assert.deepEqual(fs.readFileSync(path.join(upgradedRoot, 'configuration/installation.json')), stateBeforeDiagnostics);
  upgradedCompose(['stop', 'backup']);
  upgradedCompose(['run', '--rm', 'backup', '--once']);
  const exportDestination = fs.mkdtempSync(path.join(os.tmpdir(), 'home-backup-export-smoke-'));
  const exportContainer = ['run', '--rm', '--network', 'none', '--cap-drop', 'ALL',
    '--cap-add', 'DAC_OVERRIDE', '--security-opt', 'no-new-privileges'];
  const exportOutput = docker([...exportContainer, '--cap-add', 'CHOWN',
    '--mount', `type=bind,source=${upgradedRoot}/backups,target=/backups,readonly`,
    '--mount', `type=bind,source=${exportDestination},target=/destination`,
    '--entrypoint', 'python3', nextRuntime.services.backup.image, '/export.py', '/backups', '/destination'], true);
  assert.match(exportOutput, /Verified export:/);
  const exported = fs.readdirSync(exportDestination);
  assert.equal(exported.length, 1);
  assert.equal(fs.statSync(path.join(exportDestination, exported[0])).uid, process.getuid());
  for (const entry of fs.readdirSync(path.join(exportDestination, exported[0]))) {
    assert.equal(fs.statSync(path.join(exportDestination, exported[0], entry)).uid, process.getuid());
  }
  const verifiedExport = docker([...exportContainer,
    '--mount', `type=bind,source=${path.join(exportDestination, exported[0])},target=/export,readonly`,
    '--entrypoint', 'python3', nextRuntime.services.backup.image, '/export.py', '--verify', '/export'], true);
  assert.match(verifiedExport, /backup archives: checksums, SQLite integrity and file references/);
  // Exercise the actual host stop/barrier/capture/restart workflow, with backup
  // deliberately stopped beforehand. Never substitute it with direct Python.
  fs.copyFileSync(bundle ? path.join(bundle, 'home.sh') : 'server/home.sh', path.join(upgradedRoot, 'home.sh'));
  fs.writeFileSync(path.join(upgradedRoot, 'installer-image.txt'), nextRuntime.services.homecore.image);
  const snapshotDestination = fs.mkdtempSync(path.join(os.tmpdir(), 'home-coordinated-smoke-'));
  const snapshot = spawnSync('sh', [path.join(upgradedRoot, 'home.sh'), 'snapshot', snapshotDestination],
    { encoding: 'utf8', timeout: 300_000 });
  assert.equal(snapshot.status, 0, snapshot.stdout + snapshot.stderr);
  assert.match(snapshot.stdout, /Verified coordinated snapshot:/);
  assert.ok(!fs.existsSync(path.join(upgradedRoot, 'configuration/snapshot-state.json')));
  assert.equal(docker(['compose', '-f', path.join(upgradedRoot, 'compose.json'), 'ps', '-q', 'backup'], true), '');
  const sets = fs.readdirSync(snapshotDestination);
  assert.equal(sets.length, 1);
  assert.ok(sets[0].startsWith('home-snapshot-'));
  const restoredSet = docker([...exportContainer,
    '--mount', `type=bind,source=${path.join(snapshotDestination, sets[0])},target=/set,readonly`,
    '--mount', `type=bind,source=${path.resolve('services/backup/test/restore_coordinated.py')},target=/proof.py,readonly`,
    '--entrypoint', 'python3', nextRuntime.services.backup.image, '/proof.py', '/set', String(file.id), String(retainedNote.note.id)], true);
  assert.match(restoredSet, /matching Core owner, Notes content and exact Cloud bytes/);
  const afterSnapshotNote = await (await request(`/api/homenotes/notes/${retainedNote.note.id}`, undefined, token)).json();
  assert.equal(afterSnapshotNote.note.content, 'retained app data');
  assert.equal((await request('/api/auth/login', account)).status, 200);
  assert.equal(await (await request(`/api/homecloud/files/${file.id}/download`, undefined, token)).text(), 'installer persistence proof');
  const nextForm = new FormData();
  nextForm.append('file', new Blob(['post-upgrade bytes']), 'after-upgrade.txt');
  const afterUpload = await fetch(origin + '/api/homecloud/files/upload', {
    method: 'POST', headers: { Connection: 'close', Authorization: 'Bearer ' + token }, body: nextForm
  });
  assert.equal(afterUpload.status, 201);
  await afterUpload.arrayBuffer();
  assert.match(transfer(), /already complete/);
  const nextFiles = (await (await request('/api/homecloud/files', undefined, token)).json()).files;
  assert.ok(nextFiles.some(item => item.name === 'after-upgrade.txt'), 'Retry must not overwrite post-upgrade data');
  assert.deepEqual(fs.readFileSync(path.join(root, 'data/homecore_data/homecore.db')), oldDatabase, 'Recovery source is untouched');
  console.log('Runtime installation and upgrade: protected claim, unchanged credentials/session, exact-byte file transfer, post-upgrade write and retry verified.');
} catch (error) {
  compose(['logs', '--tail', '50']);
  throw error;
} finally {
  if (upgradedRoot && fs.existsSync(path.join(upgradedRoot, 'compose.json'))) {
    docker(['compose', '-f', path.join(upgradedRoot, 'compose.json'), 'down']);
  }
  compose(['down']);
}
if (bundle) await sourceImportSmoke(path.resolve(bundle));
