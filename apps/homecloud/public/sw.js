// Deliberately minimal: this is here so the app can be "installed" as a PWA
// and so the shell (HTML/CSS/JS) still loads if the network blips briefly —
// it does NOT cache your files or API responses, since those always need to
// come from the live, authenticated backend.

const CACHE_NAME = "homecloud-shell-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never touch API calls — they need to always hit the real server so
  // auth, file lists, uploads, etc. are never served stale or offline.
  if (request.method !== "GET" || new URL(request.url).pathname.startsWith("/api/")) {
    return;
  }

  // Network-first, falling back to cache: you always get the latest shell
  // when online, but a brief connection drop doesn't show a browser error.
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request))
  );
});
