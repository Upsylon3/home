// HomeMedia has no identity or storage of its own — HomeCore's principle
// of one identity provider (not one per application) means every request
// here is authenticated by asking HomeCore, and every photo/video byte
// comes from apps/homecloud-backend's storage, fetched on demand. This
// module is the one place that talks to HomeCloud over the network for
// HomeMedia's OWN concerns (listing/downloading files); identity
// verification itself (verifyUser, the /api/auth/me cache) now lives in
// packages/homecore-client, shared with HomeSync's and HomeNotes'
// equivalents of this file — see that package's src/verify.js for why.
//
// Two separate URLs, deliberately not one: "where do I verify a token"
// and "where do I fetch a file" are two different services. HOMECORE_URL
// (from packages/homecore-client) answers the first; HOMECLOUD_BACKEND_URL
// below answers the second. Conflating them would silently break every
// file operation the moment apps/homecloud-backend's address differs
// from HomeCore's, which it always does.
const { HOMECORE_URL } = require("@home/homecore-client");
const { kindOfFile } = require("./mediaKinds");
const HOMECLOUD_BACKEND_URL = (process.env.HOMECLOUD_BACKEND_INTERNAL_URL || "http://homecloud-backend:4500").replace(/\/$/, "");

// type: "image" | "video" | undefined (undefined = both, requested as two
// separate calls since HomeCloud's /api/homecloud/files/all only filters
// one prefix at a time).
async function listFiles(token, type) {
  const url = new URL("/api/homecloud/files/all", HOMECLOUD_BACKEND_URL);
  if (type) url.searchParams.set("type", type);
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (err) {
    const wrapped = new Error("Couldn't reach HomeCloud to list files.");
    wrapped.status = 502;
    throw wrapped;
  }
  if (!res.ok) {
    const err = new Error("HomeCloud rejected the file listing request.");
    err.status = res.status === 401 ? 401 : 502;
    throw err;
  }
  return res.json();
}

// Every photo, video and song the user has, from any folder.
//
// HomeCloud's /files/all can only filter by ONE top-level mimetype at a
// time, so this makes four small calls in parallel: one per media type,
// plus "application" — the bucket HomeCloud files land in when the browser
// didn't know their type (see mediaKinds.js for why that happens). Files
// from that last bucket are kept only if their extension says they're
// media. The `kind` field on each result is HomeMedia's own judgement.
async function listMediaFiles(token) {
  const [images, videos, audio, other] = await Promise.all(
    ["image", "video", "audio", "application"].map((t) => listFiles(token, t))
  );
  return [...images.files, ...videos.files, ...audio.files, ...other.files]
    .map((f) => ({ ...f, kind: kindOfFile(f) }))
    .filter((f) => f.kind !== null);
}

// Unlike downloadFile() below, this does NOT read the file into memory: it
// hands back HomeCloud's raw response so the caller can pipe it straight
// to the browser. That matters for video and music — a 600 MB film must
// start playing right away, not after HomeMedia has buffered all of it.
// `range` is the browser's "Range: bytes=..." header (what makes seeking
// work); HomeCloud answers it with a 206 partial response and we pass that
// along untouched.
async function openFileStream(token, fileId, { range, signal } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (range) headers.Range = range;
  try {
    return await fetch(`${HOMECLOUD_BACKEND_URL}/api/homecloud/files/${fileId}/download`, { headers, signal });
  } catch (err) {
    if (err.name === "AbortError") throw err; // the viewer closed the tab — not an error worth wrapping
    const wrapped = new Error("Couldn't reach HomeCloud to stream the file.");
    wrapped.status = 502;
    throw wrapped;
  }
}

// ---- Uploading --------------------------------------------------------
//
// Uploads from HomeMedia are stored by HomeCloud exactly like any other
// upload (same quota, same 1 GB limit, same activity log). HomeMedia
// keeps nothing — it only picks a tidy destination folder and passes the
// bytes through.

// Finds (or creates) a top-level HomeCloud folder by name and returns its
// id. Same idea as HomeSync's resolveFolderPath, but only ever one level
// deep, so it is simpler than that version.
async function ensureRootFolder(token, name) {
  const headers = { Authorization: `Bearer ${token}` };
  const list = async () => {
    const res = await fetch(`${HOMECLOUD_BACKEND_URL}/api/homecloud/folders/all`, { headers });
    if (!res.ok) {
      const err = new Error("Couldn't reach HomeCloud to list folders.");
      err.status = 502;
      throw err;
    }
    return (await res.json()).folders;
  };
  const find = (folders) =>
    folders.find((f) => (f.parentId ?? null) === null && f.name.toLowerCase() === name.toLowerCase());

  const existing = find(await list());
  if (existing) return existing.id;

  const created = await fetch(`${HOMECLOUD_BACKEND_URL}/api/homecloud/folders`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (created.ok) return (await created.json()).folder.id;

  // 409 = two uploads raced to create the same folder and the other one
  // won. Not a failure: look it up again and use theirs.
  if (created.status === 409) {
    const raced = find(await list());
    if (raced) return raced.id;
  }
  const err = new Error("Couldn't create the HomeMedia folder in HomeCloud.");
  err.status = 502;
  throw err;
}

// Forwards the browser's multipart upload to HomeCloud WITHOUT parsing it.
// `body` is the incoming request itself (a stream) and `contentType` is
// its original header, which carries the multipart "boundary" HomeCloud
// needs to split the body back into fields. Because nothing is parsed or
// buffered here, HomeMedia needs no upload library and uses almost no
// memory even for a 1 GB video.
async function forwardUpload(token, body, contentType) {
  return fetch(`${HOMECLOUD_BACKEND_URL}/api/homecloud/files/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
    duplex: "half" // Node requires this flag whenever the request body is a stream
  });
}

// Returns null for a 404 (file doesn't exist, was deleted, or isn't this
// user's) so callers can treat "not found" as an ordinary case rather
// than an exception.
async function downloadFile(token, fileId) {
  let res;
  try {
    res = await fetch(`${HOMECLOUD_BACKEND_URL}/api/homecloud/files/${fileId}/download`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch (err) {
    const wrapped = new Error("Couldn't reach HomeCloud to download the file.");
    wrapped.status = 502;
    throw wrapped;
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error("HomeCloud rejected the file download request.");
    err.status = 502;
    throw err;
  }
  const arrayBuffer = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: res.headers.get("content-type") || "application/octet-stream"
  };
}

// Used before letting someone favorite/album a file id — HomeMedia has no
// ownership records of its own, so this asks HomeCloud (the actual owner
// of that fact) rather than trusting whatever id shows up in a request.
async function fileExists(token, fileId) {
  const { files } = await listFiles(token);
  return files.some((f) => f.id === fileId);
}

module.exports = { listFiles, listMediaFiles, openFileStream, ensureRootFolder, forwardUpload, downloadFile, fileExists };
