const TOKEN_KEY = "homecloud_token";

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
    // Nothing here has access to React state/routing directly, so this
    // lets App.jsx know the session just ended (expired, revoked by
    // "sign out everywhere," or the account got disabled) and redirect to
    // login — instead of silently leaving stale screens up while every
    // further request quietly fails with the same 401.
    window.dispatchEvent(new CustomEvent("homecloud:session-expired"));
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
  register: (username, password) =>
    request("/auth/register", { method: "POST", body: JSON.stringify({ username, password }) }),

  login: (username, password) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),

  verify2fa: (pendingToken, code) =>
    request("/auth/2fa/verify", { method: "POST", body: JSON.stringify({ pendingToken, code }) }),

  setup2fa: () => request("/auth/2fa/setup", { method: "POST" }),

  confirm2fa: (code) => request("/auth/2fa/confirm", { method: "POST", body: JSON.stringify({ code }) }),

  disable2fa: (password) => request("/auth/2fa/disable", { method: "POST", body: JSON.stringify({ password }) }),

  regenerateRecoveryCodes: (password) =>
    request("/auth/2fa/recovery-codes", { method: "POST", body: JSON.stringify({ password }) }),

  me: () => request("/auth/me"),

  changePassword: (currentPassword, newPassword) =>
    request("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword })
    }),

  logoutEverywhere: () => request("/auth/logout-everywhere", { method: "POST" }),

  listFiles: (folderId) => request(`/files${folderId ? `?folderId=${folderId}` : ""}`),

  listTrash: () => request("/files/trash"),

  deleteFile: (id) => request(`/files/${id}`, { method: "DELETE" }),

  restoreFile: (id) => request(`/files/${id}/restore`, { method: "POST" }),

  permanentlyDeleteFile: (id) => request(`/files/${id}/permanent`, { method: "DELETE" }),

  moveFile: (id, folderId) => request(`/files/${id}/move`, { method: "POST", body: JSON.stringify({ folderId }) }),

  downloadUrl: (id) => `/api/files/${id}/download`,

  thumbnailUrl: (id) => `/api/files/${id}/thumbnail`,

  createShare: (fileId, expiresInDays) =>
    request(`/files/${fileId}/share`, { method: "POST", body: JSON.stringify({ expiresInDays }) }),

  listShares: () => request("/files/shares"),

  revokeShare: (shareId) => request(`/files/shares/${shareId}`, { method: "DELETE" }),

  shareUrl: (token) => `${window.location.origin}/api/share/${token}`,

  // Batch zip download returns binary data, not JSON, so it bypasses the
  // generic request() helper and is handled directly where it's used
  // (Dashboard.jsx) via fetch + blob().
  downloadBatchUrl: () => `/api/files/download-batch`,

  myActivity: () => request("/activity"),

  folders: {
    list: (parentId) => request(`/folders${parentId ? `?parentId=${parentId}` : ""}`),

    listAll: () => request("/folders/all"),

    create: (name, parentId) => request("/folders", { method: "POST", body: JSON.stringify({ name, parentId }) }),

    rename: (id, name) => request(`/folders/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),

    move: (id, parentId) => request(`/folders/${id}/move`, { method: "POST", body: JSON.stringify({ parentId }) }),

    remove: (id, force) => request(`/folders/${id}${force ? "?force=true" : ""}`, { method: "DELETE" })
  },

  // Upload uses XHR directly (in UploadZone) so we can report progress;
  // this helper builds the auth header it needs.
  authHeader: () => {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },

  admin: {
    listUsers: () => request("/admin/users"),

    resetPassword: (userId, newPassword) =>
      request(`/admin/users/${userId}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ newPassword })
      }),

    setDisabled: (userId, disabled) =>
      request(`/admin/users/${userId}/disabled`, {
        method: "POST",
        body: JSON.stringify({ disabled })
      }),

    setQuota: (userId, quotaBytes) =>
      request(`/admin/users/${userId}/quota`, {
        method: "POST",
        body: JSON.stringify({ quotaBytes })
      }),

    setRole: (userId, role) =>
      request(`/admin/users/${userId}/role`, {
        method: "POST",
        body: JSON.stringify({ role })
      }),

    disable2fa: (userId) => request(`/admin/users/${userId}/2fa/disable`, { method: "POST" }),

    activity: () => request("/admin/activity")
  }
};
