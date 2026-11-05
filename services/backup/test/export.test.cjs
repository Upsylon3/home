const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('mounted-storage exports preserve archives and fail closed on corruption and unsafe paths', () => {
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3',
    [path.join(__dirname, 'export_checks.py'), '-v'], { encoding: 'utf8', timeout: 60_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
