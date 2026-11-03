const base = new URL('.', import.meta.url).pathname;
if (!('serviceWorker' in navigator)) throw new Error('This demo needs a browser with service workers and HTTPS.');
const registration = await navigator.serviceWorker.register(base + 'demo-worker.js', { scope: base, type: 'module' });
await navigator.serviceWorker.ready;
if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
const probe = await fetch(base + 'demo-api/demo/status');
if (!probe.ok) throw new Error('Browser storage is unavailable. Allow site storage to use the HOME demo.');
if (!localStorage.getItem('home_demo_started')) {
  localStorage.setItem('home_demo_session_token', 'browser-demo');
  localStorage.setItem('home_demo_started', 'yes');
}
const prefixes = ['cloud', 'media', 'notes', 'tasks', 'monitor', 'vault', 'sync'];
document.addEventListener('click', event => {
  const anchor = event.target.closest?.('a');
  if (!anchor) return;
  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin) return;
  if (url.pathname === '/' || prefixes.some(p => url.pathname === '/' + p || url.pathname.startsWith('/' + p + '/'))) {
    event.preventDefault();
    location.href = base + url.pathname.slice(1);
  }
}, true);
const bar = document.createElement('aside');
bar.setAttribute('aria-label', 'Demo controls');
bar.style.cssText = 'padding:10px 16px;background:var(--panel,#221a13);color:var(--text,#f2e6cf);border-bottom:2px solid var(--amber,#e0892b);font:13px/1.5 sans-serif;display:flex;align-items:center;flex-wrap:wrap;gap:12px;position:relative;z-index:100';
const home = document.createElement('a'); home.href = base; home.textContent = 'HOME demo'; home.style.color = 'inherit';
const text = document.createElement('span'); text.textContent = 'Saved in this browser only · Test data only · Server features simulated';
const reset = document.createElement('button'); reset.textContent = 'Reset demo'; reset.className = 'btn btn-sm';
reset.onclick = async () => {
  if (!confirm('Erase this browser’s HOME demo data, including the test Vault, and restore sample data?')) return;
  const res = await fetch(base + 'demo-api/demo/reset', { method: 'POST' });
  if (!res.ok) { alert('Reset failed. Your data has not been reset.'); return; }
  localStorage.setItem('home_demo_session_token', 'browser-demo');
  location.href = base;
};
bar.append(home, text, reset); document.body.prepend(bar);
// Ask browsers to retain demo data; a refusal does not prevent using it.
navigator.storage?.persist?.().catch(() => {});
