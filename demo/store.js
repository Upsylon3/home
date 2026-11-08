import { seed, handle } from './demo-api.mjs';
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
  // Some WebKit storage implementations reject Blob and File values. Convert
  // new and legacy files before opening the transaction so it stays active.
  for (const file of state.files) {
    if (file.blob instanceof Blob) file.blob = await file.blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction('data', 'readwrite');
    tx.objectStore('data').put(state, 'state');
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

export async function respond(request, base) {
  // Both service workers and open pages can share this database.
  try {
    return await navigator.locks.request('home-browser-demo-v1', async () => {
      const db = await database();
      try {
        const previous = await read(db);
        const state = previous || seed(base);
        const response = await handle(state, request, base);
        if (response.ok && (!previous || request.method !== 'GET')) await save(db, state);
        return response;
      } finally { db.close(); }
    });
  } catch (error) {
    return Response.json({ error: error?.name === 'QuotaExceededError' ? 'Browser storage is full. Remove some demo files and try again.' : 'Demo storage failed. Allow browser storage and try again.' }, { status: 507 });
  }
}
