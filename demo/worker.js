import { seed, handle } from './demo-api.mjs';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
const base = new URL('.', self.location).pathname;
let queue = Promise.resolve();
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('home-browser-demo-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('data');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function read(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('data');
    const request = tx.objectStore('data').get('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function save(db, state) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('data', 'readwrite');
    tx.objectStore('data').put(state, 'state');
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(base + 'demo-api/')) return;
  // Serialize read-modify-write operations, including concurrent uploads from different tabs.
  const operation = queue.then(async () => {
    const db = await database();
    try {
      const previous = await read(db);
      const state = previous || seed(base);
      const response = await handle(state, event.request, base);
      if (response.ok && (!previous || event.request.method !== 'GET')) await save(db, state);
      return response;
    } finally { db.close(); }
  });
  queue = operation.catch(() => {});
  event.respondWith(operation.catch(error => Response.json({ error: error.name === 'QuotaExceededError' ? 'Browser storage is full. Remove some demo files and try again.' : 'Demo storage failed. Allow browser storage and try again.' }, { status: 507 })));
});
