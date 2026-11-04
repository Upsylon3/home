import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const tag = process.env.RELEASE_TAG;
if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(tag || '') || tag !== 'v' + JSON.parse(fs.readFileSync('package.json')).version) throw new Error('Invalid release tag/version.');
const action = process.argv[2];
const targets = {
  x64: ['linux-x64.tar.gz', 'windows-x64.zip', 'macos-x64.tar.gz'],
  arm64: ['linux-arm64.tar.gz', 'macos-arm64.tar.gz']
};
const expected = arch => [...targets[arch].map(suffix => `home-server-${tag}-${suffix}`), `SHA256SUMS-${arch}.txt`];
function gh(args, allowFailure = false) {
  const result = spawnSync('gh', args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error('GitHub release operation failed.');
  return result;
}
const current = gh(['release', 'view', tag, '--json', 'assets,isDraft'], action === 'prepare');
if (action === 'prepare') {
  if (current.status !== 0) gh(['release', 'create', tag, '--draft', '--verify-tag', '--title', 'HOME ' + tag, '--notes-file', 'release-notes.md']);
} else if (action === 'upload') {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null;
  if (!arch) throw new Error('Unsupported release builder architecture.');
  const release = JSON.parse(current.stdout);
  const existing = new Set(release.assets.map(asset => asset.name));
  for (const name of expected(arch)) {
    const file = path.join('server-dist', name);
    if (!fs.statSync(file).isFile() || fs.statSync(file).size >= 2_000_000_000) throw new Error('Missing or oversized release asset.');
    if (!existing.has(name)) {
      if (!release.isDraft) throw new Error('Refusing to alter an already published release.');
      gh(['release', 'upload', tag, file]);
    }
  }
} else if (action === 'finalize') {
  const release = JSON.parse(current.stdout);
  const existing = new Set(release.assets.map(asset => asset.name));
  for (const name of [...expected('x64'), ...expected('arm64')]) if (!existing.has(name)) throw new Error('Missing release asset: ' + name);
  if (release.isDraft) gh(['release', 'edit', tag, '--draft=false']);
} else throw new Error('Expected prepare, upload or finalize.');
