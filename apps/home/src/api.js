// Home authenticates against the exact same backend and JWTs as every
// other app (§27: one identity provider, not one per application) — same
// /api/auth/login, same token format — and, behind the gateway, the same
// browser origin, so it shares one stored login with them too.
// The login is shared by every Home app — see session.js (copied from
// design/session.js) for how and why. Re-exported so existing
// `import { getToken, setToken } from "./api.js"` lines keep working.
import { getToken, setToken } from "./session.js";
export { getToken, setToken };

async function request(path, options = {}) {
  const { keepSessionOn401 = false, ...fetchOptions } = options;
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`/api${path}`, { ...fetchOptions, headers });

  // Sensitive operations also return 401 for a bad password or TOTP code.
  // Ask Core whether the original session is still valid before expiring it.
  // A failed network/proxy check is inconclusive and must allow retry.
  let expired = res.status === 401;
  if (expired && keepSessionOn401 && token) {
    try {
      const session = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      expired = session.status === 401;
    } catch { expired = false; }
  }
  // A late response from a revoked token must not clear a renewed session.
  if (expired && getToken() === token) {
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
  applicationAccess: {
    list: () => request('/core/application-access'),
    create: (applicationSlug, permissions) => request('/core/application-access', {
      method: 'POST', body: JSON.stringify({ applicationSlug, permissions, consent: true })
    }),
    revoke: id => request(`/core/application-access/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  accountAdmin: {
    users: () => request("/admin/users"),
    resetPassword: (id, newPassword) => request(`/admin/users/${encodeURIComponent(id)}/reset-password`, { method: "POST", body: JSON.stringify({ newPassword }) }),
    setDisabled: (id, disabled) => request(`/admin/users/${encodeURIComponent(id)}/disabled`, { method: "POST", body: JSON.stringify({ disabled }) }),
    setRole: (id, role) => request(`/admin/users/${encodeURIComponent(id)}/role`, { method: "POST", body: JSON.stringify({ role }) }),
    setQuota: (id, quotaBytes) => request(`/admin/users/${encodeURIComponent(id)}/quota`, { method: "POST", body: JSON.stringify({ quotaBytes }) }),
    disable2fa: id => request(`/admin/users/${encodeURIComponent(id)}/2fa/disable`, { method: "POST" })
  },
  vaultAdmin: {
    users: () => request("/core/admin/users"),
    status: id => request(`/homevault/admin/users/${encodeURIComponent(id)}/vault`),
    reset: (id, vaultId, confirmation) => request(`/homevault/admin/users/${encodeURIComponent(id)}/vault`, {
      method: "DELETE", body: JSON.stringify({ vaultId, confirmation })
    })
  },
  automation: {
    status: () => request("/homebridge/automation"),
    enroll: () => request("/homebridge/automation/enroll", { method: "POST", body: JSON.stringify({ consent: true }) }),
    disable: () => request("/homebridge/automation/disable", { method: "POST", body: "{}" }),
    grants: () => request("/core/delegations"),
    revoke: id => request(`/core/delegations/${encodeURIComponent(id)}`, { method: "DELETE" })
  },
  search: (query, sources, signal) => request("/homebridge/search", {
    method: "POST", body: JSON.stringify({ query, sources }), signal
  }),
  login: (username, password) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),

  registration: () => request("/auth/registration"),

  register: (username, password, setupCode) =>
    request("/auth/register", { method: "POST", body: JSON.stringify({ username, password, setupCode }) }),

  verify2fa: (pendingToken, code) =>
    request("/auth/2fa/verify", { method: "POST", body: JSON.stringify({ pendingToken, code }) }),

  // HomeCore's own identity view (§7.1) — displayName lives here, not on
  // the legacy /api/auth/me response.
  me: () => request("/core/users/me"),
  updateMe: (displayName) => request("/core/users/me", { method: "PATCH", body: JSON.stringify({ displayName }) }),
  mySessions: () => request("/core/users/me/sessions"),
  logoutEverywhere: () => request("/auth/logout-everywhere", { method: "POST" }),
  twoFactor: {
    status: () => request("/auth/me"),
    setup: () => request("/auth/2fa/setup", { method: "POST" }),
    confirm: code => request("/auth/2fa/confirm", { method: "POST", body: JSON.stringify({ code }), keepSessionOn401: true }),
    disable: password => request("/auth/2fa/disable", { method: "POST", body: JSON.stringify({ password }), keepSessionOn401: true }),
    regenerate: password => request("/auth/2fa/recovery-codes", { method: "POST", body: JSON.stringify({ password }), keepSessionOn401: true })
  },
  changePassword: (currentPassword, newPassword) => request("/auth/change-password", {
    method: "POST", body: JSON.stringify({ currentPassword, newPassword }), keepSessionOn401: true
  }),

  health: () => request("/core/health"),
  system: () => request("/core/system"),

  apps: {
    list: () => request("/core/apps"),
    catalog: () => request("/core/app-catalog"),
    install: slug => request(`/core/apps/${encodeURIComponent(slug)}/install`, { method: "POST", body: "{}" }),
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
