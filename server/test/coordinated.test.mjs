import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initialize, configure, issueCode } from '../setup.mjs';
import { beginSnapshot, originalIds, checkSnapshotBarrier, resumeSnapshot, finishSnapshot, snapshotMarker, hostPath, parseInventory } from '../coordinated.mjs';

const names = ['homecore', 'homecloud-backend', 'homemedia', 'homenotes', 'homesync', 'hometasks', 'homemonitor', 'homevault'];
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-coordinated-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const template = { services: { gateway: { image: 'fixture' }, tls: { image: 'fixture', environment: {}, profiles: ['public'] }, backup: { build: {}, volumes: [] } }, volumes: {} };
  for (const name of names) {
    template.volumes[name + '_data'] = {};
    template.services[name] = { build: {}, environment: {}, volumes: [{ type: 'volume', source: name + '_data', target: '/data' }] };
    template.services.backup.volumes.push({ type: 'volume', source: name + '_data', target: '/sources/' + name, read_only: true });
  }
  fs.writeFileSync(path.join(root, 'compose-template.json'), JSON.stringify(template));
  fs.writeFileSync(path.join(root, 'bundle.json'), JSON.stringify({ version: '1.7.0' }));
  initialize(root);
  const compose = JSON.parse(fs.readFileSync(path.join(root, 'compose.json')));
  const host = '/private/home-instance';
  const rows = Object.entries(compose.services).map(([service, spec], index) => ({
    id: (index + 1).toString(16).padStart(64, '0'), image: 'sha256:' + 'a'.repeat(64),
    running: service !== 'backup', paused: false, restarting: false, health: 'healthy',
    project: compose.name, service, config: host + '/compose.json',
    mounts: (spec.volumes || []).map(mount => ({ Type: 'bind', Source: host + '/' + mount.source.replace(/^\.\//, ''), Destination: mount.target, RW: !mount.read_only }))
  }));
  return { root, host, rows };
}
test('barrier and recovery preserve exactly the original running services and readiness', t => {
  const { root, host, rows } = fixture(t);
  beginSnapshot(root, host, rows);
  assert.throws(() => beginSnapshot(root, host, rows), /EEXIST/);
  assert.equal(originalIds(root, rows).length, rows.length - 1);
  assert.throws(() => checkSnapshotBarrier(root, rows), /writer/);
  rows.forEach(row => { row.running = false; });
  assert.match(checkSnapshotBarrier(root, rows), /^\d{4}-/);
  const ids = resumeSnapshot(root, rows);
  assert.ok(!ids.includes(rows.find(row => row.service === 'backup').id));
  assert.throws(() => finishSnapshot(root, rows), error => error.exitCode === 2);
  assert.ok(fs.existsSync(snapshotMarker(root)));
  rows.forEach(row => { row.running = ids.includes(row.id); });
  finishSnapshot(root, rows);
  assert.ok(!fs.existsSync(snapshotMarker(root)));
});
test('foreign writers, changed mounts and Compose overrides fail before a marker is created', t => {
  const { root, host, rows } = fixture(t);
  const foreign = { ...rows[0], id: 'f'.repeat(64), project: 'foreign', mounts: [{ RW: true, Source: host + '/data' }] };
  assert.throws(() => beginSnapshot(root, host, [...rows, foreign]), /writer/);
  const changed = structuredClone(rows);
  changed[2].mounts[0].RW = !changed[2].mounts[0].RW;
  assert.throws(() => beginSnapshot(root, host, changed), /storage/);
  changed[2] = { ...rows[2], config: '/another/compose.json' };
  assert.throws(() => beginSnapshot(root, host, changed), /another folder/);
  assert.ok(!fs.existsSync(snapshotMarker(root)));
});
test('interrupted capture blocks lifecycle changes and refuses unsafe recovery', t => {
  const { root, host, rows } = fixture(t);
  const journal = beginSnapshot(root, host, rows);
  for (const change of [() => initialize(root), () => configure(root, { mode: 'lan' }), () => issueCode(root)]) {
    assert.throws(change, /Snapshot recovery/);
  }
  rows.forEach(row => { row.running = false; });
  const worker = { ...rows[0], id: 'f'.repeat(64), project: null, mounts: [], job: journal.job, running: true };
  assert.throws(() => resumeSnapshot(root, [...rows, worker]), /still running/);
  assert.throws(() => resumeSnapshot(root, rows.slice(1)), /missing or changed/);
  const changed = structuredClone(rows);
  changed[0].image = 'sha256:' + 'b'.repeat(64);
  assert.throws(() => resumeSnapshot(root, changed), /missing or changed/);
  assert.ok(fs.existsSync(snapshotMarker(root)));
});
test('inventory parsing and Docker Desktop paths reject malformed identities without printing input', () => {
  assert.equal(hostPath('/run/desktop/mnt/host/C/Private/Home'), 'c:/private/home');
  assert.equal(hostPath('C:\\Private\\Home'), 'c:/private/home');
  assert.throws(() => parseInventory('private fixture value'), /No metadata values/);
  assert.throws(() => parseInventory(JSON.stringify([{ id: 'short', running: true, mounts: [] }])));
});
