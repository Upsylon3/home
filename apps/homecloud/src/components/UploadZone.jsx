import { useRef, useState } from "react";
import { getToken } from "../api.js";

export default function UploadZone({ onUploaded, onError, onActivity, folderId }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  // Each concurrent upload gets its own tracked entry, keyed by a unique id
  // (not filename — two files with the same name uploaded together would
  // otherwise collide). Previously this was a single shared value, so
  // uploading several files at once made the progress bar flicker between
  // them and vanish as soon as any one finished, even if others were still
  // mid-upload.
  const [uploads, setUploads] = useState([]); // { id, name, pct }[]

  function uploadFile(file) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setUploads((prev) => [...prev, { id, name: file.name, pct: 0 }]);

    function updateThis(patch) {
      setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
    }
    function removeThis() {
      setUploads((prev) => prev.filter((u) => u.id !== id));
    }

    const formData = new FormData();
    formData.append("file", file);
    if (folderId) formData.append("folderId", folderId);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files/upload");
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        updateThis({ pct: Math.round((e.loaded / e.total) * 100) });
      }
    };

    xhr.onload = () => {
      removeThis();
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* ignore parse errors, handled below */
      }

      if (xhr.status >= 200 && xhr.status < 300 && body?.file) {
        onActivity?.();
        onUploaded(body.file);
      } else {
        onError?.(body?.error || "Upload failed.");
      }
    };

    xhr.onerror = () => {
      removeThis();
      onError?.("Upload failed — check your connection.");
    };

    xhr.send(formData);
  }

  function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    files.forEach(uploadFile);
  }

  return (
    <div>
      <div
        className={`dropzone ${dragOver ? "dragover" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
      >
        <div>Drop a file here, or click to browse</div>
        <div className="hint">up to 1 GB per file</div>
        <input
          ref={inputRef}
          type="file"
          multiple
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {uploads.map((u) => (
        <div className="upload-progress" key={u.id}>
          <div className="upload-progress-row">
            <span>{u.name}</span>
            <span>{u.pct}%</span>
          </div>
          <div className="gauge-track">
            <div className="gauge-fill" style={{ width: `${u.pct}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
