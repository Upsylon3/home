// Same principle as homemedia-backend/src/homecloudClient.js: HomeSync has
// no identity or storage of its own. Every request is authenticated by
// asking HomeCloud, and every backed-up file is actually stored by
// uploading it straight through to HomeCloud's own upload endpoint —
// HomeSync's own database only ever tracks what's already been sent, for
// dedup and backup history, never the bytes themselves.
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

async function listFoldersFlat(token) {
  const res = await fetch(`${HOMECLOUD_URL}/api/folders/all`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = new Error("Couldn't reach HomeCloud to list folders.");
    err.status = 502;
    throw err;
  }
  const { folders } = await res.json();
  return folders; // [{ id, name, parentId }]
}

async function createFolder(token, name, parentId) {
  const res = await fetch(`${HOMECLOUD_URL}/api/folders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, parentId: parentId ?? undefined })
  });
  // 409 means another concurrent upload already created this exact folder
  // a moment ago — not a real failure, just re-fetch and use it instead.
  if (res.status === 409) return null;
  if (!res.ok) {
    const err = new Error("Couldn't reach HomeCloud to create a folder.");
    err.status = 502;
    throw err;
  }
  const { folder } = await res.json();
  return folder.id;
}

// Resolves a category/date path like ["Photos", "2026", "August"] to a
// HomeCloud folder id, creating whichever segments don't exist yet — a
// small "mkdir -p". Cached briefly per user, since a single backup run
// uploads many files into the same handful of month folders in a row and
// re-listing HomeCloud's entire folder tree for every single one would be
// wasteful.
const pathCache = new Map(); // `${userId}:${path.join("/")}` -> { folderId, expiresAt }
const PATH_CACHE_TTL_MS = 60_000;

async function resolveFolderPath(token, userId, segments) {
  const cacheKey = `${userId}:${segments.join("/")}`;
  const cached = pathCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.folderId;

  const allFolders = await listFoldersFlat(token);
  let parentId = null;

  for (const segment of segments) {
    let match = allFolders.find((f) => f.parentId === parentId && f.name.toLowerCase() === segment.toLowerCase());
    if (!match) {
      const newId = await createFolder(token, segment, parentId);
      if (newId !== null) {
        match = { id: newId, name: segment, parentId };
        allFolders.push(match);
      } else {
        // Someone else just created it (409) — re-fetch to find it rather
        // than guessing its id.
        const refreshed = await listFoldersFlat(token);
        match = refreshed.find((f) => f.parentId === parentId && f.name.toLowerCase() === segment.toLowerCase());
        if (!match) throw new Error(`Couldn't resolve or create folder "${segment}".`);
      }
    }
    parentId = match.id;
  }

  pathCache.set(cacheKey, { folderId: parentId, expiresAt: Date.now() + PATH_CACHE_TTL_MS });
  return parentId;
}

async function uploadFile(token, { buffer, filename, mimetype, folderId }) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimetype || "application/octet-stream" }), filename);
  if (folderId !== null && folderId !== undefined) form.append("folderId", String(folderId));

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

module.exports = { verifyUser, listFoldersFlat, createFolder, resolveFolderPath, uploadFile, HOMECLOUD_URL };
