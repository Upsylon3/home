import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runtimeCompose } from './runtime.mjs';

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = path.resolve(process.argv[2] || 'server-dist');
if (fs.existsSync(output)) throw new Error('Output already exists. Choose a new, empty build path.');
const version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null;
if (!arch || process.platform !== 'linux') throw new Error('Build release containers on a native Linux x64 or arm64 Docker host.');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repo, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
  return result.stdout;
}
fs.mkdirSync(output, { recursive: true });
const bundle = path.join(output, 'home-server');
fs.mkdirSync(path.join(bundle, 'setup'), { recursive: true });
// Render the canonical topology without reading any operator env files.
const template = JSON.parse(run('docker', ['compose', '--profile', 'bridge', '--profile', 'public', 'config', '--no-env-resolution', '--no-path-resolution', '--no-interpolate', '--format', 'json'], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }));
const runtime = runtimeCompose(template, version);
// Build from the repository's Dockerfiles; distribute only the resulting images.
const build = structuredClone(template);
delete build.volumes;
for (const [name, service] of Object.entries(build.services)) {
  if (service.build) {
    service.image = runtime.services[name].image;
    service.build.context = path.resolve(repo, service.build.context);
  }
  delete service.env_file;
  delete service.volumes;
}
const buildFile = path.join(output, 'build-compose.json');
fs.writeFileSync(buildFile, JSON.stringify(build));
run('docker', ['compose', '-f', buildFile, '--profile', 'bridge', '--profile', 'public', 'build']);
run('docker', ['compose', '-f', buildFile, '--profile', 'public', 'pull', 'tls']);
run('docker', ['image', 'tag', template.services.tls.image, runtime.services.tls.image]);
const images = Object.values(runtime.services).map(service => service.image);
run('docker', ['image', 'save', '-o', path.join(bundle, 'images.tar'), ...images]);
for (const file of ['runtime.mjs', 'setup.mjs', 'upgrade.mjs', 'source-import.mjs', 'cli.mjs']) fs.copyFileSync(path.join(repo, 'server', file), path.join(bundle, 'setup', file));
for (const file of ['home.sh', 'home.ps1', 'home.cmd', 'START-HERE.md']) fs.copyFileSync(path.join(repo, 'server', file), path.join(bundle, file));
fs.chmodSync(path.join(bundle, 'home.sh'), 0o755);
fs.copyFileSync(path.join(repo, 'LICENSE'), path.join(bundle, 'LICENSE'));
fs.mkdirSync(path.join(bundle, 'configuration'));
fs.copyFileSync(path.join(repo, 'gateway', 'Caddyfile'), path.join(bundle, 'configuration', 'Caddyfile'));
fs.writeFileSync(path.join(bundle, 'compose-template.json'), JSON.stringify(template, null, 2));
fs.writeFileSync(path.join(bundle, 'bundle.json'), JSON.stringify({ schema: 1, version, arch, images,
  upgrade: { schema: 1, minimumSourceVersion: '1.7.0' },
  sourceImport: { schema: 1, minimumSourceVersion: '1.7.0' } }, null, 2));
fs.writeFileSync(path.join(bundle, 'installer-image.txt'), runtime.services.homecore.image + '\n');
const targets = arch === 'x64' ? ['linux-x64', 'macos-x64', 'windows-x64'] : ['linux-arm64', 'macos-arm64'];
const sums = [];
for (const target of targets) {
  const filename = `home-server-v${version}-${target}.${target.startsWith('windows') ? 'zip' : 'tar.gz'}`;
  const archive = path.join(output, filename);
  run('python3', [path.join(repo, 'server', 'package.py'), bundle, archive]);
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(archive)) hash.update(chunk);
  sums.push(`${hash.digest('hex')}  ${filename}`);
}
fs.writeFileSync(path.join(output, `SHA256SUMS-${arch}.txt`), sums.join('\n') + '\n');
console.log('Server downloads built in ' + output);
