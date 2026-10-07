// Same identity provider as HomeCloud and Home (§27: one identity
// provider, not one per application) — same /api/auth/login, same JWTs.
// HomeMedia's own domain-specific calls (/api/homemedia/*) and
// HomeCore's shared ones (/api/auth/*) are both plain relative fetches —
// nginx routes each prefix to the right backend (see nginx.conf), so the
// browser never needs to know there are two services behind this one origin.
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

// Uploads one file through HomeMedia (which hands it to HomeCloud for
// storage). Uses XMLHttpRequest instead of fetch() because fetch still has
// no way to report UPLOAD progress, and a progress bar is the difference
// between "it's working" and "is it frozen?" on a 400 MB video.
// Resolves with the stored file, rejects with a message fit to show a person.
export function uploadMedia(file, folderId, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    if (folderId) form.append("folderId", String(folderId));
    form.append("file", file); // the file goes last; fields before it are read first

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/homemedia/upload");
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error("Network error — the upload didn't finish."));
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // not JSON: fall through to the generic message below
      }
      if (xhr.status === 401) {
        setToken(null);
        window.dispatchEvent(new CustomEvent("homemedia:session-expired"));
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data?.file);
      else reject(new Error((data && data.error) || `Upload failed (${xhr.status}).`));
    };
    xhr.send(form);
  });
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
  // Asks for a short-lived link a <video>/<audio>/<img> tag can load
  // directly (those tags can't send a login header). See
  // homemedia-backend/src/stream.js for how tickets work.
  mediaTicket: async (fileId) => (await request(`/homemedia/${fileId}/ticket`, { method: "POST" })).data.url,
  uploadFolder: async () => (await request("/homemedia/upload-folder")).data.folderId,

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
