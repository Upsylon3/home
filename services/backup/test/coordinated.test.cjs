const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('coordinated sets require every source, reject concurrent writes and restore all eight databases', () => {
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3',
    [path.join(__dirname, 'coordinated_checks.py'), '-v'], { encoding: 'utf8', timeout: 60_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
