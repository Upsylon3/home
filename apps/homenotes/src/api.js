// Same identity provider as everywhere else (§27) — different browser
// origin from HomeCloud/Home/HomeMedia, so its own localStorage key, same
// as each of those. HomeNotes' own calls (/api/homenotes/*) and
// HomeCloud's shared ones (/api/auth/*, /api/files/*) are both plain
// relative fetches — nginx routes each prefix to the right backend (see
// nginx.conf), so the browser never needs to know there are two services
// behind this one origin.
const TOKEN_KEY = "homenotes_token";

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
    window.dispatchEvent(new CustomEvent("homenotes:session-expired"));
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

function qs(params = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  const s = new URLSearchParams(clean).toString();
  return s ? `?${s}` : "";
}

export const api = {
  login: (username, password) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  verify2fa: (pendingToken, code) =>
    request("/auth/2fa/verify", { method: "POST", body: JSON.stringify({ pendingToken, code }) }),
  me: () => request("/auth/me"),

  folders: {
    list: (parentId) => request(`/homenotes/note-folders${qs({ parentId })}`),
    all: () => request("/homenotes/note-folders/all"),
    create: (name, parentId) =>
      request("/homenotes/note-folders", { method: "POST", body: JSON.stringify({ name, parentId }) }),
    rename: (id, name) => request(`/homenotes/note-folders/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    move: (id, parentId) => request(`/homenotes/note-folders/${id}`, { method: "PATCH", body: JSON.stringify({ parentId }) }),
    remove: (id, force) => request(`/homenotes/note-folders/${id}${qs({ force })}`, { method: "DELETE" })
  },

  notes: {
    list: (params) => request(`/homenotes/notes${qs(params)}`),
    trash: () => request("/homenotes/notes/trash"),
    get: (id) => request(`/homenotes/notes/${id}`),
    create: (body) => request("/homenotes/notes", { method: "POST", body: JSON.stringify(body) }),
    update: (id, body) => request(`/homenotes/notes/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    remove: (id) => request(`/homenotes/notes/${id}`, { method: "DELETE" }),
    restore: (id) => request(`/homenotes/notes/${id}/restore`, { method: "POST" }),
    removePermanent: (id) => request(`/homenotes/notes/${id}/permanent`, { method: "DELETE" }),
    versions: (id) => request(`/homenotes/notes/${id}/versions`),
    restoreVersion: (id, versionId) => request(`/homenotes/notes/${id}/versions/${versionId}/restore`, { method: "POST" }),
    uploadAttachment: (id, formData) => request(`/homenotes/notes/${id}/attachments`, { method: "POST", body: formData }),
    linkAttachment: (id, fileId, name) =>
      request(`/homenotes/notes/${id}/attachments/link`, { method: "POST", body: JSON.stringify({ fileId, name }) }),
    removeAttachment: (id, fileId) => request(`/homenotes/notes/${id}/attachments/${fileId}`, { method: "DELETE" })
  },

  tags: {
    list: () => request("/homenotes/tags")
  }
};
