// Same identity provider as everywhere else, and the same shared login.
// HomeVault's own calls (/api/homevault/*) and HomeCore's shared ones
// (/api/auth/*) are both plain relative fetches — nginx routes each prefix
// to the right backend (see nginx.conf), so the browser never needs to
// know there are two services behind this origin.
//
// Nothing in this file ever sees a plaintext secret — every value that
// crosses this boundary is either already ciphertext or a public KDF
// parameter (see src/crypto.js, which is the only place plaintext
// secrets exist in this entire app, and only ever in memory).
// The login is shared by every Home app — see session.js (copied from
// design/session.js) for how and why. Re-exported so existing
// `import { getToken, setToken } from "./api.js"` lines keep working.
import { getToken, setToken } from "./session.js";
export { getToken, setToken };

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
    window.dispatchEvent(new CustomEvent("homevault:session-expired"));
  }

  let data = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    data = await res.json().catch(() => null);
  }

  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status}).`;
    throw new Error(message);
  }

  return { data, res };
}

export const api = {
  login: (username, password) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  verify2fa: (pendingToken, code) =>
    request("/auth/2fa/verify", { method: "POST", body: JSON.stringify({ pendingToken, code }) }),
  me: () => request("/auth/me"),

  vault: {
    // { exists: false } | { exists: true, vault: {...} }
    get: () => request("/homevault/vault"),
    create: (envelope) => request("/homevault/vault", { method: "POST", body: JSON.stringify(envelope) }),
    rewrap: (envelope) => request("/homevault/vault/rewrap", { method: "PATCH", body: JSON.stringify(envelope) }),
    regenerateRecovery: (envelope) =>
      request("/homevault/vault/regenerate-recovery", { method: "POST", body: JSON.stringify(envelope) }),
    destroy: () => request("/homevault/vault", { method: "DELETE" })
  },

  items: {
    list: () => request("/homevault/vault/items"),
    get: (id) => request(`/homevault/vault/items/${id}`),
    create: (body) => request("/homevault/vault/items", { method: "POST", body: JSON.stringify(body) }),
    update: (id, body) => request(`/homevault/vault/items/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    remove: (id) => request(`/homevault/vault/items/${id}`, { method: "DELETE" })
  }
};
