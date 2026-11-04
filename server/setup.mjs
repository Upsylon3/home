import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { runtimeCompose } from './runtime.mjs';

export function writePrivate(file, value) {
  const temporary = file + '.tmp-' + crypto.randomBytes(6).toString('hex');
  try {
    fs.writeFileSync(temporary, value, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
    fs.chmodSync(file, 0o600);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function readState(root) {
  const state = JSON.parse(fs.readFileSync(path.join(root, 'configuration', 'installation.json'), 'utf8'));
  if (state.schema !== 1 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(state.installationId) || !state.access) throw new Error('Unrecognized installation state.');
  return state;
}

export function configure(root, access) {
  const state = readState(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'bundle.json'), 'utf8'));
  const template = JSON.parse(fs.readFileSync(path.join(root, 'compose-template.json'), 'utf8'));
  const compose = runtimeCompose(template, manifest.version, access);
  // A second extraction must not replace another installation's containers.
  compose.name = 'home-server-' + state.installationId;
  // Write operational configuration before recording the chosen access mode.
  writePrivate(path.join(root, 'compose.json'), JSON.stringify(compose, null, 2) + '\n');
  writePrivate(path.join(root, 'configuration', 'installation.json'), JSON.stringify({ ...state, access }, null, 2) + '\n');
  return compose;
}

export function initialize(root) {
  const upgradeFile = path.join(root, 'upgrade-state.json');
  if (fs.existsSync(upgradeFile) && JSON.parse(fs.readFileSync(upgradeFile, 'utf8')).status !== 'complete') {
    throw new Error('Upgrade is incomplete. Run the upgrade action again with the same source; do not start either copy.');
  }
  const stateFile = path.join(root, 'configuration', 'installation.json');
  if (fs.existsSync(stateFile)) {
    const state = readState(root);
    // Never rotate account/service credentials or silently change access on repeat runs.
    if (!fs.existsSync(path.join(root, 'configuration', 'core.env'))) throw new Error('Service credentials are missing. Restore configuration/core.env from your protected backup.');
    configure(root, state.access);
    return false;
  }
  for (const file of ['configuration/core.env', 'compose.json']) {
    if (fs.existsSync(path.join(root, file))) throw new Error('Incomplete setup found. Preserve the folder and follow START-HERE.md recovery instructions.');
  }
  const data = path.join(root, 'data');
  if (fs.existsSync(data) && fs.readdirSync(data).length) throw new Error('Existing data found without installation state. Restore configuration; setup will not replace it.');
  const template = JSON.parse(fs.readFileSync(path.join(root, 'compose-template.json'), 'utf8'));
  fs.mkdirSync(path.join(root, 'configuration'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(root, 'backups'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(data, { recursive: true, mode: 0o700 });
  for (const volume of Object.keys(template.volumes || {})) fs.mkdirSync(path.join(data, volume), { mode: 0o700 });
  writePrivate(path.join(root, 'configuration', 'core.env'), [
    `JWT_SECRET=${crypto.randomBytes(32).toString('hex')}`,
    `HOMECORE_INTERNAL_SECRET=${crypto.randomBytes(32).toString('hex')}`,
    'JWT_EXPIRES_IN=7d', 'QUOTA_BYTES=5368709120', ''
  ].join('\n'));
  writePrivate(stateFile, JSON.stringify({ schema: 1, installationId: crypto.randomUUID(), access: { mode: 'local' } }, null, 2));
  configure(root, { mode: 'local' });
  return true;
}

export function issueCode(root, now = Date.now()) {
  readState(root);
  const code = crypto.randomBytes(16).toString('hex');
  writePrivate(path.join(root, 'data', 'homecore_data', 'registration-code.json'), JSON.stringify({
    hash: crypto.createHash('sha256').update(code).digest('hex'), issuedAt: now, expiresAt: now + 900_000
  }));
  return code.match(/.{4}/g).join('-');
}
