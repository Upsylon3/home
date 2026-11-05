// Host launchers supply only container identity/state/mount metadata, never Env.
// This helper has no Docker socket and cannot stop or start containers itself.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readState, managedCompose, writePrivate } from './setup.mjs';

export const snapshotMarker = root => path.join(root, 'configuration/snapshot-state.json');
const sourceNames = ['homecore', 'homecloud-backend', 'homemedia', 'homenotes', 'homesync', 'hometasks', 'homemonitor', 'homevault'];
const idPattern = /^[a-f0-9]{64}$/;
const imagePattern = /^(?:sha256:)?[a-f0-9]{64}$/;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function json(file) {
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error();
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { throw new Error('Snapshot metadata is missing or invalid. Existing data was not changed.'); }
}
export function hostPath(value) {
  if (typeof value !== 'string' || !value || /[\0\r\n]/.test(value)) throw new Error('Invalid snapshot host path.');
  let result = value.replaceAll('\\', '/');
  result = result.replace(/^\/(?:run\/desktop\/mnt\/host|host_mnt)\/([a-zA-Z])\//, '$1:/');
  result = path.posix.normalize(result);
  if (result.length > 1) result = result.replace(/\/$/, '');
  return /^[a-zA-Z]:(?:\/|$)/.test(result) ? result.toLowerCase() : result;
}
function overlaps(a, b) { return a === '/' || b === '/' || a === b || a.startsWith(b + '/') || b.startsWith(a + '/'); }
export function parseInventory(value) {
  try {
    if (Buffer.byteLength(value) > 4 * 1024 * 1024) throw new Error();
    const input = value.trim();
    const rows = input.startsWith('[') ? JSON.parse(input) : input.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    if (!Array.isArray(rows) || rows.some(row => !row || !idPattern.test(row.id) || typeof row.running !== 'boolean' ||
      !Array.isArray(row.mounts)) || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error();
    return rows;
  } catch { throw new Error('Could not validate Docker container inventory. No metadata values were printed.'); }
}
function plan(root) {
  const state = readState(root), template = json(path.join(root, 'compose-template.json'));
  const compose = json(path.join(root, 'compose.json')), bundle = json(path.join(root, 'bundle.json'));
  if (!isDeepStrictEqual(compose, managedCompose(root, state, template, bundle.version))) {
    throw new Error('Coordinated snapshots require the standard managed Compose layout without overrides.');
  }
  const sources = (compose.services.backup?.volumes || []).filter(mount => mount.target.startsWith('/sources/'))
    .map(mount => ({ name: mount.target.slice('/sources/'.length), logical: mount.source?.match(/^\.\/data\/([a-zA-Z0-9_-]+)$/)?.[1], readOnly: mount.read_only }));
  if (!isDeepStrictEqual(sources.map(source => source.name).sort(), [...sourceNames].sort()) ||
    sources.some(source => !source.logical || !source.readOnly)) throw new Error('Snapshot requires the complete eight-source backup layout.');
  return { project: compose.name, compose, composeDigest: digest(JSON.stringify(compose)), sources };
}
function validateOwned(layout, hostRoot, rows, restartingOriginals = []) {
  const own = rows.filter(row => row.project === layout.project), services = new Set();
  if (!own.length) throw new Error('Keep the managed installation containers present; use stop rather than down.');
  for (const row of own) {
    const service = layout.compose.services[row.service];
    if (!service || services.has(row.service) || row.paused || (row.restarting && !restartingOriginals.includes(row.id)) || !imagePattern.test(row.image || '') ||
      hostPath(row.config || '') !== hostPath(hostRoot + '/compose.json')) {
      throw new Error('Containers belong to another folder, are scaled, paused, restarting or use Compose overrides.');
    }
    services.add(row.service);
    const mounts = service.volumes || [];
    if (row.mounts.length !== mounts.length || mounts.some(expected => expected.type !== 'bind' ||
      !row.mounts.some(actual => actual.Type === 'bind' && actual.Destination === expected.target &&
        hostPath(actual.Source) === hostPath(hostRoot + '/' + expected.source.replace(/^\.\//, '')) &&
        actual.RW === !expected.read_only))) {
      throw new Error('Managed container storage differs from its current configuration. Snapshot refused.');
    }
  }
  return own;
}
function rejectWriters(layout, hostRoot, rows, allowed = []) {
  const data = hostPath(hostRoot + '/data');
  for (const row of rows.filter(row => row.running && !allowed.includes(row.id))) {
    if (row.project === layout.project || row.mounts.some(mount => mount.RW && mount.Source && overlaps(hostPath(mount.Source), data))) {
      throw new Error('A source writer is still running. Stop it before capture or snapshot recovery.');
    }
  }
}
export function beginSnapshot(root, hostRoot, rows) {
  const layout = plan(root);
  hostRoot = hostPath(hostRoot);
  const own = validateOwned(layout, hostRoot, rows);
  rejectWriters(layout, hostRoot, rows, own.map(row => row.id));
  const journal = { schema: 1, project: layout.project, hostRoot, composeDigest: layout.composeDigest,
    job: crypto.randomBytes(16).toString('hex'), phase: 'prepared',
    originals: own.filter(row => row.running).map(row => ({ id: row.id, service: row.service, image: row.image })) };
  fs.writeFileSync(snapshotMarker(root), JSON.stringify(journal) + '\n', { flag: 'wx', mode: 0o600 });
  return journal;
}
export function readSnapshot(root) {
  const journal = json(snapshotMarker(root)), layout = plan(root);
  if (journal.schema !== 1 || journal.project !== layout.project || journal.composeDigest !== layout.composeDigest ||
    typeof journal.hostRoot !== 'string' || hostPath(journal.hostRoot) !== journal.hostRoot ||
    !/^[a-f0-9]{32}$/.test(journal.job || '') || !['prepared', 'capturing'].includes(journal.phase) ||
    !Array.isArray(journal.originals) || journal.originals.some(row => !idPattern.test(row.id) || !imagePattern.test(row.image) ||
      !Object.hasOwn(layout.compose.services, row.service)) || new Set(journal.originals.map(row => row.id)).size !== journal.originals.length) {
    throw new Error('Snapshot recovery state does not match this installation. Keep the installation offline and preserve the marker.');
  }
  return { journal, layout };
}
function current(root, rows, allowOriginalRestarts = false) {
  const { journal, layout } = readSnapshot(root);
  validateOwned(layout, journal.hostRoot, rows, allowOriginalRestarts ? journal.originals.map(row => row.id) : []);
  for (const original of journal.originals) {
    if (!rows.some(row => row.id === original.id && row.project === journal.project && row.service === original.service && row.image === original.image)) {
      throw new Error('An original snapshot container is missing or changed. Automatic recovery refused.');
    }
  }
  return { journal, layout };
}
export function originalIds(root, rows) {
  return current(root, rows).journal.originals.map(row => row.id);
}
export function checkSnapshotBarrier(root, rows) {
  const { journal, layout } = current(root, rows);
  rejectWriters(layout, journal.hostRoot, rows);
  journal.phase = 'capturing';
  journal.quiescedAt = new Date().toISOString();
  writePrivate(snapshotMarker(root), JSON.stringify(journal) + '\n');
  return journal.quiescedAt;
}
export function resumeSnapshot(root, rows) {
  // Starting the original set can transiently restart dependants while their
  // upstreams boot. Identity/mount checks still apply; readiness waits below.
  const { journal, layout } = current(root, rows, true);
  if (rows.some(row => row.running && row.job === journal.job)) throw new Error('Snapshot capture is still running. Wait for it to exit before recovery.');
  const ids = journal.originals.map(row => row.id);
  rejectWriters(layout, journal.hostRoot, rows, ids);
  return ids;
}
export function finishSnapshot(root, rows) {
  const ids = resumeSnapshot(root, rows);
  if (ids.some(id => !rows.find(row => row.id === id)?.running || rows.find(row => row.id === id)?.restarting ||
    ![null, undefined, 'healthy'].includes(rows.find(row => row.id === id)?.health))) {
    throw Object.assign(new Error('Waiting for the original services to become ready.'), { exitCode: 2 });
  }
  fs.unlinkSync(snapshotMarker(root));
}
export function snapshotMounts(root) {
  return readSnapshot(root).layout.sources.map(source => source.logical + '=' + source.name);
}
