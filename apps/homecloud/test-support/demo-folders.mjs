import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function verifyFolderUpload(page, origin) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'home-demo-folders-'));
  try {
    const directory = path.join(fixture, 'Folder proof');
    fs.mkdirSync(path.join(directory, 'child'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'top.txt'), 'top bytes');
    fs.writeFileSync(path.join(directory, 'child', 'nested.txt'), 'nested bytes');
    await page.goto(origin + 'cloud/');
    await page.getByLabel('Choose folder files', { exact: true }).setInputFiles(directory);
    await page.getByRole('region', { name: 'Uploads', exact: true }).getByRole('status').filter({ hasText: '2 completed' }).waitFor();
    const result = await page.evaluate(async base => {
      const headers = { Authorization: 'Bearer browser-demo' };
      const get = async suffix => (await fetch(base + 'demo-api/homecloud/' + suffix, { headers })).json();
      const { folders } = await get('folders/all');
      const top = folders.find(folder => folder.name === 'Folder proof');
      const child = folders.find(folder => folder.name === 'child' && folder.parentId === top.id);
      const files = [...(await get('files?folderId=' + top.id)).files, ...(await get('files?folderId=' + child.id)).files];
      return Promise.all(files.map(async file => [file.name, await (await fetch(base + 'demo-api/homecloud/files/' + file.id + '/download', { headers })).text()]));
    }, new URL(origin).pathname);
    assert.deepEqual(result.sort(), [['nested.txt', 'nested bytes'], ['top.txt', 'top bytes']]);
    await page.reload();
    await page.locator('.folder-open').filter({ hasText: 'Folder proof' }).waitFor();
  } finally {
    const target = path.resolve(fixture);
    assert.ok(target.startsWith(fs.realpathSync(os.tmpdir()) + path.sep) && path.basename(target).startsWith('home-demo-folders-'));
    fs.rmSync(target, { recursive: true, force: true });
  }
}
