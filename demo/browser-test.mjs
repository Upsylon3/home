import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { verifyPortal } from '../server/portal/browser-proof.mjs';
import { verifyBenchmark } from '../apps/homevault/test-support/benchmark-proof.mjs';
const server = spawn(process.execPath, ['demo/serve.mjs'], { env: { ...process.env, PORT: '4174' }, stdio: ['ignore', 'pipe', 'inherit'] });
await once(server.stdout, 'data');
const browser = await chromium.launch({ ...(process.env.DEMO_BROWSER_CHANNEL ? { channel: process.env.DEMO_BROWSER_CHANNEL } : {}), headless: true });
const origin = process.env.DEMO_TEST_URL || 'http://127.0.0.1:4174' + (process.env.DEMO_BASE || '/home/');
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const see = async text => page.getByText(text, { exact: true }).waitFor();
try {
  const restricted = await browser.newContext({ serviceWorkers: 'block' });
  try {
    await restricted.addInitScript(() => {
      ServiceWorkerContainer.prototype.register = async () => { throw new DOMException('Service worker failed to launch', 'SecurityError'); };
    });
    const restrictedPage = await restricted.newPage();
    await restrictedPage.goto(origin);
    await restrictedPage.getByRole('link', { name: 'Launch', exact: true }).nth(5).waitFor();
    await restrictedPage.goto(origin + 'cloud/');
    await restrictedPage.locator('input[type=file]').setInputFiles({ name: 'restricted-browser.txt', mimeType: 'text/plain', buffer: Buffer.from('local upload') });
    await restrictedPage.getByRole('cell', { name: 'restricted-browser.txt', exact: true }).waitFor();
    await restrictedPage.reload();
    await restrictedPage.getByRole('cell', { name: 'restricted-browser.txt', exact: true }).waitFor();
  } finally {
    await restricted.close();
  }
  await verifyPortal(page, origin);
  await verifyBenchmark(browser, origin + 'vault/benchmark.html');
  await page.goto(origin);
  await page.getByRole('heading', { name: /Good|Still up/ }).waitFor();
  // The greeting renders before the asynchronous app-registry response.
  await page.getByRole('link', { name: 'Launch', exact: true }).nth(5).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Launch', exact: true }).count(), 6);
  // Upload through the real Cloud XHR control, then verify persistence and exact bytes.
  await page.goto(origin + 'cloud/');
  await page.locator('input[type=file]').setInputFiles({ name: 'browser-proof.txt', mimeType: 'text/plain', buffer: Buffer.from('persistent browser bytes') });
  await see('browser-proof.txt');
  await page.reload(); await see('browser-proof.txt');
  const bytes = await page.evaluate(async base => {
    const headers = { Authorization: 'Bearer browser-demo' };
    const { files } = await (await fetch(base + 'demo-api/homecloud/files', { headers })).json();
    const file = files.find(f => f.name === 'browser-proof.txt');
    return (await fetch(base + `demo-api/homecloud/files/${file.id}/download`, { headers })).text();
  }, new URL(origin).pathname);
  assert.equal(bytes, 'persistent browser bytes');
  // Concurrent uploads must not overwrite each other.
  await page.locator('input[type=file]').setInputFiles(['one', 'two', 'three'].map(name => ({ name: name + '.txt', mimeType: 'text/plain', buffer: Buffer.from(name) })));
  for (const name of ['one', 'two', 'three']) await see(name + '.txt');
  await page.goto(origin + 'tasks/');
  await page.getByRole('textbox', { name: 'New task title' }).fill('Task from browser proof');
  await page.getByRole('button', { name: 'Add', exact: true }).click(); await see('Task from browser proof');
  await page.reload(); await see('Task from browser proof');
  await page.goto(origin + 'notes/');
  await page.getByRole('button', { name: 'New note' }).click();
  await page.waitForURL('**/#/notes/*');
  await page.locator('input').filter({ visible: true }).first().fill('Browser journal');
  // Existing Notes autosave runs after typing; wait for the actual PATCH to finish.
  await page.waitForResponse(r => r.url().includes('/homenotes/notes/') && r.request().method() === 'PATCH');
  await page.reload(); await page.locator('input').filter({ visible: true }).first().waitFor();
  assert.equal(await page.locator('input').filter({ visible: true }).first().inputValue(), 'Browser journal');
  for (const [route, label] of [['settings', 'Open HOME account settings'], ['admin', 'Open HOME account administration']]) {
    await page.goto(origin + 'cloud/#/' + route);
    await page.getByRole('link', { name: label, exact: true }).click();
    await page.getByRole('heading', { name: 'Your account', exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, new URL(origin).pathname);
    assert.equal(new URL(page.url()).hash, '#/settings');
  }
  for (const app of ['media/', 'monitor/', '#/settings', '#/apps', '#/search']) {
    await page.goto(origin + app); await page.locator('h1').waitFor();
  }
  for (const app of ['media', 'notes', 'tasks', 'monitor']) {
    await page.goto(origin + app + '/#/settings');
    await page.getByRole('link', { name: 'Open HOME account settings', exact: true }).click();
    await page.getByRole('heading', { name: 'Your account', exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, new URL(origin).pathname);
    assert.equal(new URL(page.url()).hash, '#/settings');
  }
  await page.goto(origin + 'media/');
  // A heading or a successful HTTP response does not prove an image decoded.
  const thumbnail = page.locator('.photo-tile').getByRole('img', { name: 'A little room to explore.svg' });
  const decodedAspectRatio = async img => { await img.decode(); return img.naturalWidth / img.naturalHeight; };
  assert.equal(await thumbnail.evaluate(decodedAspectRatio), 1.5);
  await thumbnail.click();
  const original = page.locator('.lightbox-image');
  assert.equal(await original.evaluate(decodedAspectRatio), 1.5);
  await page.goto(origin + '#/apps');
  const notesCard = page.locator('.app-card').filter({ has: page.getByRole('heading', { name: 'HomeNotes', exact: true }) });
  page.once('dialog', dialog => dialog.accept());
  await notesCard.getByRole('button', { name: 'Uninstall', exact: true }).click();
  await notesCard.getByRole('button', { name: 'Install', exact: true }).click();
  await notesCard.getByText('Disabled', { exact: true }).waitFor();
  await notesCard.getByRole('button', { name: 'Enable', exact: true }).click();
  await notesCard.getByRole('link', { name: 'Launch', exact: true }).waitFor();
  await page.reload();
  await notesCard.getByRole('link', { name: 'Launch', exact: true }).waitFor();
  await page.goto(origin + 'notes/');
  await page.getByText('Browser journal', { exact: true }).first().click();
  await page.waitForURL('**/#/notes/*');
  await page.locator('input.note-editor-title').waitFor();
  assert.equal(await page.locator('input.note-editor-title').inputValue(), 'Browser journal');
  // Use the unmodified Vault UI and Argon2id, not a fake unlock implementation.
  await page.goto(origin + 'vault/');
  await page.getByLabel('Master password', { exact: true }).fill('home-demo-master-only');
  await page.getByLabel('Confirm master password').fill('home-demo-master-only');
  await page.getByRole('button', { name: 'Create vault', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue to my vault' }).click();
  await page.getByRole('button', { name: 'New item' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Browser test login');
  await page.getByLabel('Username', { exact: true }).fill('demo-only');
  await page.getByLabel('Password', { exact: true }).fill('dummy-secret-never-real');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await see('Browser test login');
  await page.reload();
  await page.getByLabel('Master password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await see('That master password is incorrect.');
  await page.getByLabel('Master password', { exact: true }).fill('home-demo-master-only');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await see('Browser test login');
  await page.getByText('Browser test login', { exact: true }).click();
  assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), 'dummy-secret-never-real');
  const stored = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('home-browser-demo-v1');
    open.onsuccess = () => { const db = open.result; const get = db.transaction('data').objectStore('data').get('state'); get.onsuccess = () => { resolve(JSON.stringify(get.result)); db.close(); }; get.onerror = reject; };
    open.onerror = reject;
  }));
  for (const plain of ['dummy-secret-never-real', 'Browser test login', 'home-demo-master-only']) assert.ok(!stored.includes(plain), 'Vault plaintext must not be persisted');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin); await page.locator('h1').waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile page must fit viewport');
  await page.screenshot({ path: 'demo-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ path: 'demo-desktop.png', fullPage: true });
  const fresh = await browser.newContext(); const freshPage = await fresh.newPage();
  await freshPage.goto(origin + 'vault/'); await freshPage.getByRole('heading', { name: 'Create your vault' }).waitFor();
  await fresh.close();
  page.once('dialog', dialog => dialog.accept());
  // The heading already exists on the old home page. Wait for Reset's actual
  // navigation before that heading can count as evidence of the new page.
  const resetNavigation = page.waitForEvent('framenavigated', frame => frame === page.mainFrame());
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await resetNavigation;
  await page.waitForLoadState('load');
  await page.getByRole('heading', { name: /Good|Still up/ }).waitFor();
  await page.goto(origin + 'vault/'); await page.getByRole('heading', { name: 'Create your vault' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: seven apps, XHR uploads, concurrent writes, notes/tasks persistence, real Vault encryption/unlock, mobile, fresh browser, reset; no browser errors.');
} finally { await browser.close(); server.kill(); }
