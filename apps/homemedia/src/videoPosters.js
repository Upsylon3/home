import { api, getToken } from './api.js';

export function createPosterCache({ decode, session, revoke, maxEntries = 48, maxBytes = 4 * 1024 * 1024, concurrency = 2, queueLimit = 24 }) {
  let identity, running = 0, bytes = 0;
  const entries = new Map(), queue = [];
  function discard(key, entry) {
    entry.controller.abort();
    if (entry.url) { revoke(entry.url); bytes -= entry.bytes; }
    entries.delete(key);
  }
  function trim() {
    for (const [key, entry] of entries) {
      if (entries.size <= maxEntries && bytes <= maxBytes) break;
      if (entry.settled) discard(key, entry);
    }
  }
  function clear() {
    for (const [key, entry] of entries) discard(key, entry);
    while (queue.length) queue.shift().reject(new DOMException('Preview cancelled.', 'AbortError'));
    identity = undefined;
  }
  function pump() {
    while (running < concurrency && queue.length) {
      const entry = queue.shift();
      if (entry.controller.signal.aborted) { entry.reject(new DOMException('Preview cancelled.', 'AbortError')); continue; }
      running++;
      Promise.resolve().then(() => decode(entry.file, entry.controller.signal)).then(result => {
        if (entry.controller.signal.aborted || session() !== entry.identity) { revoke(result.url); throw new DOMException('Session changed.', 'AbortError'); }
        if (result.bytes > maxBytes) { revoke(result.url); throw new Error('Preview is too large.'); }
        entry.url = result.url; entry.bytes = result.bytes; bytes += result.bytes;
        entry.resolve(result.url);
      }).catch(entry.reject).finally(() => { entry.settled = true; entry.until = Date.now() + (entry.url ? 5 * 60_000 : 30_000); running--; trim(); pump(); });
    }
  }
  return {
    get(file) {
      const current = session();
      if (current !== identity) { clear(); identity = current; }
      if (!current) return Promise.reject(new Error('Sign in to preview videos.'));
      const key = JSON.stringify([file.id, file.size, file.createdAt, file.mimetype]);
      const cached = entries.get(key);
      if (cached && (!cached.settled || cached.until > Date.now())) {
        entries.delete(key); entries.set(key, cached); return cached.promise;
      }
      if (cached) discard(key, cached);
      if (queue.filter(entry => !entry.controller.signal.aborted).length >= queueLimit) return Promise.reject(new Error('Preview queue is full.'));
      const entry = { file, identity: current, controller: new AbortController(), bytes: 0 };
      entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
      entries.set(key, entry); queue.push(entry); trim(); pump(); return entry.promise;
    },
    clear
  };
}

async function decodePoster(file, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 8000);
  let video, sourceUrl, frameCallback;
  try {
    if (signal.aborted) throw new DOMException('Preview cancelled.', 'AbortError');
    const url = await api.posterTicket(file.id, controller.signal);
    sourceUrl = url;
    return await new Promise((resolve, reject) => {
      const stop = () => reject(new DOMException('Preview cancelled or timed out.', 'AbortError'));
      controller.signal.addEventListener('abort', stop, { once: true });
      if (controller.signal.aborted) { stop(); return; }
      video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.preload = 'auto';
      video.onerror = () => reject(new Error('This video has no supported preview.'));
      let captured = false;
      const capture = () => {
        if (captured) return; captured = true;
        video.pause();
        const { videoWidth: width, videoHeight: height } = video;
        if (!width || !height || width * height > 16_777_216) { reject(new Error('Video dimensions exceed the preview limit.')); return; }
        const scale = Math.min(1, 640 / Math.max(width, height));
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
        try {
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(blob => {
            if (!blob || controller.signal.aborted) { stop(); return; }
            resolve({ url: URL.createObjectURL(blob), bytes: blob.size });
          }, 'image/jpeg', 0.8);
        } catch { reject(new Error('Could not draw a video preview.')); }
      };
      // loadeddata can precede presentation, notably for fast Blob sources.
      // Wait for the decoder's actual frame rather than drawing a black surface.
      if (video.requestVideoFrameCallback) frameCallback = video.requestVideoFrameCallback(capture);
      else video.onloadeddata = capture;
      video.src = url; video.load();
      video.play().catch(error => { if (!captured) reject(error); });
    });
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', abort);
    if (video) { video.pause(); if (frameCallback != null) video.cancelVideoFrameCallback(frameCallback); video.onloadeddata = null; video.onerror = null; video.removeAttribute('src'); video.load(); }
    if (sourceUrl?.startsWith('blob:')) URL.revokeObjectURL(sourceUrl);
  }
}

export const videoPosters = createPosterCache({ decode: decodePoster, session: getToken, revoke: url => URL.revokeObjectURL(url) });
