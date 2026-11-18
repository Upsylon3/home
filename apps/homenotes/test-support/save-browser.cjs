// Real Core/Cloud/Notes with disposable data and the production Notes bundle.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startTestApp, stopTestApp } = require('../../homenotes-backend/test/helpers/app');
const { registerHomeNotesUser } = require('../../homenotes-backend/test/helpers/client');

async function main() {
  let proxy, browser;
  try {
    const notes = await startTestApp();
    const owner = await registerHomeNotesUser(notes.homecore, notes.baseUrl);
    const root = path.resolve(__dirname, '../dist');
    const types = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' };
    proxy = http.createServer((req, res) => {
      if (req.url.startsWith('/api/')) {
        const base = req.url.startsWith('/api/homenotes/') ? notes.baseUrl : req.url.startsWith('/api/homecloud/') ? notes.homecloudBackend.baseUrl : notes.homecore.baseUrl;
        const upstream = http.request(base + req.url, { method: req.method, headers: req.headers }, response => {
          res.writeHead(response.statusCode, response.headers); response.pipe(res);
        });
        upstream.on('error', () => { res.writeHead(502); res.end(); });
        req.pipe(upstream); return;
      }
      const pathname = new URL(req.url, 'http://fixture').pathname.replace(/^\/notes/, '');
      const candidate = path.resolve(root, '.' + pathname);
      const file = candidate.startsWith(root + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(root, 'index.html');
      res.setHeader('Content-Type', types[path.extname(file)] || 'text/html');
      fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, channel: process.env.DEMO_BROWSER_CHANNEL || 'chrome' });
    const { verifyNoteSaveSafety } = await import('./save-journey.mjs');
    await verifyNoteSaveSafety(browser, `http://127.0.0.1:${proxy.address().port}/`, { token: owner.token, notePattern: '**/notes/notes/*' });
    const { verifyTemplates } = await import('./templates-journey.mjs');
    await verifyTemplates(browser, `http://127.0.0.1:${proxy.address().port}/`, { token: owner.token, notePattern: '**/notes/notes/*' });
    console.log('PASS: real-service personal templates, immediate-edit snapshot, persisted list, independent note/title/content/tags and template deletion.');
    console.log('PASS: production Notes BrowserRouter, real Core/Cloud/Notes, immediate navigation/save, failed-save retention/retry, explicit discard and reload guard.');
  } finally {
    if (browser) await browser.close();
    if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
    await stopTestApp();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
