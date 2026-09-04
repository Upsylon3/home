// Home authenticates against the exact same backend and JWTs as HomeCloud
// (§27: one identity provider, not one per application) — same
// /api/auth/login, same token format. It's a different browser origin than
// HomeCloud's own frontend though (separate dev server / container), so it
// keeps its own localStorage key rather than sharing HomeCloud's. True
// cross-app session sharing needs the reverse-proxy gateway described in
// §25-26, which is future work, not part of this milestone — see
// AppCard's "Launch" behavior for how that limitation shows up in the UI.
const TOKEN_KEY = "home_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`/api${path}`, { ...options, headers });

  if (res.status === 401) {
    setToken(null);
    window.dispatchEvent(new CustomEvent("home:session-expired"));
  }

  let data = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    data = await res.json().catch(() => null);
  }

  if (!res.ok) {
    // Legacy HomeCloud endpoints (/api/auth/*) return { error: "string" };
    // HomeCore endpoints (/api/core/*) return { error: { code, message,
    // requestId } } per §33. Handle both rather than assuming one shape.
    const errorField = data && data.error;
    const message =
      (typeof errorField === "string" && errorField) ||
      (errorField && typeof errorField === "object" && errorField.message) ||
      `Request failed (${res.status}).`;
    const err = new Error(message);
    err.code = errorField && typeof errorField === "object" ? errorField.code : undefined;
    throw err;
  }

  return { data, res };
}

export const api = {
  login: (username, password) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),

  register: (username, password) =>
    request("/auth/register", { method: "POST", body: JSON.stringify({ username, password }) }),

  verify2fa: (pendingToken, code) =>
    request("/auth/2fa/verify", { method: "POST", body: JSON.stringify({ pendingToken, code }) }),

  // HomeCore's own identity view (§7.1) — displayName lives here, not on
  // the legacy /api/auth/me response.
  me: () => request("/core/users/me"),
  updateMe: (displayName) => request("/core/users/me", { method: "PATCH", body: JSON.stringify({ displayName }) }),
  mySessions: () => request("/core/users/me/sessions"),
  logoutEverywhere: () => request("/auth/logout-everywhere", { method: "POST" }),

  health: () => request("/core/health"),
  system: () => request("/core/system"),

  apps: {
    list: () => request("/core/apps"),
    register: (payload) => request("/core/apps", { method: "POST", body: JSON.stringify(payload) }),
    update: (idOrSlug, payload) =>
      request(`/core/apps/${encodeURIComponent(idOrSlug)}`, { method: "PATCH", body: JSON.stringify(payload) }),
    remove: (idOrSlug) => request(`/core/apps/${encodeURIComponent(idOrSlug)}`, { method: "DELETE" })
  },

  permissions: () => request("/core/permissions"),

  // My own recent activity, across every registered application.
  myActivity: (limit = 20) => request(`/core/activity/me?limit=${limit}`),

  notifications: {
    list: () => request("/core/notifications"),
    markRead: (id) => request(`/core/notifications/${id}/read`, { method: "PATCH" })
  },

  // HomeCloud is the one application v0 actually knows details about —
  // this shows real quota usage on its card. Calls apps/homecloud-backend's
  // dedicated GET /api/homecloud/files/quota, same as HomeCloud's own
  // frontend does. There's still no generic "quick stat" field in the
  // application manifest yet (§8) for Home to pull this from any
  // arbitrary app, so this call is intentionally HomeCloud-specific
  // rather than pretending to be generic.
  homecloudQuota: () => request("/homecloud/files/quota")
};
