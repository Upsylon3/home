import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

for (const shell of ['unix', 'powershell', 'legacy']) test(`source import ${shell} launcher verifies ownership and writers before copying`, {
  skip: (shell === 'unix' && process.platform === 'win32') || (shell === 'legacy' && process.platform !== 'win32')
}, t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'home-import-launcher-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const current = path.join(root, 'new bundle'), previous = path.join(root, 'source checkout'), bin = path.join(root, 'bin');
  for (const dir of [current, previous, bin]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(current, 'installer-image.txt'), 'disposable-image');
  fs.copyFileSync('server/home.sh', path.join(current, 'home.sh'));
  fs.copyFileSync('server/home.ps1', path.join(current, 'home.ps1'));
  const log = path.join(root, 'calls.jsonl'), fake = path.join(bin, 'docker');
  // The mock consumes the actual stdin pipeline; its sensitive payload must
  // never appear in argv, launcher output or the command log.
  fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2), scenario = process.env.HOME_IMPORT_CASE;
fs.appendFileSync(process.env.HOME_IMPORT_LOG, JSON.stringify(args) + '\\n');
const sensitive = 'disposable-service-secret-never-in-argv';
if (args[0] === 'compose' && args.includes('config')) {
  const actualDirectory = fs.statSync(process.cwd()), expectedDirectory = fs.statSync(process.env.HOME_IMPORT_PREVIOUS);
  if (actualDirectory.dev !== expectedDirectory.dev || actualDirectory.ino !== expectedDirectory.ino) {
    console.error('Mock Compose ran outside the source directory:', process.cwd(), process.env.HOME_IMPORT_PREVIOUS); process.exit(1);
  }
  console.log(JSON.stringify({ fakeSecret: sensitive, unicode: 'Δ雪🚀' }));
}
if (args[0] === 'ps' && args.includes('-aq')) console.log('source-core');
if (args[0] === 'inspect') {
  if (args.includes('--format')) console.log(process.env.HOME_IMPORT_PREVIOUS + (process.platform === 'win32' ? '\\\\docker-compose.yml' : '/docker-compose.yml'));
  else console.log('[{"source":"container"}]');
}
if (args[0] === 'volume' && args[1] === 'ls' && scenario !== 'missing') console.log('home_homecore_data');
if (args[0] === 'volume' && args[1] === 'inspect') {
  if (args[2] === 'home_caddy_data' || scenario === 'missing') process.exit(1);
  console.log('[{"source":"volume"}]');
}
if (args.includes('import-mounts')) console.log('homecore_data=home_homecore_data\\ncaddy_data=home_caddy_data');
if (args[0] === 'ps' && args.includes('-q')) {
  if (scenario === 'source-running' && args.some(v => v.startsWith('label='))) console.log('source-writer');
  if (scenario === 'external-writer' && args.includes('volume=home_homecore_data')) console.log('other-project-writer');
}
if (args.includes('import-source') && scenario === 'copy-fail') process.exit(1);
if (args.includes('prepare-import') || args.includes('check-import-containers') || args.includes('check-import-volume')) {
  let input = ''; process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => input += chunk).on('end', () => {
    try { JSON.parse(input); } catch { process.exitCode = 1; return; }
    if (args.includes('prepare-import')) {
      if (!input.includes(sensitive) || !input.includes('Δ雪🚀') || scenario === 'invalid') { process.exitCode = 1; return; }
      console.log(scenario === 'complete' ? 'complete' : 'home');
    }
    if (args.includes('check-import-containers') && scenario === 'settings') process.exitCode = 1;
    if (args.includes('check-import-volume') && scenario === 'ownership') process.exitCode = 1;
  });
}
`, { mode: 0o755 });
  // Invoke a native command shim, so PowerShell itself supplies the working
  // directory and pipeline encoding instead of a global mock function's scope.
  if (process.platform === 'win32') fs.writeFileSync(path.join(bin, 'docker.cmd'), '@"%HOME_IMPORT_NODE%" "%HOME_IMPORT_FAKE%" %*\r\n');
  const driver = path.join(root, 'driver.ps1');
  fs.writeFileSync(driver, `
& $env:HOME_IMPORT_SCRIPT import $env:HOME_IMPORT_PREVIOUS
`);
  const scenarios = shell === 'legacy' ? ['success'] : ['success', 'invalid', 'settings', 'ownership', 'missing', 'source-running', 'external-writer', 'copy-fail', 'complete'];
  for (const scenario of scenarios) {
    fs.writeFileSync(log, '');
    const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
      HOME_IMPORT_LOG: log, HOME_IMPORT_CASE: scenario, HOME_IMPORT_PREVIOUS: previous,
      HOME_IMPORT_NODE: process.execPath, HOME_IMPORT_FAKE: fake, HOME_IMPORT_SCRIPT: path.join(current, 'home.ps1') };
    const command = shell === 'unix' ? 'sh' : shell === 'legacy' ? 'powershell.exe' : process.env.HOME_TEST_PWSH || 'pwsh';
    const args = shell === 'unix' ? [path.join(current, 'home.sh'), 'import', previous] : ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', driver];
    const result = spawnSync(command, args, { env, encoding: 'utf8', timeout: 45_000 });
    assert.equal(result.error, undefined);
    const rawLog = fs.readFileSync(log, 'utf8');
    assert.doesNotMatch(rawLog + result.stdout + result.stderr, /disposable-service-secret-never-in-argv/);
    const calls = rawLog.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const index = word => calls.findIndex(values => values.includes(word));
    const stop = index('stop'), copy = index('import-source'), start = index('up');
    if (scenario === 'success') {
      assert.equal(result.status, 0, result.stderr);
      assert.ok(index('prepare-import') < index('check-import-containers'));
      assert.ok(index('check-import-volume') < stop && stop < copy && copy < start);
      assert.ok(calls[copy].includes('type=volume,source=home_homecore_data,target=/import-source/data/homecore_data,readonly,volume-nocopy'));
      assert.ok(!calls[copy].some(value => value.includes('source=home_caddy_data')));
      assert.ok(calls.slice(stop + 1, copy).some(values => values.includes('volume=home_homecore_data')));
    } else if (scenario === 'complete') {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(stop, -1); assert.equal(copy, -1); assert.ok(start >= 0);
    } else {
      assert.notEqual(result.status, 0, scenario);
      assert.equal(start, -1, 'Never start after an import failure');
      if (scenario !== 'copy-fail') assert.equal(copy, -1);
      if (['invalid', 'settings', 'ownership', 'missing'].includes(scenario)) assert.equal(stop, -1);
    }
  }
});
