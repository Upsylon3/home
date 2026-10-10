// Is each Home service up? We ask every app's health endpoint and time the answer.
//
// Where the list comes from: HomeCore's app registry (Tier 0), through its
// /internal/apps endpoint. Each registered app has a health path such as
// "/api/hometasks/health". HomeCore itself isn't in that list, so it is added
// by hand.
//
// "Up", "degraded" and "down" are decided by interpretHealth, a pure function.

// Decide the status from what a health endpoint answered.
//   httpStatus  the HTTP status code (200, 503, ...)
//   bodyText    the response body (usually JSON like {"status":"healthy"})
// Returns "up", "degraded" or "down".
function interpretHealth(httpStatus, bodyText) {
  let word = "";
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed && typeof parsed.status === "string") word = parsed.status.toLowerCase();
  } catch {
    // Not JSON (or empty): fine, the HTTP code alone decides.
  }

  if (word === "degraded") return "degraded";
  if (httpStatus >= 400) return "down";
  if (["unhealthy", "down", "error", "failed"].includes(word)) return "down";
  return "up";
}

// Work out the full URL to call for one app, or null if we don't know where it is.
function resolveHealthUrl(slug, healthUrl, config) {
  if (/^https?:\/\//.test(healthUrl)) return healthUrl; // already a full address
  const base = config.serviceUrls[slug] || config.gatewayUrl;
  return base ? `${base}${healthUrl}` : null;
}

// Check one service. Never throws: any failure is reported AS the result,
// because "can't reach it" is exactly what we are here to notice.
async function checkService({ slug, name, url }, { fetchFn = fetch, timeoutMs = 3000, now = Date.now } = {}) {
  const checkedAt = new Date(now()).toISOString();
  if (!url) {
    return { slug, name, status: "unknown", latencyMs: null, checkedAt, detail: "No address configured (set GATEWAY_URL or SERVICE_URLS)." };
  }

  const started = now();
  try {
    // AbortSignal.timeout cancels the request if it takes too long, so one
    // hung service can't freeze the whole check.
    const response = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    const status = interpretHealth(response.status, text);
    return { slug, name, status, latencyMs: now() - started, checkedAt, detail: status === "up" ? null : `HTTP ${response.status}` };
  } catch (err) {
    const timedOut = err && (err.name === "TimeoutError" || err.name === "AbortError");
    const cause = err && err.cause && err.cause.code;
    return { slug, name, status: "down", latencyMs: null, checkedAt, detail: timedOut ? "Timed out" : cause || err.message || "Unreachable" };
  }
}

// Check everything: HomeCore itself, then every enabled registered app that
// has a health path. Returns { services, registryError }.
async function checkAllServices(config, { fetchFn = fetch, now = Date.now } = {}) {
  const options = { fetchFn, timeoutMs: config.checkTimeoutMs, now };
  const targets = [{ slug: "homecore", name: "HomeCore", url: `${config.homecoreUrl}/api/core/health` }];
  let registryError = null;

  try {
    const response = await fetchFn(`${config.homecoreUrl}/internal/apps`, {
      headers: { "X-Internal-Secret": config.internalSecret },
      signal: AbortSignal.timeout(config.checkTimeoutMs)
    });
    if (!response.ok) throw new Error(`HomeCore answered ${response.status}`);
    const { apps } = await response.json();
    for (const app of apps) {
      if (!app.enabled || !app.healthUrl) continue; // disabled, or nothing to check (e.g. the dashboard)
      targets.push({ slug: app.slug, name: app.name, url: resolveHealthUrl(app.slug, app.healthUrl, config) });
    }
  } catch (err) {
    registryError = `Couldn't read the app list from HomeCore: ${err.message}`;
  }

  // All checks run at once, so total time is the slowest one, not the sum.
  const services = await Promise.all(targets.map((target) => checkService(target, options)));
  return { services, registryError };
}

module.exports = { interpretHealth, resolveHealthUrl, checkService, checkAllServices };
