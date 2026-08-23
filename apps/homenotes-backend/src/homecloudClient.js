// Same principle as homemedia-backend and homesync-backend's own clients:
// HomeNotes has no identity of its own, and attachments are real
// HomeCloud files, not something this service stores itself.
const HOMECLOUD_URL = (process.env.HOMECLOUD_INTERNAL_URL || "http://backend:4000").replace(/\/$/, "");

const meCache = new Map(); // token -> { user, expiresAt }
const ME_CACHE_TTL_MS = 5000;

async function verifyUser(token) {
  const cached = meCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  let res;
  try {
    res = await fetch(`${HOMECLOUD_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  } catch (err) {
    const wrapped = new Error("Couldn't reach HomeCloud to verify this session.");
    wrapped.status = 502;
    throw wrapped;
  }
  if (!res.ok) {
    meCache.delete(token);
    return null;
  }
  const user = await res.json();
  meCache.set(token, { user, expiresAt: Date.now() + ME_CACHE_TTL_MS });
  return user;
}

// Used before attaching a file id to a note — HomeNotes has no ownership
// records of its own for HomeCloud files, so this asks HomeCloud (the
// actual owner of that fact) rather than trusting whatever id shows up
// in a request. Same pattern as homemedia-backend's fileExists.
async function fileExists(token, fileId) {
  const res = await fetch(`${HOMECLOUD_URL}/api/files/all`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = new Error("Couldn't reach HomeCloud to check that file.");
    err.status = 502;
    throw err;
  }
  const { files } = await res.json();
  return files.some((f) => f.id === fileId);
}

async function uploadFile(token, { buffer, filename, mimetype }) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimetype || "application/octet-stream" }), filename);

  const res = await fetch(`${HOMECLOUD_URL}/api/files/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && data.error) || "HomeCloud rejected the upload.");
    err.status = res.status === 413 ? 413 : res.status === 401 ? 401 : 502;
    throw err;
  }
  return data.file;
}

module.exports = { verifyUser, fileExists, uploadFile, HOMECLOUD_URL };
