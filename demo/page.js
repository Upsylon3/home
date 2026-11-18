import { respond } from './demo-store.js';

export function usePageApi(base) {
  const networkFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith(base + 'demo-api/')) {
      return networkFetch(input, init);
    }
    const request = new Request(input, init);
    const response = await respond(request, base);
    // Media elements need a browser-readable URL when no worker serves streams.
    if (response.ok && /\/(ticket|poster-ticket)$/.test(url.pathname)) {
      const ticket = await response.json();
      const stream = await respond(new Request(ticket.url), base);
      if (!stream.ok) return stream;
      return Response.json({ url: URL.createObjectURL(await stream.blob()) });
    }
    return response;
  };

  // The two upload controls normally use XHR for network progress. In this
  // mode the file moves directly from the page into its local database.
  window.homeDemoUpload = class {
    upload = {};
    headers = new Headers();
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers.set(name, value); }
    abort() { this.cancelled = true; this.controller?.abort(); this.onabort?.(); }
    async send(body) {
      this.controller = new AbortController();
      try {
        const response = await fetch(this.url, { method: this.method, headers: this.headers, body, signal: this.controller.signal });
        this.status = response.status;
        this.responseText = await response.text();
      } catch {
        if (!this.cancelled) this.onerror?.();
        return;
      }
      if (!this.cancelled) this.onload?.();
    }
  };
}
