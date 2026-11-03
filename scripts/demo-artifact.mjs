import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyMetadata(value, expected) {
  if (value?.schema !== 1) throw new Error('Unsupported demo artifact metadata');
  for (const field of ['tree', 'head', 'run', 'attempt', 'base']) {
    if (typeof value[field] !== 'string' || value[field] !== expected[field]) throw new Error('Demo artifact source mismatch: ' + field);
  }
  if (!/^[a-f0-9]{40}$/.test(value.tree) || !/^[a-f0-9]{40}$/.test(value.head)) throw new Error('Invalid source SHA');
}
export async function verifySite(directory) {
  if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink()) throw new Error('Invalid site directory');
  for (const item of await readdir(directory)) {
    const file = path.join(directory, item), info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile() && !info.isDirectory()) throw new Error('Artifact contains links or special files');
    if (item === '.env' || item === '.git') throw new Error('Artifact contains non-site data');
    if (info.isDirectory()) await verifySite(file);
  }
}
async function main() {
  const directory = 'demo-artifact';
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
  if (process.argv[2] === 'package') {
    await mkdir(directory, { recursive: true });
    await cp('demo-dist', path.join(directory, 'site'), { recursive: true });
    await writeFile(path.join(directory, 'build.json'), JSON.stringify({ schema: 1, tree, head: process.env.SOURCE_SHA, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, base: process.env.DEMO_BASE || '/home/' }));
  } else if (process.argv[2] === 'verify') {
    const metadata = JSON.parse(await readFile(path.join(directory, 'build.json'), 'utf8'));
    verifyMetadata(metadata, { tree, head: process.env.SOURCE_SHA, run: process.env.SOURCE_RUN, attempt: process.env.SOURCE_ATTEMPT, base: '/' + process.env.REPOSITORY_NAME + '/' });
    await verifySite(path.join(directory, 'site'));
    await readFile(path.join(directory, 'site', 'index.html'));
    console.log('Verified: deploying the same site bytes tested against this merged source tree.');
  } else throw new Error('Expected package or verify');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
