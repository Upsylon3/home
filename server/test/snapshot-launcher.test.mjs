import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const id = '1'.repeat(64), image = 'a'.repeat(64);
const names = ['homecore', 'homecloud-backend', 'homemedia', 'homenotes', 'homesync', 'hometasks', 'homemonitor', 'homevault'];
function fixture(t, launcher) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'home-snapshot-launcher-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installation = path.join(root, 'installation'), destination = path.join(root, 'mounted target');
  fs.mkdirSync(installation); fs.mkdirSync(destination); fs.mkdirSync(path.join(installation, 'configuration'));
  fs.copyFileSync('server/' + launcher, path.join(installation, launcher));
  fs.writeFileSync(path.join(installation, 'installer-image.txt'), image);
  const engine = path.join(root, 'engine.cjs'), log = path.join(root, 'calls.jsonl');
  const engineCode = [
    "const fs = require('node:fs'), path = require('node:path'), args = process.argv.slice(2), scenario = process.env.HOME_SNAPSHOT_CASE;",
    "fs.appendFileSync(process.env.HOME_SNAPSHOT_LOG, JSON.stringify(args) + '\\n');",
    "const marker = path.join(process.env.HOME_SNAPSHOT_INSTALL, 'configuration/snapshot-state.json');",
    "if (args.includes('images')) console.log('" + image + "');",
    "if (args[0] === 'ps') console.log('" + id + "');",
    "if (args[0] === 'inspect') console.log('[]');",
    "const action = args.find(arg => arg.startsWith('snapshot-'));",
    "if (action === 'snapshot-begin') { if (scenario === 'preflight') process.exit(1); fs.writeFileSync(marker, '{}'); }",
    "if (action === 'snapshot-originals' || action === 'snapshot-resume') console.log('" + id + "');",
    "if (action === 'snapshot-check') { if (scenario === 'barrier') process.exit(1); console.log('2026-11-05T00:00:00.000Z'); }",
    "if (action === 'snapshot-job') console.log('a'.repeat(32));",
    "if (action === 'snapshot-mounts') console.log(" + JSON.stringify(names.map(name => name + '_data=' + name).join('\n')) + ");",
    "if (action === 'snapshot-resume' && scenario === 'resume') process.exit(1);",
    "if (action === 'snapshot-finish') fs.unlinkSync(marker);",
    "if (args[0] === 'stop' && scenario === 'stop') process.exit(1);",
    "if (args.includes('/coordinated.py') && scenario === 'capture') process.exit(1);"
  ];
  fs.writeFileSync(engine, engineCode.join('\n'));
  return { root, installation, destination, engine, log };
}
function verify(f, run) {
  for (const scenario of ['success', 'preflight', 'stop', 'barrier', 'capture', 'resume']) {
    fs.writeFileSync(f.log, '');
    const result = run('snapshot', scenario);
    assert.ifError(result.error);
    assert.equal(result.status, scenario === 'success' ? 0 : 1, result.stdout + result.stderr);
    const calls = fs.readFileSync(f.log, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    const stop = calls.findIndex(args => args[0] === 'stop');
    const start = calls.find(args => args[0] === 'start');
    const capture = calls.findIndex(args => args.includes('/coordinated.py'));
    if (scenario === 'preflight') { assert.equal(stop, -1); assert.equal(start, undefined); continue; }
    assert.deepEqual(calls[stop].slice(-1), [id]);
    if (scenario !== 'resume') assert.deepEqual(start, ['start', id]);
    else assert.equal(start, undefined);
    if (['stop', 'barrier'].includes(scenario)) assert.equal(capture, -1);
    else {
      assert.ok(capture > stop);
      const args = calls[capture];
      assert.equal(args[args.indexOf('--network') + 1], 'none');
      assert.equal(args.filter(arg => arg.includes('target=/sources/') && arg.endsWith(',readonly')).length, 8);
      assert.ok(args.includes('--confirm-offline'));
      assert.ok(!args.some(arg => arg.includes('docker.sock') || arg.includes('core.env')));
    }
    if (scenario === 'resume') {
      assert.ok(fs.existsSync(path.join(f.installation, 'configuration/snapshot-state.json')));
      assert.equal(run('start', 'success').status, 1);
      assert.equal(run('recover-snapshot', 'success').status, 0);
    }
    assert.ok(!fs.existsSync(path.join(f.installation, 'configuration/snapshot-state.json')));
  }
}
test('PowerShell snapshot launcher resumes only original IDs on success and capture/stop/barrier failure', t => {
  const f = fixture(t, 'home.ps1'), driver = path.join(f.root, 'driver.ps1');
  fs.writeFileSync(driver, [
    'function global:docker { & $env:HOME_SNAPSHOT_NODE $env:HOME_SNAPSHOT_ENGINE @args }',
    "& $env:HOME_SNAPSHOT_LAUNCHER $env:HOME_SNAPSHOT_ACTION $(if ($env:HOME_SNAPSHOT_ACTION -eq 'snapshot') { $env:HOME_SNAPSHOT_DESTINATION })",
    'exit $LASTEXITCODE'
  ].join('\n'));
  verify(f, (action, scenario) => spawnSync(process.env.HOME_TEST_PWSH || 'pwsh', ['-NoProfile', '-File', driver], {
    encoding: 'utf8', timeout: 20_000, env: { ...process.env, HOME_SNAPSHOT_NODE: process.execPath,
      HOME_SNAPSHOT_ENGINE: f.engine, HOME_SNAPSHOT_LOG: f.log, HOME_SNAPSHOT_CASE: scenario,
      HOME_SNAPSHOT_INSTALL: f.installation, HOME_SNAPSHOT_ACTION: action,
      HOME_SNAPSHOT_LAUNCHER: path.join(f.installation, 'home.ps1'), HOME_SNAPSHOT_DESTINATION: f.destination }
  }));
});
test('Unix snapshot launcher resumes only original IDs and retains interrupted recovery state', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t, 'home.sh'), bin = path.join(f.root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\nexec "$HOME_SNAPSHOT_NODE" "$HOME_SNAPSHOT_ENGINE" "$@"\n', { mode: 0o755 });
  verify(f, (action, scenario) => spawnSync('sh', [path.join(f.installation, 'home.sh'), action, ...(action === 'snapshot' ? [f.destination] : [])], {
    encoding: 'utf8', timeout: 20_000, env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
      HOME_SNAPSHOT_NODE: process.execPath, HOME_SNAPSHOT_ENGINE: f.engine, HOME_SNAPSHOT_LOG: f.log,
      HOME_SNAPSHOT_CASE: scenario, HOME_SNAPSHOT_INSTALL: f.installation }
  }));
});
