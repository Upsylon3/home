import { api } from "../api.js";
import { formatBytes, formatDate } from "../utils.js";

export default function FileTable({
  files,
  mode = "active",
  onDelete,
  onRestore,
  onPermanentDelete,
  onActivity,
  onShare,
  onMove,
  onError,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll
}) {
  if (files.length === 0) {
    return (
      <div className="empty-state">
        <span className="glyph">[ ]</span>
        {mode === "trash"
          ? "Trash is empty."
          : "Nothing stored yet. Upload a file above to get started."}
      </div>
    );
  }

  async function handleDownload(file) {
    onActivity?.();
    // A plain navigation lets the browser handle the download with the
    // right filename; the auth token rides along via a short-lived link
    // isn't possible with plain <a>, so we fetch and stream it instead.
    try {
      const res = await fetch(api.downloadUrl(file.id), { headers: api.authHeader() });
      if (!res.ok) {
        onError?.("Couldn't download this file.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      onError?.("Couldn't download this file — check your connection.");
    }
  }

  const selectable = Boolean(selectedIds && onToggleSelect);
  const allSelected = selectable && files.length > 0 && files.every((f) => selectedIds.has(f.id));

  return (
    <table className="file-table">
      <thead>
        <tr>
          {selectable && (
            <th style={{ width: 32 }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleSelectAll}
                aria-label="Select all"
              />
            </th>
          )}
          <th>Name</th>
          <th>Size</th>
          <th>{mode === "trash" ? "Deleted" : "Uploaded"}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {files.map((file) => (
          <tr key={file.id}>
            {selectable && (
              <td>
                <input
                  type="checkbox"
                  checked={selectedIds.has(file.id)}
                  onChange={() => onToggleSelect(file.id)}
                  aria-label={`Select ${file.name}`}
                />
              </td>
            )}
            <td className="file-name">{file.name}</td>
            <td className="file-meta">{formatBytes(file.size)}</td>
            <td className="file-meta">
              {formatDate(mode === "trash" ? file.deletedAt : file.createdAt)}
            </td>
            <td>
              <div className="file-actions">
                {mode === "trash" ? (
                  <>
                    <button
                      className="btn btn-ghost"
                      style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}
                      onClick={() => onRestore(file.id)}
                    >
                      Restore
                    </button>
                    <button className="btn-danger-ghost" onClick={() => onPermanentDelete(file.id)}>
                      Delete forever
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn btn-ghost"
                      style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}
                      onClick={() => handleDownload(file)}
                    >
                      Download
                    </button>
                    {onShare && (
                      <button
                        className="btn btn-ghost"
                        style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}
                        onClick={() => onShare(file)}
                      >
                        Share
                      </button>
                    )}
                    {onMove && (
                      <button
                        className="btn btn-ghost"
                        style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}
                        onClick={() => onMove(file)}
                      >
                        Move
                      </button>
                    )}
                    <button className="btn-danger-ghost" onClick={() => onDelete(file.id)}>
                      Delete
                    </button>
                  </>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
