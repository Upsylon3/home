// Same identity provider as HomeCloud and Home (§27: one identity
// provider, not one per application) — same /api/auth/login, same JWTs.
// Different browser origin from either of them though, so it keeps its
// own localStorage key rather than assuming a shared one; see Home's
// api.js for the same note. HomeMedia's own domain-specific calls
// (/api/homemedia/*) and HomeCloud's shared ones (/api/auth/*,
// /api/files/*) are both plain relative fetches — nginx routes each
// prefix to the right backend (see nginx.conf), so the browser never
// needs to know there are two services behind this one origin.
const TOKEN_KEY = "homemedia_token";

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
    window.dispatchEvent(new CustomEvent("homemedia:session-expired"));
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

// Plain <img src="..."> can't attach an Authorization header, and putting
// the token in the URL instead (a common shortcut) leaks it into browser
// history and server logs — not a trade worth making. fetchImageBlob does
// a normal authenticated fetch and hands back an object URL instead; see
// components/AuthImage.jsx for the component that manages its lifecycle.
export async function fetchImageBlob(url) {
  const token = getToken();
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (res.status === 401) {
    setToken(null);
    window.dispatchEvent(new CustomEvent("homemedia:session-expired"));
  }
  if (!res.ok) throw new Error(`Couldn't load image (${res.status}).`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export const api = {
  login: (username, password) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  verify2fa: (pendingToken, code) =>
    request("/auth/2fa/verify", { method: "POST", body: JSON.stringify({ pendingToken, code }) }),
  me: () => request("/auth/me"),

  library: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/homemedia/library${qs ? `?${qs}` : ""}`);
  },
  exif: (fileId) => request(`/homemedia/${fileId}/exif`),
  thumbnailUrl: (fileId) => `/api/homemedia/${fileId}/thumbnail`,
  fullImageUrl: (fileId) => `/api/files/${fileId}/download`,

  favorite: (fileId) => request(`/homemedia/favorites/${fileId}`, { method: "POST" }),
  unfavorite: (fileId) => request(`/homemedia/favorites/${fileId}`, { method: "DELETE" }),

  albums: {
    list: () => request("/homemedia/albums"),
    create: (name) => request("/homemedia/albums", { method: "POST", body: JSON.stringify({ name }) }),
    get: (id) => request(`/homemedia/albums/${id}`),
    rename: (id, name) => request(`/homemedia/albums/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    setCover: (id, coverFileId) =>
      request(`/homemedia/albums/${id}`, { method: "PATCH", body: JSON.stringify({ coverFileId }) }),
    remove: (id) => request(`/homemedia/albums/${id}`, { method: "DELETE" }),
    addItems: (id, fileIds) =>
      request(`/homemedia/albums/${id}/items`, { method: "POST", body: JSON.stringify({ fileIds }) }),
    removeItem: (id, fileId) => request(`/homemedia/albums/${id}/items/${fileId}`, { method: "DELETE" })
  }
};
