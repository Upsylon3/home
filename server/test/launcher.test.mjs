import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('Unix launcher stops and verifies writers before copying, with safe failure exits', { skip: process.platform === 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-unix-launcher-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const previous = path.join(root, 'old folder'), current = path.join(root, 'new folder'), bin = path.join(root, 'bin');
  for (const dir of [previous, current, bin]) fs.mkdirSync(dir);
  fs.copyFileSync('server/home.sh', path.join(current, 'home.sh'));
  fs.writeFileSync(path.join(current, 'installer-image.txt'), 'disposable-test-image');
  const log = path.join(root, 'calls.jsonl');
  fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2), scenario = process.env.HOME_LAUNCHER_CASE;
fs.appendFileSync(process.env.HOME_LAUNCHER_LOG, JSON.stringify(args) + '\\n');
if (args.includes('check-upgrade')) {
  if (scenario === 'invalid') process.exit(1);
  console.log(scenario === 'complete' ? 'complete' : 'home-server-11111111-1111-1111-1111-111111111111');
}
if (args[0] === 'ps' && args.includes('-aq')) console.log('source-container');
if (args[0] === 'inspect') console.log(scenario === 'custom' ? 'other-compose.json' : process.env.HOME_LAUNCHER_PREVIOUS + '/compose.json');
if (args[0] === 'ps' && args.includes('-q') && scenario === 'running') console.log('still-running-container');
if (args.includes('upgrade') && scenario === 'copy-fail') process.exit(1);
`, { mode: 0o755 });
  for (const scenario of ['success', 'running', 'copy-fail', 'invalid', 'custom', 'complete']) {
    fs.writeFileSync(log, '');
    const result = spawnSync('sh', [path.join(current, 'home.sh'), 'upgrade', previous], {
      encoding: 'utf8', timeout: 30_000, env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
        HOME_LAUNCHER_LOG: log, HOME_LAUNCHER_CASE: scenario, HOME_LAUNCHER_PREVIOUS: previous }
    });
    assert.equal(result.error, undefined);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    const stop = calls.findIndex(args => args.includes('stop'));
    const check = calls.findIndex(args => args[0] === 'ps' && args.includes('-q'));
    const copy = calls.findIndex(args => args.includes('upgrade'));
    const start = calls.findIndex(args => args.includes('up'));
    if (scenario === 'success') {
      assert.equal(result.status, 0, result.stderr);
      assert.ok(stop >= 0 && check > stop && copy > check && start > copy);
      assert.ok(calls[copy].includes('type=bind,source=' + previous + ',target=/previous,readonly'));
    } else if (scenario === 'complete') {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(stop, -1); assert.equal(copy, -1); assert.ok(start >= 0);
    } else {
      assert.notEqual(result.status, 0, scenario);
      assert.equal(start, -1);
      if (scenario !== 'copy-fail') assert.equal(copy, -1);
      if (scenario === 'invalid' || scenario === 'custom') assert.equal(stop, -1);
    }
  }
});

// No real Docker daemon is contacted: these exercise the actual host launcher's
// stop/copy/start ordering and failure exits. Real storage/API proof is in smoke.mjs.
test('Windows launcher never copies from running writers or starts after a failed copy', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-launcher-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const previous = path.join(root, 'old folder'), current = path.join(root, 'new folder');
  fs.mkdirSync(previous); fs.mkdirSync(current);
  fs.copyFileSync('server/home.ps1', path.join(current, 'home.ps1'));
  fs.writeFileSync(path.join(current, 'installer-image.txt'), 'disposable-test-image');
  const driver = path.join(root, 'driver.ps1'), log = path.join(root, 'calls.jsonl');
  fs.writeFileSync(driver, `
function global:docker {
  [System.IO.File]::AppendAllText($env:HOME_LAUNCHER_LOG, (ConvertTo-Json -Compress -InputObject @($args)) + [Environment]::NewLine)
  $global:LASTEXITCODE = 0
  if ($args -contains 'check-upgrade') {
    if ($env:HOME_LAUNCHER_CASE -eq 'invalid') { $global:LASTEXITCODE = 1; return }
    if ($env:HOME_LAUNCHER_CASE -eq 'complete') { Write-Output 'complete'; return }
    Write-Output 'home-server-11111111-1111-1111-1111-111111111111'
  }
  if ($args[0] -eq 'ps' -and $args -contains '-aq') { Write-Output 'source-container' }
  if ($args[0] -eq 'inspect') { if ($env:HOME_LAUNCHER_CASE -eq 'custom') { Write-Output 'other-compose.json' } else { Write-Output (Join-Path $env:HOME_LAUNCHER_PREVIOUS 'compose.json') } }
  if ($args[0] -eq 'ps' -and $args -contains '-q' -and $env:HOME_LAUNCHER_CASE -eq 'running') { Write-Output 'still-running-container' }
  if ($args -contains 'upgrade' -and $env:HOME_LAUNCHER_CASE -eq 'copy-fail') { $global:LASTEXITCODE = 1 }
}
& $env:HOME_LAUNCHER_SCRIPT upgrade $env:HOME_LAUNCHER_PREVIOUS
`);
  const powershell = process.env.HOME_TEST_PWSH || 'pwsh';
  for (const scenario of ['success', 'running', 'copy-fail', 'invalid', 'custom', 'complete']) {
    fs.writeFileSync(log, '');
    const result = spawnSync(powershell, ['-NoProfile', '-File', driver], {
      encoding: 'utf8', timeout: 30_000, env: { ...process.env, HOME_LAUNCHER_LOG: log, HOME_LAUNCHER_CASE: scenario,
        HOME_LAUNCHER_SCRIPT: path.join(current, 'home.ps1'), HOME_LAUNCHER_PREVIOUS: previous }
    });
    assert.equal(result.error, undefined);
    const calls = fs.readFileSync(log, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const stop = calls.findIndex(args => args.includes('stop'));
    const check = calls.findIndex(args => args[0] === 'ps' && args.includes('-q'));
    const copy = calls.findIndex(args => args.includes('upgrade'));
    const start = calls.findIndex(args => args.includes('up'));
    if (scenario === 'success') {
      assert.equal(result.status, 0, result.stderr);
      assert.ok(stop >= 0 && check > stop && copy > check && start > copy);
      assert.ok(calls[copy].includes('type=bind,source=' + previous + ',target=/previous,readonly'));
    } else if (scenario === 'complete') {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(stop, -1); assert.equal(copy, -1); assert.ok(start >= 0);
    } else {
      assert.notEqual(result.status, 0, scenario);
      assert.equal(start, -1, 'A failed upgrade must not start the destination');
      if (scenario !== 'copy-fail') assert.equal(copy, -1);
      if (scenario === 'invalid' || scenario === 'custom') assert.equal(stop, -1);
    }
  }
});
