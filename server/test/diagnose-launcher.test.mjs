import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'home-diagnose-launcher-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'installer-image.txt'), 'disposable-test-image');
  return root;
}

function verify(result, calls, scenario, unix = false) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, scenario === 'success' ? 0 : 1, result.stderr);
  assert.ok(!calls.some(args => args.includes('stop') || args.includes('up') || args.includes('load')));
  const run = calls.find(args => args[0] === 'run');
  if (scenario === 'stopped' || scenario === 'inspect-fail') assert.equal(run, undefined);
  else {
    assert.ok(run.includes('--read-only'));
    assert.ok(run.includes('ALL'));
    assert.ok(run.includes('no-new-privileges'));
    assert.ok(run.includes('disposable-home-network'));
    assert.ok(run.some(arg => arg.endsWith('target=/bundle,readonly')));
    assert.equal(run.at(-1), 'diagnose');
    assert.ok(!run.includes('-it'));
    if (unix) assert.equal(run[run.indexOf('--user') + 1], `${process.getuid()}:${process.getgid()}`);
  }
}

test('Windows diagnostics preserve listeners and propagate failures with a read-only mount', t => {
  const root = fixture(t), log = path.join(root, 'calls.jsonl');
  fs.copyFileSync('server/home.ps1', path.join(root, 'home.ps1'));
  const driver = path.join(root, 'driver.ps1');
  fs.writeFileSync(driver, `
function global:docker {
  [IO.File]::AppendAllText($env:HOME_DIAG_LOG, (ConvertTo-Json -Compress -InputObject @($args)) + [Environment]::NewLine)
  $global:LASTEXITCODE = 0
  if ($args -contains 'ps' -and $env:HOME_DIAG_CASE -ne 'stopped') { Write-Output 'core-container' }
  if ($args[0] -eq 'inspect') {
    if ($env:HOME_DIAG_CASE -eq 'inspect-fail') { $global:LASTEXITCODE = 1 } else { Write-Output 'disposable-home-network' }
  }
  if ($args[0] -eq 'run' -and $env:HOME_DIAG_CASE -eq 'probe-fail') { $global:LASTEXITCODE = 1 }
}
& (Join-Path $PSScriptRoot 'home.ps1') diagnose
exit $LASTEXITCODE
`);
  for (const scenario of ['success', 'probe-fail', 'stopped', 'inspect-fail']) {
    fs.writeFileSync(log, '');
    const result = spawnSync(process.env.HOME_TEST_PWSH || 'pwsh', ['-NoProfile', '-File', driver], {
      encoding: 'utf8', timeout: 15_000, env: { ...process.env, HOME_DIAG_LOG: log, HOME_DIAG_CASE: scenario }
    });
    verify(result, fs.readFileSync(log, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse), scenario);
  }
});

test('Unix diagnostics preserve listeners and propagate failures with a read-only mount', { skip: process.platform === 'win32' }, t => {
  const root = fixture(t), log = path.join(root, 'calls.jsonl'), bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.copyFileSync('server/home.sh', path.join(root, 'home.sh'));
  fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env node
const fs = require('node:fs'), args = process.argv.slice(2), scenario = process.env.HOME_DIAG_CASE;
fs.appendFileSync(process.env.HOME_DIAG_LOG, JSON.stringify(args) + '\\n');
if (args.includes('ps') && scenario !== 'stopped') console.log('core-container');
if (args[0] === 'inspect') { if (scenario === 'inspect-fail') process.exit(1); console.log('disposable-home-network'); }
if (args[0] === 'run' && scenario === 'probe-fail') process.exit(1);
`, { mode: 0o755 });
  for (const scenario of ['success', 'probe-fail', 'stopped', 'inspect-fail']) {
    fs.writeFileSync(log, '');
    const result = spawnSync('sh', [path.join(root, 'home.sh'), 'diagnose'], {
      encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, HOME_DIAG_LOG: log, HOME_DIAG_CASE: scenario }
    });
    verify(result, fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse), scenario, true);
  }
});
