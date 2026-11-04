import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('metadata verification accepts later releases without changing historical reconciliation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-release-metadata-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    for (const name of ['validate-release.mjs', 'reconcile-tags.mjs']) fs.copyFileSync('scripts/' + name, path.join(root, 'scripts', name));
    const write = (version, lockVersion = version, heading = version) => {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }));
      fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: lockVersion, packages: { '': { version: lockVersion } } }));
      fs.writeFileSync(path.join(root, 'CHANGELOG.md'), `# Changelog\n\n## [Unreleased]\n\n## [${heading}]\n\n### Added\n- Example feature.\n`);
    };
    const verify = () => spawnSync(process.execPath, ['scripts/reconcile-tags.mjs', '--verify-only'], { cwd: root, encoding: 'utf8' });
    for (const version of ['1.6.2', '1.7.0', '2.0.0']) {
      write(version);
      const result = verify();
      assert.equal(result.status, 0, result.stderr);
    }
    write('1.7.0', '1.6.2'); assert.notEqual(verify().status, 0);
    write('1.7.0', '1.7.0', '1.6.2'); assert.notEqual(verify().status, 0);
    write('1.7.0');
    const mutation = spawnSync(process.execPath, ['scripts/reconcile-tags.mjs'], { cwd: root, encoding: 'utf8' });
    assert.equal(mutation.status, 0, mutation.stderr);
    assert.match(mutation.stdout, /Skipping one-time reconciliation/);
    assert.equal(fs.existsSync(path.join(root, '.git')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
