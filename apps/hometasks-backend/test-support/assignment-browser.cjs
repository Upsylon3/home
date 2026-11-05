// Real disposable Core/Tasks and built UI; never loads dotenv or personal data.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startTestApp, stopTestApp } = require('../test/helpers/app');
const { registerHomeTasksUser } = require('../test/helpers/client');
async function main() {
  let proxy, browser;
  try {
    delete process.env.HOMETASKS_REMINDER_KEY_FILE;
    const tasks = await startTestApp();
    const owner = await registerHomeTasksUser(tasks.homecore, tasks.baseUrl);
    const member = await registerHomeTasksUser(tasks.homecore, tasks.baseUrl);
    const project = (await owner.client.post('/api/hometasks/projects', { name: 'Private owner project' })).body.project;
    const task = (await owner.client.post('/api/hometasks/tasks', { title: 'Share one chore', notes: 'Shared chore notes', projectId: project.id })).body.task;
    await owner.client.post('/api/hometasks/tasks', { title: 'Private sibling task', projectId: project.id });
    const root = path.resolve(__dirname, '../../hometasks/dist');
    const types = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' };
    proxy = http.createServer((req, res) => {
      if (req.url.startsWith('/api/')) {
        const origin = req.url.startsWith('/api/hometasks/') ? tasks.baseUrl : tasks.homecore.baseUrl;
        const upstream = http.request(origin + req.url, { method: req.method, headers: req.headers }, response => {
          res.writeHead(response.statusCode, response.headers); response.pipe(res);
        });
        upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); }); req.pipe(upstream); return;
      }
      const candidate = path.resolve(root, '.' + new URL(req.url, 'http://fixture').pathname.replace(/^\/tasks/, ''));
      const file = candidate.startsWith(root + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(root, 'index.html');
      res.setHeader('Content-Type', types[path.extname(file)] || 'text/html'); fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${proxy.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.DEMO_BROWSER_CHANNEL ? { channel: process.env.DEMO_BROWSER_CHANNEL } : {}) });
    const errors = [];
    async function pageFor(account) {
      const context = await browser.newContext();
      await context.addInitScript(token => localStorage.setItem('home_session_token', token), account.token);
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); return page;
    }
    const page = await pageFor(owner), recipient = await pageFor(member);
    await page.goto(origin + '/tasks/all');
    await page.getByRole('button', { name: task.title, exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Edit task', exact: true });
    await editor.getByLabel('Notes', { exact: true }).fill('Unsaved private draft');
    assert.ok(await editor.getByRole('button', { name: 'Assign and share task', exact: true }).isDisabled());
    await editor.getByLabel('Notes', { exact: true }).fill(task.notes);
    await editor.getByLabel('Exact username', { exact: true }).fill(member.username);
    await page.route('**/api/hometasks/tasks/*/assignment', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Assignment temporarily unavailable."}' }));
    await editor.getByRole('button', { name: 'Assign and share task', exact: true }).click();
    await editor.getByRole('alert').waitFor();
    await page.unroute('**/api/hometasks/tasks/*/assignment');
    await editor.getByRole('button', { name: 'Assign and share task', exact: true }).press('Enter');
    await editor.getByText('Assigned to ' + member.username, { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await recipient.goto(origin + '/tasks/assigned');
    await recipient.getByRole('button', { name: task.title, exact: true }).click();
    const assigned = recipient.getByRole('dialog', { name: 'Assigned task', exact: true });
    await assigned.getByText(task.notes, { exact: true }).waitFor();
    assert.equal(await recipient.getByText('Private sibling task', { exact: true }).count(), 0);
    assert.equal(await recipient.getByText(project.name, { exact: true }).count(), 0);
    assert.equal(await assigned.getByRole('button', { name: 'Save', exact: true }).count(), 0);
    assert.equal(await assigned.getByRole('button', { name: 'Delete task', exact: true }).count(), 0);
    await recipient.setViewportSize({ width: 390, height: 844 });
    assert.ok(await recipient.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await assigned.getByRole('button', { name: 'Complete task', exact: true }).press('Enter');
    await assigned.waitFor({ state: 'hidden' });
    assert.ok((await owner.client.get(`/api/hometasks/tasks/${task.id}`)).body.task.isDone);
    await page.goto(origin + '/tasks/done');
    await page.getByRole('button', { name: task.title, exact: true }).click();
    await page.getByRole('button', { name: 'Remove assignment', exact: true }).click();
    await page.getByText('Not assigned. Only you can access this task.', { exact: true }).waitFor();
    await recipient.reload();
    await recipient.getByText('No tasks are assigned to you.', { exact: true }).waitFor();
    await page.getByLabel('Exact username', { exact: true }).fill(member.username);
    await page.getByRole('button', { name: 'Assign and share task', exact: true }).click();
    await page.getByRole('dialog').getByRole('status').filter({ hasText: 'Assigned to ' + member.username }).waitFor();
    await recipient.reload();
    await recipient.getByRole('button', { name: task.title, exact: true }).click();
    await recipient.getByRole('button', { name: 'Decline this assignment', exact: true }).click();
    await recipient.getByText('No tasks are assigned to you.', { exact: true }).waitFor();
    assert.equal((await owner.client.get(`/api/hometasks/tasks/${task.id}`)).body.task.assignee, null);
    assert.deepEqual(errors, []);
    console.log('Verified two-user task assignment, draft protection, failure/retry, private projects/siblings, completion, revocation, decline, keyboard and narrow layout.');
  } finally {
    if (browser) await browser.close();
    if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
    await stopTestApp();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
