import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const mode = process.argv[2];
if (!['test', 'build'].includes(mode)) throw new Error('Expected test or build');
const workspaces = JSON.parse(readFileSync('package.json', 'utf8')).workspaces;
const selected = JSON.parse(process.env.SELECTED_WORKSPACES || JSON.stringify(workspaces));
if (!Array.isArray(selected) || selected.some(w => !workspaces.includes(w) || !/^[a-z0-9/-]+$/.test(w))) throw new Error('Invalid selected workspaces');
if (selected.length) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', mode, '--if-present', ...selected.map(w => '--workspace=' + w)], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
console.log('No affected workspace ' + mode + ' scripts.');
