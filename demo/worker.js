import { respond } from './demo-store.js';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
const base = new URL('.', self.location).pathname;
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(base + 'demo-api/')) return;
  event.respondWith(respond(event.request, base));
});
