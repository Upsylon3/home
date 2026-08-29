// Same principle as homemedia-backend and homesync-backend's own clients:
// HomeNotes has no identity of its own, and attachments are real
// HomeCloud files, not something this service stores itself. Identity
// verification lives in packages/homecore-client (this file doesn't need
// HOMECLOUD_URL from there — that's HomeCore's address, for auth; this
// file only ever talks to the separate file-storage service below),
// shared with HomeMedia's and HomeSync's equivalents of this file.
const HOMECLOUD_BACKEND_URL = (process.env.HOMECLOUD_BACKEND_INTERNAL_URL || "http://homecloud-backend:4500").replace(/\/$/, "");

// Used before attaching a file id to a note — HomeNotes has no ownership
// records of its own for HomeCloud files, so this asks HomeCloud (the
// actual owner of that fact) rather than trusting whatever id shows up
// in a request. Same pattern as homemedia-backend's fileExists.
async function fileExists(token, fileId) {
  const res = await fetch(`${HOMECLOUD_BACKEND_URL}/api/homecloud/files/all`, { headers: { Authorization: `Bearer ${token}` } });
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

  const res = await fetch(`${HOMECLOUD_BACKEND_URL}/api/homecloud/files/upload`, {
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

module.exports = { fileExists, uploadFile };
