const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { startTestApp, stopTestApp } = require('../../homemedia-backend/test/helpers/app');
const { makeClient, registerHomeMediaUser } = require('../../homemedia-backend/test/helpers/client');

async function main() {
  let server, browser, page;
  const requests = [];
  try {
    const media = await startTestApp();
    const owner = await registerHomeMediaUser(media.homecore, media.baseUrl);
    const root = path.resolve(__dirname, '../dist');
    const types = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' };
    server = http.createServer((req, res) => {
      if (req.url.startsWith('/api/')) {
        const upstream = req.url.startsWith('/api/homemedia/') ? media.baseUrl : req.url.startsWith('/api/homecloud/') ? media.homecloudBackend.baseUrl : media.homecore.baseUrl;
        const request = http.request(upstream + req.url, { method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
        request.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
        res.on('close', () => request.destroy()); req.pipe(request); return;
      }
      const pathname = new URL(req.url, 'http://fixture').pathname.replace(/^\/media/, '');
      const candidate = path.resolve(root, '.' + pathname);
      const file = candidate.startsWith(root + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(root, 'index.html');
      res.setHeader('Content-Type', types[path.extname(file)] || 'text/html'); fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, channel: process.env.DEMO_BROWSER_CHANNEL || 'chrome' });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addInitScript(token => localStorage.setItem('home_session_token', token), owner.token);
    page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.includes('/poster-ticket') || pathname.includes('/stream/')) requests.push({ kind: pathname.includes('/poster-ticket') ? 'poster ticket' : 'media stream', status: response.status(), range: response.headers()['content-range'] });
    });
    const { verifyVideoPosters } = await import('./poster-journey.mjs');
    await verifyVideoPosters(page, { mediaUrl: origin + '/media/', apiBase: '/api', token: owner.token });
    await page.route('**/api/homemedia/library', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Injected cover outage"}' }));
    await page.getByRole('link', { name: 'Albums', exact: true }).first().click();
    await page.getByRole('status').filter({ hasText: 'Cover previews are unavailable' }).waitFor();
    await page.locator('.album-card').filter({ hasText: 'Poster proof album' }).waitFor();
    await page.unroute('**/api/homemedia/library');
    assert.deepEqual(errors, []);
    // Bearer media links must not turn arbitrary uploads into executable
    // same-origin documents when opened directly rather than in a media tag.
    const cloud = makeClient(media.homecloudBackend.baseUrl); cloud.setToken(owner.token);
    const form = new FormData(); form.append('file', new Blob(['<!doctype html><body><script>document.body.dataset.fixtureExecuted="yes"</script>'], { type: 'text/html' }), 'sandbox-fixture.html');
    const uploaded = await cloud.post('/api/homecloud/files/upload', form, { raw: true });
    assert.equal(uploaded.status, 201);
    const ticket = await owner.client.post(`/api/homemedia/${uploaded.body.file.id}/ticket`);
    assert.equal(ticket.status, 200);
    const response = await page.goto(origin + ticket.body.url);
    assert.equal(response.headers()['content-security-policy'], "sandbox; default-src 'none'");
    assert.equal(await page.evaluate(() => document.body.dataset.fixtureExecuted), undefined);
    console.log('PASS: real Core/Cloud/Media generated WebM, decoded green-frame JPEG, unsupported fallback, warm route cache, playback and sandboxed active uploads.');
  } catch (error) {
    console.error(requests);
    if (page) { console.error(await page.locator('body').innerText().catch(() => 'UI unavailable')); await page.screenshot({ path: path.join(os.tmpdir(), 'home-poster-failure.png') }).catch(() => {}); }
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await stopTestApp();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
