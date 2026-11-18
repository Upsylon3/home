// Real Core + production Home UI, disposable accounts/database only.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { TOTP, Secret } = require('otpauth');
const { startTestApp, stopTestApp } = require('../../../homecore/test/helpers/app');
const { registerUser, makeClient } = require('../../../homecore/test/helpers/client');

async function main() {
  let proxy, browser;
  try {
    const core = await startTestApp();
    const owner = await registerUser(core.baseUrl);
    const member = await registerUser(core.baseUrl);
    const memberSetup = await member.client.post('/api/auth/2fa/setup');
    const memberTotp = new TOTP({ issuer: 'homecloud', label: member.username, algorithm: 'SHA1', digits: 6, period: 30,
      secret: Secret.fromBase32(memberSetup.body.secret) });
    assert.equal((await member.client.post('/api/auth/2fa/confirm', { code: memberTotp.generate() })).status, 200);
    const root = path.resolve(__dirname, '../dist');
    const cloudRoot = path.resolve(__dirname, '../../homecloud/dist');
    const types = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' };
    proxy = http.createServer((req, res) => {
      if (req.url.startsWith('/api/')) {
        const upstream = http.request(core.baseUrl + req.url, { method: req.method, headers: req.headers }, response => {
          res.writeHead(response.statusCode, response.headers); response.pipe(res);
        });
        upstream.on('error', () => { res.writeHead(502); res.end(); });
        req.pipe(upstream); return;
      }
      const pathname = new URL(req.url, 'http://fixture').pathname;
      const appRoot = pathname.startsWith('/cloud/') ? cloudRoot : root;
      const appPath = appRoot === cloudRoot ? pathname.slice('/cloud'.length) : pathname;
      const candidate = path.resolve(appRoot, '.' + appPath);
      const file = candidate.startsWith(appRoot + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(appRoot, 'index.html');
      res.setHeader('Content-Type', types[path.extname(file)] || 'text/html');
      fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${proxy.address().port}`;
    browser = await chromium.launch({ headless: true, channel: process.env.DEMO_BROWSER_CHANNEL || 'chrome' });
    const context = await browser.newContext();
    await context.addInitScript(token => localStorage.setItem('home_session_token', token), owner.token);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/settings');
    const admin = page.getByRole('region', { name: 'Account administration', exact: true });
    const totp = page.getByRole('region', { name: 'Two-factor authentication', exact: true });
    const memberRow = admin.getByRole('row').filter({ has: page.getByRole('cell', { name: member.username, exact: true }) });
    await memberRow.waitFor();
    assert.equal(await admin.getByRole('row').filter({ has: page.getByRole('cell', { name: owner.username, exact: true }) }).getByRole('button', { name: 'Disable', exact: true }).isDisabled(), true);
    await admin.getByText('Unavailable', { exact: false }).first().waitFor();
    page.once('dialog', dialog => dialog.accept());
    await admin.getByRole('button', { name: 'Remove admin', exact: true }).click();
    await admin.getByRole('alert').filter({ hasText: "Can't remove the last remaining admin." }).waitFor();
    page.once('dialog', dialog => dialog.accept());
    await memberRow.getByRole('button', { name: 'Reset 2FA', exact: true }).click();
    await memberRow.getByRole('cell', { name: 'Off', exact: true }).waitFor();
    assert.equal((await member.client.get('/api/auth/me')).body.totpEnabled, false);
    await memberRow.getByRole('button', { name: 'Reset password', exact: true }).click();
    const resetForm = admin.getByRole('form', { name: `Reset password for ${member.username}` });
    await resetForm.getByLabel('New account password', { exact: true }).fill('TemporaryPassword1');
    assert.equal(await resetForm.getByLabel('New account password', { exact: true }).getAttribute('type'), 'password');
    page.once('dialog', dialog => dialog.accept());
    await resetForm.getByRole('button', { name: 'Reset password and sign out sessions', exact: true }).click();
    await admin.getByRole('status').filter({ hasText: 'Password reset.' }).waitFor();
    assert.equal(await resetForm.count(), 0);
    assert.equal((await member.client.get('/api/auth/me')).status, 401);
    member.password = 'TemporaryPassword1';

    // Legacy bookmarks retain storage views and lead to the same-origin HOME UI.
    await page.route('**/api/activity', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Storage activity unavailable."}' }));
    await page.goto(origin + '/cloud/settings');
    await page.getByRole('heading', { name: 'Cloud preferences', exact: true }).waitFor();
    await page.getByRole('alert').filter({ hasText: 'Storage activity unavailable.' }).waitFor();
    assert.equal(await page.getByLabel('Current password', { exact: true }).count(), 0);
    await page.unroute('**/api/activity');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('table').waitFor();
    assert.equal(await page.getByRole('link', { name: 'Open HOME account settings', exact: true }).getAttribute('href'), '/settings');
    await page.getByRole('link', { name: 'Open HOME account settings', exact: true }).click();
    await page.getByRole('heading', { name: 'Your account', exact: true }).waitFor();
    await page.goto(origin + '/cloud/admin');
    await page.getByRole('heading', { name: 'Storage activity', exact: true }).waitFor();
    await page.getByRole('table').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Reset password', exact: true }).count(), 0);
    await page.getByRole('link', { name: 'Open HOME account administration', exact: true }).click();
    await admin.waitFor();

    // Bad proof must stay in Settings, while success replaces the token.
    await page.getByLabel('Current password', { exact: true }).fill('wrong-password');
    await page.getByLabel('New password', { exact: true }).fill('UpdatedPassword1');
    await page.getByLabel('Confirm new password', { exact: true }).fill('UpdatedPassword1');
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Current password is incorrect.' }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('home_session_token')), owner.token);
    await page.getByLabel('Current password', { exact: true }).fill(owner.password);
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Password updated.' }).waitFor();
    const renewed = await page.evaluate(() => localStorage.getItem('home_session_token'));
    assert.notEqual(renewed, owner.token);
    assert.equal((await owner.client.get('/api/auth/me')).status, 401);
    owner.client.setToken(renewed);
    assert.equal((await owner.client.get('/api/auth/me')).status, 200);

    await totp.getByRole('button', { name: 'Set up two-factor authentication', exact: true }).click();
    const secret = await totp.locator('code').textContent();
    const authenticator = new TOTP({ issuer: 'homecloud', label: owner.username, algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) });
    await totp.getByLabel('Authenticator code', { exact: true }).fill('bad-code');
    await totp.getByRole('button', { name: 'Confirm and enable', exact: true }).click();
    await totp.getByRole('alert').waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('home_session_token')), renewed);
    await totp.getByLabel('Authenticator code', { exact: true }).fill(authenticator.generate());
    await totp.getByRole('button', { name: 'Confirm and enable', exact: true }).click();
    await totp.getByRole('button', { name: 'I saved these codes', exact: true }).waitFor();
    const originalCodes = await totp.locator('li code').allTextContents();
    assert.equal(originalCodes.length, 8);
    assert.ok(!(await page.evaluate(() => JSON.stringify({ ...localStorage })) ).includes(secret));
    await totp.getByRole('button', { name: 'I saved these codes', exact: true }).click();
    await totp.getByLabel('Confirm your password', { exact: true }).fill('UpdatedPassword1');
    await totp.getByRole('button', { name: 'Regenerate recovery codes', exact: true }).click();
    await totp.getByRole('button', { name: 'I saved these codes', exact: true }).waitFor();
    const rotated = await totp.locator('li code').allTextContents();
    assert.equal(rotated.length, 8);
    assert.ok(rotated.every(code => !originalCodes.includes(code)));
    const login = makeClient(core.baseUrl);
    const pending = await login.post('/api/auth/login', { username: owner.username, password: 'UpdatedPassword1' });
    assert.equal((await login.post('/api/auth/2fa/verify', { pendingToken: pending.body.pendingToken, code: originalCodes[0] })).status, 401);
    assert.equal((await login.post('/api/auth/2fa/verify', { pendingToken: pending.body.pendingToken, code: rotated[0] })).status, 200);
    assert.equal((await login.post('/api/auth/2fa/verify', { pendingToken: pending.body.pendingToken, code: rotated[0] })).status, 401);
    await totp.getByRole('button', { name: 'I saved these codes', exact: true }).click();
    await totp.getByLabel('Confirm your password', { exact: true }).fill('wrong-password');
    page.once('dialog', dialog => dialog.accept());
    await totp.getByRole('button', { name: 'Disable two-factor authentication', exact: true }).click();
    await totp.getByRole('alert').waitFor();
    await totp.getByLabel('Confirm your password', { exact: true }).fill('UpdatedPassword1');
    page.once('dialog', dialog => dialog.accept());
    await totp.getByRole('button', { name: 'Disable two-factor authentication', exact: true }).click();
    await totp.getByRole('button', { name: 'Set up two-factor authentication', exact: true }).waitFor();

    page.once('dialog', dialog => dialog.accept('1.25'));
    await memberRow.getByRole('button', { name: 'Set quota', exact: true }).click();
    await memberRow.getByRole('cell', { name: /1.25 GB/ }).waitFor();
    page.once('dialog', dialog => dialog.accept(''));
    await memberRow.getByRole('button', { name: 'Set quota', exact: true }).click();
    await memberRow.getByRole('cell', { name: /5.00 GB/ }).waitFor();
    page.once('dialog', dialog => dialog.accept());
    await memberRow.getByRole('button', { name: 'Make admin', exact: true }).click();
    await memberRow.getByRole('cell', { name: 'admin', exact: true }).waitFor();
    page.once('dialog', dialog => dialog.accept());
    await memberRow.getByRole('button', { name: 'Remove admin', exact: true }).click();
    await memberRow.getByRole('cell', { name: 'user', exact: true }).waitFor();
    page.once('dialog', dialog => dialog.accept());
    await memberRow.getByRole('button', { name: 'Disable', exact: true }).click();
    await memberRow.getByRole('cell', { name: 'Disabled', exact: true }).waitFor();
    page.once('dialog', dialog => dialog.accept());
    await memberRow.getByRole('button', { name: 'Enable', exact: true }).click();
    await memberRow.getByRole('cell', { name: 'Active', exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Settings fit a narrow screen');
    if (process.env.HOME_ACCOUNT_SCREENSHOT) await page.screenshot({ path: process.env.HOME_ACCOUNT_SCREENSHOT, fullPage: true });

    // A genuinely revoked session must leave Settings even on a proof endpoint.
    assert.equal((await owner.client.post('/api/auth/logout-everywhere')).status, 200);
    await page.getByLabel('Current password', { exact: true }).fill('UpdatedPassword1');
    await page.getByLabel('New password', { exact: true }).fill('AnotherPassword1');
    await page.getByLabel('Confirm new password', { exact: true }).fill('AnotherPassword1');
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    await page.waitForURL('**/login');
    assert.equal(await page.evaluate(() => localStorage.getItem('home_session_token')), null);

    const fresh = await makeClient(core.baseUrl).post('/api/auth/login', { username: member.username, password: member.password });
    assert.equal(fresh.status, 200);
    const regular = await browser.newContext();
    await regular.addInitScript(token => localStorage.setItem('home_session_token', token), fresh.body.token);
    const regularPage = await regular.newPage();
    await regularPage.goto(origin + '/settings');
    await regularPage.getByRole('heading', { name: 'Your account', exact: true }).waitFor();
    assert.equal(await regularPage.getByRole('region', { name: 'Account administration', exact: true }).count(), 0);
    member.client.setToken(fresh.body.token);
    assert.equal((await member.client.get('/api/admin/users')).status, 403);
    assert.deepEqual(errors, []);
    console.log('Verified real Core password/token lifecycle, TOTP setup/retry/rotation/one-use recovery/disable, masked admin password reset, emergency 2FA reset, last-admin guard, quota/roles/disable, member access denial and mobile layout.');
  } finally {
    if (browser) await browser.close();
    if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
    await stopTestApp();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
