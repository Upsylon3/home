import { useCallback, useEffect, useRef, useState } from "react";
import { api, uploadMedia } from "../api.js";
import { UploadGlyph } from "./icons.jsx";

// Extensions we accept even when the browser reports no type for them
// (see homemedia-backend/src/mediaKinds.js for why that happens). Kept in
// step with that file's list by hand: it's short, and this one only decides
// what the file picker offers — the server is the one that really sorts files.
const MEDIA_EXTENSIONS = /\.(jpe?g|png|gif|webp|avif|bmp|tiff?|heic|mp4|m4v|mov|webm|mkv|avi|ogv|mp3|m4a|aac|flac|wav|ogg|oga|opus)$/i;

function isMedia(file) {
  return /^(image|video|audio)\//.test(file.type) || MEDIA_EXTENSIONS.test(file.name);
}

// The "Upload" button, plus drag-and-drop anywhere on the page. Uploads one
// file at a time: simpler to follow in the progress list, and it avoids
// saturating a home connection with several huge videos at once.
export default function Uploader({ onDone }) {
  const inputRef = useRef(null);
  const [items, setItems] = useState([]); // [{ key, name, progress, error, done }]
  const [dragging, setDragging] = useState(false);
  const busy = useRef(false);

  const patch = (key, changes) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...changes } : it)));

  const start = useCallback(
    async (fileList) => {
      if (busy.current) return; // a batch is already running; ignore a second drop mid-way
      const all = Array.from(fileList);
      const files = all.filter(isMedia);
      const skipped = all.length - files.length;

      const rows = files.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.name, progress: 0, error: "", done: false }));
      if (skipped > 0) {
        rows.push({ key: `skip-${Date.now()}`, name: `${skipped} file${skipped > 1 ? "s" : ""} skipped`, progress: 0, error: "Only photos, videos and music can be added here.", done: false });
      }
      setItems(rows);
      if (files.length === 0) return;

      busy.current = true;
      try {
        const folderId = await api.uploadFolder();
        for (let i = 0; i < files.length; i++) {
          try {
            await uploadMedia(files[i], folderId, (p) => patch(rows[i].key, { progress: p }));
            patch(rows[i].key, { progress: 1, done: true });
          } catch (err) {
            // One failure (too big, over quota) shouldn't stop the rest.
            patch(rows[i].key, { error: err.message });
          }
        }
      } catch (err) {
        setItems((prev) => prev.map((it) => (it.done ? it : { ...it, error: err.message })));
      } finally {
        busy.current = false;
        onDone?.(); // refresh the library so new files appear
      }
    },
    [onDone]
  );

  // Page-wide drag-and-drop. Listening on window (not on one element)
  // means dropping a file anywhere on the page works.
  useEffect(() => {
    let depth = 0; // dragenter/leave fire for every child element, so count them
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
    const enter = (e) => { if (hasFiles(e)) { depth++; setDragging(true); } };
    const leave = (e) => { if (hasFiles(e)) { depth = Math.max(0, depth - 1); if (depth === 0) setDragging(false); } };
    const over = (e) => { if (hasFiles(e)) e.preventDefault(); }; // required, or the browser refuses the drop
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      start(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [start]);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept="image/*,video/*,audio/*,.mkv,.flac,.m4a,.opus,.heic"
        onChange={(e) => {
          start(e.target.files);
          e.target.value = ""; // so picking the same file again still fires onChange
        }}
      />
      <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>
        <UploadGlyph size={15} /> Upload
      </button>

      {dragging && <div className="drop-overlay">Drop photos, videos or music to add them</div>}

      {items.length > 0 && (
        <ul className="upload-list" aria-live="polite">
          {items.map((it) => (
            <li key={it.key} className={it.error ? "upload-item is-error" : "upload-item"}>
              <span className="upload-item-name">{it.name}</span>
              <span className="upload-item-status">
                {it.error ? it.error : it.done ? "Added" : `${Math.round(it.progress * 100)}%`}
              </span>
              {!it.error && !it.done && (
                <progress value={it.progress} max="1" className="upload-item-bar" />
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
