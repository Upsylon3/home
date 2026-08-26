// HomeMedia has no identity or storage of its own — HomeCore's principle
// of one identity provider (not one per application) means every request
// here is authenticated by asking HomeCloud, and every photo/video byte
// comes from HomeCloud's storage, fetched on demand. This module is the
// one place that talks to HomeCloud over the network for HomeMedia's OWN
// concerns (listing/downloading files); identity verification itself
// (verifyUser, the /api/auth/me cache) now lives in
// packages/homecore-client, shared with HomeSync's and HomeNotes'
// equivalents of this file — see that package's src/verify.js for why.
const { HOMECLOUD_URL } = require("@home/homecore-client");

// type: "image" | "video" | undefined (undefined = both, requested as two
// separate calls since HomeCloud's /api/files/all only filters one prefix
// at a time).
async function listFiles(token, type) {
  const url = new URL("/api/files/all", HOMECLOUD_URL);
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

// Returns null for a 404 (file doesn't exist, was deleted, or isn't this
// user's) so callers can treat "not found" as an ordinary case rather
// than an exception.
async function downloadFile(token, fileId) {
  let res;
  try {
    res = await fetch(`${HOMECLOUD_URL}/api/files/${fileId}/download`, {
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

module.exports = { listFiles, downloadFile, fileExists };
