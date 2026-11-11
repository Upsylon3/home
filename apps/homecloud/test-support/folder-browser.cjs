const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { startTestApp, stopTestApp } = require('../../homecloud-backend/test/helpers/app');
const { makeClient, registerUser } = require('../../../homecore/test/helpers/client');

async function main() {
  let proxy, browser, release, page;
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'home-folder-browser-'));
  try {
    const cloud = await startTestApp();
    const owner = await registerUser(cloud.homecore.baseUrl);
    const client = makeClient(cloud.baseUrl); client.setToken(owner.token);
    const rootFolder = (await client.post('/api/homecloud/folders', { name: 'ALBUM' })).body.folder;
    const directory = path.join(fixture, 'Album');
    fs.mkdirSync(path.join(directory, 'child'), { recursive: true });
    for (const name of ['a.txt', 'retry.txt', 'z.txt', 'child/b.txt']) fs.writeFileSync(path.join(directory, name), `bytes:${name}`);
    const root = path.resolve(__dirname, '../dist');
    const types = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' };
    proxy = http.createServer((req, res) => {
      if (req.url.startsWith('/api/')) {
        const base = req.url.startsWith('/api/homecloud/') ? cloud.baseUrl : cloud.homecore.baseUrl;
        const upstream = http.request(base + req.url, { method: req.method, headers: req.headers }, response => {
          res.writeHead(response.statusCode, response.headers); response.pipe(res);
        });
        upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream); return;
      }
      const pathname = new URL(req.url, 'http://fixture').pathname.replace(/^\/cloud/, '');
      const candidate = path.resolve(root, '.' + pathname);
      const file = candidate.startsWith(root + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(root, 'index.html');
      res.setHeader('Content-Type', types[path.extname(file)] || 'text/html'); fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, channel: process.env.DEMO_BROWSER_CHANNEL || 'chrome' });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addInitScript(token => localStorage.setItem('home_session_token', token), owner.token);
    // CDP may omit file parts from request.postDataBuffer(). Mark only these
    // synthetic fixture uploads from their actual FormData file instead.
    await context.addInitScript(() => {
      const send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function(body) {
        if (body instanceof FormData && body.get('file') instanceof File) this.setRequestHeader('X-Fixture-Filename', body.get('file').name);
        return send.call(this, body);
      };
    });
    page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let held = 0, failed = false, gateOpen = false;
    const gate = new Promise(resolve => { release = () => { gateOpen = true; resolve(); }; });
    let enough; const threeRequests = new Promise(resolve => { enough = resolve; });
    await page.route('**/api/homecloud/files/upload', async route => {
      if (!gateOpen) { if (++held === 3) enough(); await gate; }
      if (!failed && route.request().headers()['x-fixture-filename'] === 'retry.txt') {
        failed = true;
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Injected upload failure"}' });
      } else await route.continue();
    });
    await page.goto(`http://127.0.0.1:${proxy.address().port}/cloud/`);
    await page.getByLabel('Choose folder files', { exact: true }).setInputFiles(directory);
    const deadline = setTimeout(() => enough(new Error('Timed out waiting for three upload requests')), 15000);
    const reached = await threeRequests; clearTimeout(deadline); if (reached instanceof Error) throw reached;
    const uploads = page.getByRole('region', { name: 'Uploads', exact: true });
    await uploads.getByRole('status').filter({ hasText: '1 queued' }).waitFor();
    await page.getByRole('button', { name: 'Trash', exact: true }).click();
    assert.equal(await uploads.getByRole('status').count(), 1, 'Changing tabs retains the queue');
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await page.getByRole('link', { name: 'Cloud preferences', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Uploads are still running' }).waitFor();
    await page.getByRole('button', { name: 'Keep uploading', exact: true }).click();
    assert.equal(await uploads.getByRole('status').count(), 1);
    release();
    await uploads.getByRole('button', { name: 'Retry Album/retry.txt', exact: true }).click();
    await uploads.getByRole('status').filter({ hasText: '4 completed' }).waitFor();
    const folders = (await client.get('/api/homecloud/folders/all')).body.folders;
    assert.equal(folders.length, 2);
    const child = folders.find(folder => folder.name === 'child');
    assert.equal(child.parentId, rootFolder.id);
    const topFiles = (await client.get(`/api/homecloud/files?folderId=${rootFolder.id}`)).body.files;
    const childFiles = (await client.get(`/api/homecloud/files?folderId=${child.id}`)).body.files;
    assert.deepEqual(topFiles.map(file => file.name).sort(), ['a.txt', 'retry.txt', 'z.txt']);
    assert.deepEqual(childFiles.map(file => file.name), ['b.txt']);
    for (const file of [...topFiles, ...childFiles]) {
      const bytes = (await client.get(`/api/homecloud/files/${file.id}/download`)).body;
      assert.equal(Buffer.from(bytes).toString(), `bytes:${file.name === 'b.txt' ? 'child/b.txt' : file.name}`);
    }
    assert.equal(await page.getByRole('cell', { name: 'a.txt', exact: true }).count(), 0, 'Nested files do not appear in the root listing');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    console.log('PASS: real Core/Cloud folder selection, hierarchy, existing-folder reuse, bounded queue, retry, tab persistence, exact bytes and narrow layout.');
  } catch (error) {
    if (page) console.error(await page.getByRole('region', { name: 'Uploads', exact: true }).innerText().catch(() => 'Upload UI unavailable'));
    throw error;
  } finally {
    release?.();
    if (browser) await browser.close();
    if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
    await stopTestApp();
    const resolvedFixture = path.resolve(fixture), temporaryRoot = fs.realpathSync(os.tmpdir());
    assert.ok(resolvedFixture.startsWith(temporaryRoot + path.sep) && path.basename(resolvedFixture).startsWith('home-folder-browser-'));
    fs.rmSync(resolvedFixture, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
