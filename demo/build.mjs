import { createHash } from 'node:crypto';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const base = process.env.DEMO_BASE || '/home/';
if (!/^\/[\w/-]*\/$/.test(base) && base !== '/') throw new Error('DEMO_BASE must be an absolute path ending in /');
const apps = { home: '', homecloud: 'cloud', homemedia: 'media', homenotes: 'notes', hometasks: 'tasks', homemonitor: 'monitor', homevault: 'vault' };
for (const [app, prefix] of Object.entries(apps)) {
  const appBase = base + (prefix ? prefix + '/' : '');
  await build({
    configFile: false, root: path.join(root, 'apps', app), base: appBase,
    plugins: [demoPlugin(), react()],
    build: { outDir: path.join(root, 'demo-dist', prefix), emptyOutDir: app === 'home', target: 'esnext' }
  });
}
for (const file of ['worker.js', 'api.mjs', 'bootstrap.js']) await copyFile('demo/' + file, 'demo-dist/demo-' + file);
await writeFile('demo-dist/.nojekyll', '');
await mkdir('demo-dist/connect', { recursive: true });
for (const file of ['index.html', 'portal.css', 'portal.mjs', 'address.mjs']) {
  await copyFile('server/portal/' + file, 'demo-dist/connect/' + file);
}
await copyFile('design/tokens.css', 'demo-dist/connect/tokens.css');

function demoPlugin() {
  return {
    name: 'home-browser-demo', enforce: 'pre',
    resolveId(id) { if (id === base + 'demo-bootstrap.js') return { id, external: true }; },
    transform(code, id) {
      if (!id.replaceAll('\\', '/').includes('/src/')) return;
      // Only the separate demo build is changed. Production entry points and APIs stay intact.
      code = code.replace(/(["'`])\/api(?=[/$`"'])/g, `$1${base}demo-api`);
      if (id.endsWith('UploadZone.jsx')) code = code.replace('up to 1 GB per file', 'up to 100 MB per file in this demo');
      if (id.endsWith('main.jsx')) {
        code = code.replaceAll('BrowserRouter', 'HashRouter').replace(/ basename=\{(?:import.meta.env.BASE_URL|basename)\}/g, '').replace('&& import.meta.env.PROD', '&& false');
        code = `await import(${JSON.stringify(base + 'demo-bootstrap.js')}).catch(error => { document.getElementById("root").textContent = "HOME demo could not start: " + error.message; throw error; });\n` + code;
      }
      // Don't migrate or clear a real HOME session on a shared localhost origin.
      if (id.endsWith('session.js')) code = code.replace('home_session_token', 'home_demo_session_token').replace(/const LEGACY_KEYS = \[[^;]+;/, 'const LEGACY_KEYS = [];');
      return { code, map: null };
    },
    transformIndexHtml(html) {
      const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => `'sha256-${createHash('sha256').update(m[1].replaceAll('\r\n', '\n')).digest('base64')}'`).join(' ');
      return html.replace('<head>', `<head><meta name="robots" content="noindex"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' ${hashes} 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'">`);
    }
  };
}
