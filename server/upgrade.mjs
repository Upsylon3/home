import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readState, writePrivate, configure } from './setup.mjs';
import { runtimeCompose } from './runtime.mjs';

const journalName = 'upgrade-state.json';
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function digest(file) {
  const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
  const fd = fs.openSync(file, 'r');
  try { let length; while ((length = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, length)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function record(snapshot, file, kind, content = '') {
  snapshot.hash.update(JSON.stringify([path.relative(snapshot.root, file).split(path.sep).join('/'), kind, content]) + '\n');
}
function sourceDigest(root) {
  const snapshot = { root, hash: crypto.createHash('sha256') };
  function visit(file) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('Source changed during upgrade.');
    if (stat.isDirectory()) {
      record(snapshot, file, 'directory');
      for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name));
    } else if (stat.isFile()) record(snapshot, file, 'file', digest(file));
    else throw new Error('Source changed during upgrade.');
  }
  for (const name of ['configuration', 'data', 'backups']) visit(path.join(root, name));
  return snapshot.hash.digest('hex');
}
function keepOwner(file, stat) {
  if (process.platform === 'win32') return;
  const actual = fs.statSync(file);
  if (actual.uid !== stat.uid || actual.gid !== stat.gid) fs.chownSync(file, stat.uid, stat.gid);
}

function version(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error('Upgrade requires stable release versions.');
  return value.split('.').map(Number);
}
function compare(a, b) {
  const first = version(a), second = version(b);
  for (let i = 0; i < 3; i++) if (first[i] !== second[i]) return Math.sign(first[i] - second[i]);
  return 0;
}
function plainTree(file) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
    throw new Error('Upgrade refuses symbolic links and special files.');
  }
  if (stat.isDirectory()) for (const entry of fs.readdirSync(file)) plainTree(path.join(file, entry));
}
function manifest(root) {
  const result = readJson(path.join(root, 'bundle.json'));
  if (result.schema !== 1 || !['x64', 'arm64'].includes(result.arch)) throw new Error('Unrecognized runtime bundle.');
  version(result.version);
  return result;
}

// Read-only preflight. The host launcher must stop and verify the source project
// before copying; this module has no Docker socket and cannot prove it is offline.
export function planUpgrade(source, target) {
  source = fs.realpathSync(source);
  target = fs.realpathSync(target);
  for (const [parent, child] of [[source, target], [target, source]]) {
    const relative = path.relative(parent, child);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
      throw new Error('Extract the new bundle into a separate, non-nested folder.');
    }
  }
  for (const root of [source, target]) {
    for (const name of ['bundle.json', 'compose-template.json']) plainTree(path.join(root, name));
    if (root === source || fs.existsSync(path.join(root, 'configuration'))) plainTree(path.join(root, 'configuration'));
  }
  const previous = manifest(source), next = manifest(target);
  if (previous.arch !== next.arch) throw new Error('Use a bundle for the same processor architecture.');
  const minimum = next.upgrade?.minimumSourceVersion;
  if (next.upgrade?.schema !== 1 || !minimum || compare(previous.version, minimum) < 0 || compare(previous.version, next.version) > 0) {
    throw new Error('This release does not support upgrading that bundle; downgrades are refused.');
  }
  const state = readState(source);
  if (process.platform !== 'win32' && fs.statSync(path.join(source, 'configuration/installation.json')).uid !== fs.statSync(target).uid) {
    throw new Error('Extract the new bundle using the same OS account that owns the old installation configuration.');
  }
  const expected = runtimeCompose(readJson(path.join(source, 'compose-template.json')), previous.version, state.access);
  expected.name = 'home-server-' + state.installationId;
  plainTree(path.join(source, 'compose.json'));
  if (!isDeepStrictEqual(readJson(path.join(source, 'compose.json')), expected)) {
    throw new Error('Customized Compose installations need a separate migration; source configuration was not changed.');
  }
  for (const name of ['core.env', 'Caddyfile']) {
    if (!fs.statSync(path.join(source, 'configuration', name)).isFile()) throw new Error('Source configuration is incomplete.');
  }
  const credentials = fs.readFileSync(path.join(source, 'configuration/core.env'), 'utf8');
  if (!/^JWT_SECRET=\S+\r?$/m.test(credentials) || !/^HOMECORE_INTERNAL_SECRET=\S+\r?$/m.test(credentials)) {
    throw new Error('Source credentials are incomplete.');
  }
  const nextTemplate = readJson(path.join(target, 'compose-template.json'));
  const sourceVolumes = Object.keys(readJson(path.join(source, 'compose-template.json')).volumes || {});
  const nextVolumes = Object.keys(nextTemplate.volumes || {});
  if (sourceVolumes.some(name => !nextVolumes.includes(name))) throw new Error('The new release removes storage; a dedicated migration is required.');
  for (const name of [...sourceVolumes, ...nextVolumes]) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid storage name.');
  }
  for (const name of ['data', 'backups']) {
    plainTree(path.join(source, name));
    if (!fs.statSync(path.join(source, name)).isDirectory()) throw new Error('Source storage is incomplete.');
  }
  if (sourceVolumes.some(name => !fs.existsSync(path.join(source, 'data', name))) ||
      !fs.statSync(path.join(source, 'data/homecore_data/homecore.db')).isFile()) {
    throw new Error('Source installation has no complete Core database/storage.');
  }
  // Validate access/template changes before touching any destination state.
  runtimeCompose(nextTemplate, next.version, state.access);
  const identity = { schema: 1, installationId: state.installationId, sourceVersion: previous.version,
    targetVersion: next.version, credentialsHash: digest(path.join(source, 'configuration/core.env')) };
  const journalFile = path.join(target, journalName);
  if (fs.existsSync(journalFile)) {
    plainTree(journalFile);
    const journal = readJson(journalFile);
    if (!Object.entries(identity).every(([key, value]) => journal[key] === value) ||
        !/^\.upgrade-[a-f0-9]{24}$/.test(journal.stage) || !['copying', 'committing', 'complete'].includes(journal.status) ||
        (journal.status !== 'copying' && !/^[a-f0-9]{64}$/.test(journal.sourceDigest))) {
      throw new Error('This destination belongs to another or unrecognized upgrade.');
    }
    if (journal.status === 'complete' && readState(target).installationId !== state.installationId) {
      throw new Error('Completed upgrade identity does not match.');
    }
    return { source, target, state, identity, journal, volumes: nextVolumes, project: expected.name };
  }
  if (fs.readdirSync(path.join(target, 'configuration')).some(name => name !== 'Caddyfile') ||
      ['data', 'backups', 'compose.json'].some(name => fs.existsSync(path.join(target, name)))) {
    throw new Error('Upgrade needs a fresh destination bundle; existing data will not be overwritten.');
  }
  return { source, target, state, identity, volumes: nextVolumes, project: expected.name };
}

function copyVerified(source, target, snapshot) {
  const stat = fs.lstatSync(source);
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    fs.mkdirSync(target, { recursive: true, mode: stat.mode & 0o777 });
    record(snapshot, source, 'directory');
    for (const name of fs.readdirSync(source).sort()) copyVerified(path.join(source, name), path.join(target, name), snapshot);
    keepOwner(target, stat);
  } else if (stat.isFile() && !stat.isSymbolicLink()) {
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, stat.mode & 0o777);
    keepOwner(target, stat);
    const checksum = digest(source);
    if (checksum !== digest(target)) throw new Error('Upgrade copy verification failed; original data is intact.');
    record(snapshot, source, 'file', checksum);
  } else throw new Error('Source storage changed or contains a symbolic link/special file.');
}

export function upgradeBundle(source, target, { confirmStopped = false } = {}) {
  if (!confirmStopped) throw new Error('Stop all source writers before upgrade. Use the host launcher.');
  const plan = planUpgrade(source, target);
  if (plan.journal?.status === 'complete') return false; // Never replay an old copy over new writes.
  const journalFile = path.join(plan.target, journalName);
  const owner = fs.statSync(plan.target);
  const checkpoint = journal => {
    writePrivate(journalFile, JSON.stringify(journal) + '\n');
    keepOwner(journalFile, owner);
  };
  let journal = plan.journal;
  if (!journal) {
    journal = { ...plan.identity, stage: '.upgrade-' + crypto.randomBytes(12).toString('hex'), status: 'copying' };
    fs.writeFileSync(journalFile, JSON.stringify(journal) + '\n', { flag: 'wx', mode: 0o600 });
    keepOwner(journalFile, owner);
  }
  const stage = path.join(plan.target, journal.stage);
  if (journal.status === 'committing' && sourceDigest(plan.source) !== journal.sourceDigest) {
    throw new Error('The original changed after copying. Preserve both folders and use a fresh destination bundle to transfer its latest data.');
  }
  if (journal.status === 'copying') {
    if (fs.existsSync(stage)) {
      plainTree(stage);
      fs.rmSync(stage, { recursive: true }); // Only this journal's private, validated staging directory.
    }
    fs.mkdirSync(stage, { mode: 0o700 });
    const snapshot = { root: plan.source, hash: crypto.createHash('sha256') };
    for (const name of ['configuration', 'data', 'backups']) copyVerified(path.join(plan.source, name), path.join(stage, name), snapshot);
    journal.sourceDigest = snapshot.hash.digest('hex');
    for (const name of plan.volumes) fs.mkdirSync(path.join(stage, 'data', name), { recursive: true, mode: 0o700 });
    journal.status = 'committing';
    checkpoint(journal);
  }
  // Each rename is restartable; initialize refuses to start until the journal is complete.
  plainTree(stage);
  for (const name of ['configuration', 'data', 'backups']) {
    const staged = path.join(stage, name), destination = path.join(plan.target, name);
    if (!fs.existsSync(staged)) continue;
    if (name === 'configuration' && fs.existsSync(destination)) {
      plainTree(destination);
      const entries = fs.readdirSync(destination);
      if (entries.some(entry => entry !== 'Caddyfile')) throw new Error('Destination configuration changed during upgrade.');
      if (entries.includes('Caddyfile')) fs.unlinkSync(path.join(destination, 'Caddyfile'));
      fs.rmdirSync(destination);
    }
    if (fs.existsSync(destination)) throw new Error('Destination storage changed during upgrade.');
    fs.renameSync(staged, destination);
  }
  if (readState(plan.target).installationId !== plan.state.installationId ||
      digest(path.join(plan.target, 'configuration/core.env')) !== plan.identity.credentialsHash) {
    throw new Error('Transferred configuration failed verification. Keep both installations offline.');
  }
  configure(plan.target, plan.state.access);
  keepOwner(path.join(plan.target, 'compose.json'), owner);
  keepOwner(path.join(plan.target, 'configuration/installation.json'), fs.statSync(path.join(plan.source, 'configuration/installation.json')));
  journal.status = 'complete';
  checkpoint(journal);
  fs.rmdirSync(stage);
  return true;
}
