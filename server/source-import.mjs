import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { writePrivate, managedCompose, infrastructureEnvironment } from './setup.mjs';
import { upgradeBundle } from './upgrade.mjs';

const planFile = root => path.join(root, 'source-import-plan.json');
const secrets = ['JWT_SECRET', 'HOMECORE_INTERNAL_SECRET'];
export function parseImportJson(text) {
  try { return JSON.parse(text); }
  catch { throw new Error('Invalid source import metadata. No configuration values were printed.'); }
}
const readJson = file => parseImportJson(fs.readFileSync(file, 'utf8'));
function privateWrite(root, file, value) {
  writePrivate(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  if (process.platform !== 'win32') {
    const owner = fs.statSync(root), current = fs.statSync(file);
    if (owner.uid !== current.uid || owner.gid !== current.gid) fs.chownSync(file, owner.uid, owner.gid);
  }
}
function release(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error('Import requires a supported stable source release.');
  return value.split('.').map(Number);
}
function compare(a, b) {
  const first = release(a), second = release(b);
  for (let i = 0; i < 3; i++) if (first[i] !== second[i]) return Math.sign(first[i] - second[i]);
  return 0;
}
function shape(service) {
  const result = structuredClone(service);
  delete result.environment;
  delete result.env_file; // Source config is fully resolved before it reaches the helper.
  if (result.build) delete result.image; // Compose may derive build-image names from the project.
  // Resolved and non-resolved Compose output spell these defaults differently.
  for (const key of ['command', 'entrypoint']) if (result[key] === null) delete result[key];
  for (const mount of result.volumes || []) {
    if (mount.bind?.create_host_path === true) delete mount.bind.create_host_path;
  }
  return result;
}

// Compose config is delivered over stdin, never command arguments or terminal output.
// This only prepares protected metadata. Host launchers prove container/volume
// provenance and stop all writers before mounting the source volumes read-only.
export function prepareSourceImport(root, config, sourceVersion) {
  const bundle = readJson(path.join(root, 'bundle.json'));
  const template = readJson(path.join(root, 'compose-template.json'));
  const minimum = bundle.sourceImport?.minimumSourceVersion;
  if (bundle.sourceImport?.schema !== 1 || !minimum || compare(sourceVersion, minimum) < 0 || compare(sourceVersion, bundle.version) > 0) {
    throw new Error('This bundle cannot import that source release; downgrades are refused.');
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(config.name || '') || !config.services || !config.volumes ||
      !isDeepStrictEqual(Object.keys(config.services).sort(), Object.keys(template.services).sort()) ||
      !isDeepStrictEqual(Object.keys(config.volumes).sort(), Object.keys(template.volumes).sort())) {
    throw new Error('Import supports the complete standard Compose installation, without extra services or storage.');
  }
  // Network endpoints, processes, mounts, privilege and port declarations must
  // match the packaged topology; configurable environment values are retained.
  const network = { ...(config.networks?.default || {}) };
  delete network.name;
  // Compose emits this empty default even when no IPAM was configured.
  if (isDeepStrictEqual(network.ipam, {})) delete network.ipam;
  if (config.networks && (Object.keys(config.networks).some(name => name !== 'default') || Object.keys(network).length)) {
    throw new Error('Custom source networks need a dedicated migration.');
  }
  const services = {}, required = {}, volumes = {};
  const credentials = Object.fromEntries(secrets.map(key => [key, config.services.homecore?.environment?.[key]]));
  if (Object.values(credentials).some(value => typeof value !== 'string' || !/^[A-Za-z0-9_./:+~=-]+$/.test(value))) {
    throw new Error('Source service secrets need plain single-line values without dotenv metacharacters for automatic import. Original credentials were not changed.');
  }
  for (const [name, service] of Object.entries(config.services)) {
    const expected = template.services[name];
    if (!isDeepStrictEqual(shape(service), shape(expected))) {
      throw new Error('Source Compose topology differs from the standard bundle. Custom overrides need a dedicated migration.');
    }
    const environment = { ...(service.environment || {}) };
    for (const [key, value] of Object.entries(environment)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string' || value.includes('\0')) {
        throw new Error('Source environment contains unsupported entries.');
      }
      if (secrets.includes(key)) {
        const fixed = expected.environment?.[key] ?? credentials[key];
        if (!expected.env_file || value !== fixed) throw new Error('Source service credentials do not match the standard configuration.');
        delete environment[key];
      }
      if (infrastructureEnvironment.has(key) && !['HOME_DOMAIN', 'HOME_SETUP_REQUIRED'].includes(key)) {
        const fixed = expected.environment?.[key] ?? (key === 'PORT' ? expected.expose?.[0] : undefined);
        if ((fixed !== undefined && value !== String(fixed)) ||
            (key === 'HOME_SETUP_CODE_FILE' && value !== '/data/registration-code.json')) {
          throw new Error('Source data paths, ports or service addresses differ from the standard installation.');
        }
      }
    }
    if (expected.env_file && environment.DATA_DIR !== '/data') throw new Error('Source service storage is not at the expected path.');
    services[name] = environment;
    const store = (expected.volumes || []).find(mount => mount.type === 'volume' && mount.target === '/data');
    if (expected.build && store) required[name] = store.source;
  }
  for (const [logical, volume] of Object.entries(config.volumes)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(logical) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(volume.name || '') ||
        Object.keys(volume).some(key => !['name', 'driver'].includes(key)) || (volume.driver && volume.driver !== 'local')) {
      throw new Error('External, custom-driver or unrecognized source volumes are not imported automatically.');
    }
    volumes[logical] = volume.name;
  }
  const configDigest = crypto.createHash('sha256').update(JSON.stringify({ config, sourceVersion })).digest('hex');
  if (fs.existsSync(planFile(root))) {
    const plan = readSourceImportPlan(root);
    if (plan.configDigest !== configDigest || plan.targetVersion !== bundle.version) throw new Error('This destination belongs to another or changed source import. Use a fresh bundle folder.');
    return plan;
  }
  if (['compose.json', 'data', 'backups', 'upgrade-state.json'].some(name => fs.existsSync(path.join(root, name))) ||
      fs.readdirSync(path.join(root, 'configuration')).some(name => name !== 'Caddyfile')) {
    throw new Error('Import needs a fresh destination bundle. Existing data will not be overwritten.');
  }
  const plan = { schema: 1, status: 'prepared', installationId: crypto.randomUUID(), project: config.name,
    sourceVersion, targetVersion: bundle.version, configDigest, volumes, required, services, credentials };
  // Exclusive first publication prevents a second import from claiming this destination.
  fs.writeFileSync(planFile(root), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  privateWrite(root, planFile(root), plan);
  return plan;
}

export function readSourceImportPlan(root) {
  const file = planFile(root);
  if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error('Invalid source import plan.');
  const plan = readJson(file);
  if (plan.schema !== 1 || !['prepared', 'complete'].includes(plan.status) ||
      !/^[a-f0-9-]{36}$/.test(plan.installationId) || !/^[a-z0-9][a-z0-9_-]*$/.test(plan.project) ||
      !/^[a-f0-9]{64}$/.test(plan.configDigest) || !plan.volumes || !plan.required ||
      Object.entries(plan.volumes).some(([key, value]) => !/^[a-zA-Z0-9_-]+$/.test(key) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value))) {
    throw new Error('Unrecognized source import plan.');
  }
  return plan;
}

export function validateSourceContainers(root, containers) {
  const plan = readSourceImportPlan(root), found = new Set();
  const template = readJson(path.join(root, 'compose-template.json'));
  if (!Array.isArray(containers)) throw new Error('Could not inspect the source containers.');
  for (const container of containers) {
    const labels = container.Config?.Labels || {}, name = labels['com.docker.compose.service'];
    if (labels['com.docker.compose.project'] !== plan.project || !plan.services || !Object.hasOwn(plan.services, name) || found.has(name)) {
      throw new Error('Source containers belong to an unexpected, scaled or customized deployment.');
    }
    found.add(name);
    const actual = Object.fromEntries((container.Config.Env || []).map(entry => {
      const index = entry.indexOf('='); return [entry.slice(0, index), entry.slice(index + 1)];
    }));
    const expected = { ...plan.services[name] };
    const service = template.services[name];
    if (service.env_file) for (const key of secrets) expected[key] = service.environment?.[key] ?? plan.credentials[key];
    // `compose config` escapes literal dollars for reuse as Compose input;
    // Docker inspect reports the actual single-dollar container values.
    if (Object.entries(expected).some(([key, value]) => actual[key] !== value.replaceAll('$$', () => '$'))) {
      throw new Error('Source configuration differs from its existing containers. Resolve unapplied settings before importing.');
    }
    const logical = plan.required[name];
    if (logical && !(container.Mounts || []).some(mount => mount.Type === 'volume' &&
        mount.Destination === '/data' && mount.Name === plan.volumes[logical])) {
      throw new Error('Source container storage does not match the import plan.');
    }
  }
  if (Object.keys(plan.required).some(name => !found.has(name))) {
    throw new Error('Keep the complete source installation containers present (use stop, not down) for import verification.');
  }
}

export function validateSourceVolume(root, logical, metadata) {
  const plan = readSourceImportPlan(root), volume = Array.isArray(metadata) ? metadata[0] : metadata;
  if (!plan.volumes[logical] || volume?.Name !== plan.volumes[logical] || volume.Driver !== 'local' ||
      volume.Labels?.['com.docker.compose.project'] !== plan.project ||
      volume.Labels?.['com.docker.compose.volume'] !== logical || Object.keys(volume.Options || {}).length) {
    throw new Error('Source volume identity, ownership or driver does not match. No volume was copied.');
  }
}

export function importSource(root, { sourceRoot = '/source', adapter = '/import-source', confirmStopped = false } = {}) {
  if (!confirmStopped) throw new Error('Stop and verify all source writers before importing. Use the host launcher.');
  const plan = readSourceImportPlan(root);
  if (plan.status === 'complete') return false;
  const template = readJson(path.join(root, 'compose-template.json'));
  for (const logical of Object.keys(template.volumes)) {
    const folder = path.join(adapter, 'data', logical);
    if (['caddy_data', 'caddy_config'].includes(logical)) fs.mkdirSync(folder, { recursive: true });
    else {
      const database = path.join(folder, logical === 'homecloud_backend_data' ? 'homecloud.db' : logical.replace(/_data$/, '.db'));
      if (!fs.existsSync(database) || !fs.lstatSync(database).isFile() || fs.lstatSync(database).size === 0) {
        throw new Error('Source application storage is missing or empty. No installation was started.');
      }
    }
  }
  if (!fs.statSync(path.join(adapter, 'backups')).isDirectory() || fs.lstatSync(path.join(sourceRoot, 'gateway/Caddyfile')).isSymbolicLink()) {
    throw new Error('Source backup or gateway configuration is missing or unsupported.');
  }
  const owner = fs.statSync(root);
  const ownDirectory = file => {
    fs.chmodSync(file, 0o700);
    if (process.platform !== 'win32') fs.chownSync(file, owner.uid, owner.gid);
  };
  fs.mkdirSync(path.join(adapter, 'configuration'), { recursive: true, mode: 0o700 });
  ownDirectory(path.join(adapter, 'configuration'));
  const state = { schema: 1, installationId: plan.installationId, access: { mode: 'local' },
    sourceImport: { schema: 1, version: plan.sourceVersion, project: plan.project } };
  privateWrite(root, path.join(adapter, 'configuration/installation.json'), state);
  privateWrite(root, path.join(adapter, 'configuration/source-settings.json'), { schema: 1, services: plan.services });
  privateWrite(root, path.join(adapter, 'configuration/core.env'), secrets.map(key => key + '=' + plan.credentials[key]).join('\n') + '\n');
  privateWrite(root, path.join(adapter, 'configuration/Caddyfile'), fs.readFileSync(path.join(sourceRoot, 'gateway/Caddyfile'), 'utf8'));
  privateWrite(root, path.join(adapter, 'compose-template.json'), template);
  privateWrite(root, path.join(adapter, 'bundle.json'), { schema: 1, version: plan.sourceVersion, arch: readJson(path.join(root, 'bundle.json')).arch });
  privateWrite(root, path.join(adapter, 'compose.json'), managedCompose(adapter, state, template, plan.sourceVersion));
  const copied = upgradeBundle(adapter, root, { confirmStopped: true });
  // Docker-owned volume roots must become manageable by the installer's OS
  // account (e.g. issuing a registration code). Child file owners are retained.
  for (const folder of ['configuration', 'data', 'backups', ...Object.keys(template.volumes).map(name => 'data/' + name)]) ownDirectory(path.join(root, folder));
  const { credentials, services, ...receipt } = plan;
  privateWrite(root, planFile(root), { ...receipt, status: 'complete' });
  return copied;
}
