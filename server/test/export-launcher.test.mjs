import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const image = 'a'.repeat(64);
function fixture(t, launcher) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'home-export-launcher-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installation = path.join(root, 'installation'), destination = path.join(root, 'mounted target');
  fs.mkdirSync(installation); fs.mkdirSync(destination); fs.mkdirSync(path.join(installation, 'backups'));
  fs.copyFileSync('server/' + launcher, path.join(installation, launcher));
  return { root, installation, destination, log: path.join(root, 'calls.jsonl') };
}
function verify(result, log, action, scenario) {
  assert.ifError(result.error);
  assert.equal(result.status, scenario === 'success' ? 0 : 1, result.stderr);
  const calls = fs.readFileSync(log, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  assert.ok(!calls.some(args => ['stop', 'up', 'load'].some(value => args.includes(value))));
  const run = calls.find(args => args[0] === 'run');
  if (['nested', 'ancestor', 'filesystem-root', 'missing-image'].includes(scenario)) { assert.equal(run, undefined); return; }
  assert.equal(run[run.indexOf('--network') + 1], 'none');
  assert.ok(run.includes('no-new-privileges'));
  assert.ok(!run.some(arg => arg.includes('configuration') || arg.includes('target=/bundle')));
  assert.ok(run.includes(image));
  assert.ok(run.includes('DAC_OVERRIDE'));
  if (action === 'export-backups') {
    assert.ok(run.includes('CHOWN'));
    assert.ok(run.some(arg => arg.endsWith('target=/backups,readonly')));
    assert.ok(run.some(arg => arg.endsWith('target=/destination')));
    assert.deepEqual(run.slice(-3), ['/export.py', '/backups', '/destination']);
  } else {
    assert.ok(!run.includes('CHOWN'));
    assert.ok(run.some(arg => arg.endsWith('target=/export,readonly')));
    assert.deepEqual(run.slice(-3), ['/export.py', '--verify', '/export']);
  }
}

test('PowerShell export actions isolate storage, preserve services and propagate failure', t => {
  const f = fixture(t, 'home.ps1'), driver = path.join(f.root, 'driver.ps1');
  fs.writeFileSync(driver, `
function global:docker {
  [IO.File]::AppendAllText($env:HOME_EXPORT_LOG, (ConvertTo-Json -Compress -InputObject @($args)) + [Environment]::NewLine)
  $global:LASTEXITCODE = 0
  if ($args -contains 'images' -and $env:HOME_EXPORT_CASE -ne 'missing-image') { Write-Output '${image}' }
  if ($args[0] -eq 'run' -and $env:HOME_EXPORT_CASE -eq 'copy-fail') { $global:LASTEXITCODE = 1 }
}
& $env:HOME_EXPORT_LAUNCHER $env:HOME_EXPORT_ACTION $env:HOME_EXPORT_DESTINATION
exit $LASTEXITCODE
`);
  for (const action of ['export-backups', 'verify-backups']) {
    for (const scenario of ['success', 'copy-fail', 'nested', 'ancestor', 'filesystem-root', 'missing-image']) {
      fs.writeFileSync(f.log, '');
      const result = spawnSync(process.env.HOME_TEST_PWSH || 'pwsh', ['-NoProfile', '-File', driver], {
        encoding: 'utf8', timeout: 15_000, env: { ...process.env, HOME_EXPORT_LOG: f.log, HOME_EXPORT_CASE: scenario,
          HOME_EXPORT_ACTION: action, HOME_EXPORT_LAUNCHER: path.join(f.installation, 'home.ps1'),
          HOME_EXPORT_DESTINATION: scenario === 'nested' ? path.join(f.installation, 'backups') :
            scenario === 'ancestor' ? f.root : scenario === 'filesystem-root' ? path.parse(f.installation).root : f.destination }
      });
      verify(result, f.log, action, scenario);
    }
  }
});

test('Unix export actions isolate storage, preserve services and propagate failure', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t, 'home.sh'), bin = path.join(f.root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env node
const fs = require('node:fs'), args = process.argv.slice(2), scenario = process.env.HOME_EXPORT_CASE;
fs.appendFileSync(process.env.HOME_EXPORT_LOG, JSON.stringify(args) + '\\n');
if (args.includes('images') && scenario !== 'missing-image') console.log('${image}');
if (args[0] === 'run' && scenario === 'copy-fail') process.exit(1);
`, { mode: 0o755 });
  for (const action of ['export-backups', 'verify-backups']) {
    for (const scenario of ['success', 'copy-fail', 'nested', 'ancestor', 'filesystem-root', 'missing-image']) {
      fs.writeFileSync(f.log, '');
      const result = spawnSync('sh', [path.join(f.installation, 'home.sh'), action,
        scenario === 'nested' ? path.join(f.installation, 'backups') : scenario === 'ancestor' ? f.root :
          scenario === 'filesystem-root' ? '/' : f.destination], {
        encoding: 'utf8', timeout: 15_000, env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
          HOME_EXPORT_LOG: f.log, HOME_EXPORT_CASE: scenario }
      });
      verify(result, f.log, action, scenario);
    }
  }
});
