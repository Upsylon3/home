import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadPath, selectedFiles, droppedFiles, folderResolver, createUploadQueue } from '../src/uploadQueue.js';
const turn = () => new Promise(setImmediate);
const file = name => ({ name });

test('relative paths retain hierarchy and reject traversal, ambiguous folder names and excessive depth', () => {
  assert.deepEqual(uploadPath('Trip/Day 1/photo.jpg'), ['Trip', 'Day 1', 'photo.jpg']);
  assert.deepEqual(selectedFiles([{ name: 'x.txt', webkitRelativePath: 'Folder/x.txt' }])[0].path, 'Folder/x.txt');
  for (const path of ['/root/x', '../x', 'a/../x', 'a//x', 'a\\b/x', 'a\0b/x', ' a /x', 'x'.repeat(101) + '/a', Array(34).fill('x').join('/')]) {
    assert.throws(() => uploadPath(path), /Unsupported/);
  }
});

test('folder drops drain every directory-reader batch and never flatten nested files', async () => {
  const leaf = name => ({ name, isFile: true, file: resolve => resolve(file(name)) });
  const directory = { name: 'Root', isDirectory: true, createReader() {
    const batches = [[leaf('first.txt')], [{ name: 'Child', isDirectory: true, createReader() {
      const nested = [[leaf('second.txt')], []]; return { readEntries: resolve => resolve(nested.shift()) };
    } }], []];
    return { readEntries: resolve => resolve(batches.shift()) };
  } };
  const files = await droppedFiles({ items: [{ kind: 'file', webkitGetAsEntry: () => directory }] });
  assert.deepEqual(files.map(item => item.path), ['Root/first.txt', 'Root/Child/second.txt']);
  await assert.rejects(droppedFiles({ items: [{ kind: 'file', webkitGetAsEntry: () => directory }] }, 1), /at most/);
});

test('shared folder resolution creates each segment once, reuses owner folders and preserves Unicode case', async () => {
  const created = [];
  let id = 5;
  const api = {
    listAll: async () => ({ data: { folders: [{ id: 4, name: 'root', parentId: null }] } }),
    create: async (name, parentId) => { created.push({ name, parentId }); return { data: { folder: { id: ++id } } }; },
    list: async () => ({ data: { folders: [] } })
  };
  const resolve = folderResolver(api, null);
  const values = await Promise.all([resolve('Root/Sub/a.txt'), resolve('Root/Sub/b.txt')]);
  assert.equal(values[0], values[1]);
  assert.deepEqual(created, [{ name: 'Sub', parentId: 4 }]);
  assert.notEqual(await resolve('Root/É/x.txt'), await resolve('Root/é/y.txt'));
});

test('failed folder listings recover on retry and a changed session cannot create folders', async () => {
  let offline = true, changed = false, creates = 0;
  const resolve = folderResolver({
    listAll: async () => { if (offline) throw new Error('offline'); return { data: { folders: [] } }; },
    create: async () => { creates++; return { data: { folder: { id: 1 } } }; }, list: async () => ({ data: { folders: [] } })
  }, null, () => { if (changed) throw new Error('Session changed'); });
  await assert.rejects(resolve('Folder/file'), /offline/);
  offline = false;
  assert.equal(await resolve('Folder/file'), 1);
  changed = true;
  await assert.rejects(resolve('Other/file'), /Session changed/);
  assert.equal(creates, 1);
});

test('queue bounds concurrency, reports outcomes and retries only failed files', async () => {
  let rows = [], active = 0, peak = 0, idle = 0;
  const finish = new Map(), attempts = new Map();
  const queue = createUploadQueue({ concurrency: 2, onChange: value => { rows = value; }, onIdle: () => idle++,
    run: item => new Promise((resolve, reject) => {
      active++; peak = Math.max(peak, active); attempts.set(item.path, (attempts.get(item.path) || 0) + 1);
      finish.set(item.path, success => { active--; success ? resolve(item.path) : reject(new Error('network failed')); });
    }) });
  queue.add(['a', 'b', 'c'].map(path => ({ file: file(path), path })));
  await turn(); assert.equal(peak, 2); assert.equal(rows.filter(item => item.status === 'queued').length, 1);
  finish.get('a')(true); finish.get('b')(false);
  await turn(); finish.get('c')(true); await turn();
  assert.equal(idle, 1);
  assert.deepEqual(rows.map(row => row.status), ['completed', 'failed', 'completed']);
  queue.retry(rows[1].id); await turn(); finish.get('b')(true); await turn();
  assert.equal(attempts.get('a'), 1); assert.equal(attempts.get('b'), 2); assert.equal(peak, 2);
  queue.clearCompleted(); assert.deepEqual(rows, []); queue.dispose();
});

test('queue cancellation aborts running work, skips queued files and enforces its memory bound', async () => {
  let rows = [], calls = 0;
  const queue = createUploadQueue({ concurrency: 1, limit: 2, onChange: value => { rows = value; },
    run: (item, progress, signal) => new Promise((resolve, reject) => {
      calls++; signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
    }) });
  queue.add(['a', 'b'].map(path => ({ file: file(path), path })));
  await turn(); queue.cancel(rows[1].id); queue.cancel(rows[0].id); await turn();
  assert.equal(calls, 1); assert.deepEqual(rows.map(row => row.status), ['cancelled', 'cancelled']);
  assert.throws(() => queue.add([{ file: file('c'), path: 'c' }]), /at most/); queue.dispose();
});
