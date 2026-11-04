import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const python = process.platform === 'win32' ? 'python' : 'python3';

test('runtime archives contain launchers and refuse installation data or credentials', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-package-'));
  try {
    const source = path.join(root, 'home-server');
    fs.mkdirSync(path.join(source, 'setup'), { recursive: true });
    fs.mkdirSync(path.join(source, 'configuration'));
    fs.writeFileSync(path.join(source, 'configuration/Caddyfile'), 'example.org {}');
    for (const file of ['home.sh', 'home.ps1', 'home.cmd', 'START-HERE.md', 'LICENSE', 'compose-template.json', 'bundle.json', 'installer-image.txt', 'images.tar']) fs.writeFileSync(path.join(source, file), 'fixture');
    const archive = (name) => spawnSync(python, ['server/package.py', source, path.join(root, name)], { encoding: 'utf8' });
    for (const format of ['zip', 'tar.gz']) {
      const result = archive('runtime.' + format);
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      const listed = spawnSync(python, ['-c', format === 'zip' ?
        'import zipfile,sys; print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))' :
        'import tarfile,sys; print("\\n".join(tarfile.open(sys.argv[1]).getnames()))', path.join(root, 'runtime.' + format)], { encoding: 'utf8' });
      assert.equal(listed.status, 0, listed.stderr);
      assert.match(listed.stdout.replaceAll('\\', '/'), /home-server\/home.sh/);
      assert.doesNotMatch(listed.stdout, /core\.env|\/data\//);
    }
    fs.writeFileSync(path.join(source, 'configuration/core.env'), 'must-not-ship');
    assert.notEqual(archive('credentials.zip').status, 0);
    fs.unlinkSync(path.join(source, 'configuration/core.env'));
    fs.mkdirSync(path.join(source, 'data'));
    assert.notEqual(archive('data.zip').status, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
