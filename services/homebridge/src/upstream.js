function origin(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("HomeBridge upstreams must be HTTP(S) origins without credentials or paths.");
  }
  return url.origin;
}

// Bound both headers and streamed bodies. Refuse redirects rather than
// forwarding a user's bearer token to a destination chosen by an upstream.
async function getJSON(url, token, { timeoutMs = 5000, maxBytes = 1024 * 1024, method = "GET", body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      method, body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error", signal: controller.signal
    });
    // Only JSON requests are used; no browser Origin/Fetch Metadata headers
    // are forwarded to private Core issuance.
    if (!response.ok) {
      await response.body?.cancel();
      const error = new Error("Upstream request failed.");
      error.status = response.status;
      const header = response.headers.get("retry-after");
      const retry = header && /^\d+$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000;
      if (Number.isFinite(retry) && retry > 0) error.retryAfter = Math.min(86400, Math.ceil(retry));
      throw error;
    }
    if (response.status === 204) return null;
    if (!response.headers.get("content-type")?.includes("application/json")) {
      await response.body?.cancel();
      throw new Error("Invalid upstream response.");
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) {
        controller.abort();
        throw new Error("Upstream response limit exceeded.");
      }
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { origin, getJSON };
