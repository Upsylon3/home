import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, setToken } from "../api.js";
import StorageGauge from "../components/StorageGauge.jsx";
import ActivityLED from "../components/ActivityLED.jsx";
import UploadZone from "../components/UploadZone.jsx";
import FileTable from "../components/FileTable.jsx";
import ShareDialog from "../components/ShareDialog.jsx";
import MoveDialog from "../components/MoveDialog.jsx";
import Breadcrumb from "../components/Breadcrumb.jsx";
import FolderGrid from "../components/FolderGrid.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";
import { formatBytes, formatDate } from "../utils.js";

const selectStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "8px 10px",
  color: "var(--text)",
  fontSize: 13,
  fontFamily: "var(--font-mono)"
};

export default function Dashboard({ user, onLogout }) {
  const [files, setFiles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [breadcrumb, setBreadcrumb] = useState([]);
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [trash, setTrash] = useState([]);
  const [shares, setShares] = useState([]);
  const [tab, setTab] = useState("files"); // "files" | "trash" | "shares"
  const [me, setMe] = useState(user);
  // Usage/quota comes from apps/homecloud-backend, not /api/auth/me —
  // kept as its own state, matching App.jsx's convention of treating
  // identity (id/username/role) and everything else as separate
  // concerns.
  const [quota, setQuota] = useState(null);
  const [error, setError] = useState("");
  const [ledOn, setLedOn] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("date"); // "name" | "size" | "date"
  const [sortDir, setSortDir] = useState("desc"); // "asc" | "desc"
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [shareFile, setShareFile] = useState(null);
  const [moveTarget, setMoveTarget] = useState(null); // { ids: number[], label: string } | null
  const navigate = useNavigate();
  const latestRequestId = useRef(0);

  // Clicking between folders quickly fires overlapping requests; without
  // this guard, a slower response for a folder you've already navigated
  // away from could arrive last and overwrite the correct, newer state
  // with stale data. Each call to refresh() claims the next id, and only
  // the most recent one is allowed to actually update state.
  async function refresh() {
    const requestId = ++latestRequestId.current;
    const folderIdAtRequestTime = currentFolderId;
    setError("");
    try {
      const [filesRes, foldersRes, meRes, quotaRes] = await Promise.all([
        api.listFiles(folderIdAtRequestTime),
        api.folders.list(folderIdAtRequestTime),
        api.me(),
        api.quota()
      ]);
      if (requestId !== latestRequestId.current) return; // superseded by a newer request
      setFiles(filesRes.data.files);
      setFolders(foldersRes.data.folders);
      setBreadcrumb(filesRes.data.breadcrumb || []);
      setMe(meRes.data);
      setQuota(quotaRes.data);
    } catch (err) {
      if (requestId === latestRequestId.current) setError(err.message);
    }
  }

  async function refreshTrash() {
    setError("");
    try {
      const trashRes = await api.listTrash();
      setTrash(trashRes.data.files);
    } catch (err) {
      setError(err.message);
    }
  }

  async function refreshShares() {
    setError("");
    try {
      const sharesRes = await api.listShares();
      setShares(sharesRes.data.shares);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolderId]);

  useEffect(() => {
    setSelectedIds(new Set());
    if (tab === "trash") refreshTrash();
    if (tab === "shares") refreshShares();
  }, [tab]);

  function blinkLED() {
    setLedOn(true);
    setTimeout(() => setLedOn(false), 500);
  }

  function handleLogout() {
    setToken(null);
    onLogout();
    navigate("/login");
  }

  function handleUploaded(file) {
    setFiles((prev) => [file, ...prev]);
    setQuota((prev) => (prev ? { ...prev, usedBytes: prev.usedBytes + file.size } : prev));
  }

  async function handleDelete(id) {
    setError("");
    try {
      await api.deleteFile(id);
      blinkLED();
      setFiles((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRestore(id) {
    setError("");
    try {
      await api.restoreFile(id);
      blinkLED();
      setTrash((prev) => prev.filter((f) => f.id !== id));
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handlePermanentDelete(id) {
    const item = trash.find((f) => f.id === id);
    if (!window.confirm(`Permanently delete "${item?.name}"? This can't be undone.`)) return;
    setError("");
    try {
      await api.permanentlyDeleteFile(id);
      blinkLED();
      setTrash((prev) => prev.filter((f) => f.id !== id));
      if (item) {
        setQuota((prev) => (prev ? { ...prev, usedBytes: Math.max(0, prev.usedBytes - item.size) } : prev));
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRevokeShare(shareId) {
    setError("");
    try {
      await api.revokeShare(shareId);
      setShares((prev) => prev.filter((s) => s.id !== shareId));
    } catch (err) {
      setError(err.message);
    }
  }

  // --- Folders -----------------------------------------------------------
  async function handleCreateFolder() {
    const name = window.prompt("New folder name:");
    if (!name) return;
    setError("");
    try {
      await api.folders.create(name.trim(), currentFolderId);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRenameFolder(folder) {
    const name = window.prompt(`Rename "${folder.name}" to:`, folder.name);
    if (!name || name.trim() === folder.name) return;
    setError("");
    try {
      await api.folders.rename(folder.id, name.trim());
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteFolder(folder) {
    if (!window.confirm(`Delete folder "${folder.name}"?`)) return;
    setError("");
    try {
      await api.folders.remove(folder.id);
      blinkLED();
      refresh();
    } catch (err) {
      // If the folder isn't empty, the backend explains how many files are
      // inside — offer to move them to Trash and delete anyway.
      if (window.confirm(`${err.message}\n\nMove those files to Trash and delete the folder?`)) {
        try {
          await api.folders.remove(folder.id, true);
          blinkLED();
          refresh();
        } catch (err2) {
          setError(err2.message);
        }
      }
    }
  }

  // --- Move to folder ------------------------------------------------------
  async function performMove(destFolderId) {
    setError("");
    const ids = moveTarget.ids;
    // Promise.all is all-or-nothing: if even one move fails, the others
    // that already succeeded on the backend would never be reflected here,
    // leaving the UI showing files as "still here" that are actually
    // already moved. allSettled lets each one succeed or fail on its own.
    const results = await Promise.allSettled(ids.map((id) => api.moveFile(id, destFolderId)));
    const succeededIds = ids.filter((_, i) => results[i].status === "fulfilled");
    const failedCount = results.length - succeededIds.length;

    blinkLED();
    setFiles((prev) => prev.filter((f) => !succeededIds.includes(f.id)));
    setSelectedIds(new Set());

    if (failedCount > 0) {
      throw new Error(`${failedCount} of ${ids.length} file(s) couldn't be moved.`);
    }
  }

  // --- Selection & batch actions --------------------------------------
  const activeList = tab === "trash" ? trash : files;

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (displayedList.length > 0 && displayedList.every((f) => prev.has(f.id))) {
        return new Set();
      }
      return new Set(displayedList.map((f) => f.id));
    });
  }

  async function handleBatchDownload() {
    setError("");
    blinkLED();
    try {
      const res = await fetch(api.downloadBatchUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...api.authHeader() },
        body: JSON.stringify({ ids: Array.from(selectedIds) })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Batch download failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "homecloud-files.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleBatchDelete() {
    if (!window.confirm(`Move ${selectedIds.size} file(s) to trash?`)) return;
    setError("");
    blinkLED();
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(ids.map((id) => api.deleteFile(id)));
    const succeededIds = ids.filter((_, i) => results[i].status === "fulfilled");
    const failedCount = results.length - succeededIds.length;
    setFiles((prev) => prev.filter((f) => !succeededIds.includes(f.id)));
    setSelectedIds(new Set());
    if (failedCount > 0) {
      setError(`${failedCount} of ${ids.length} file(s) couldn't be deleted.`);
    }
  }

  async function handleBatchRestore() {
    setError("");
    blinkLED();
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(ids.map((id) => api.restoreFile(id)));
    const succeededIds = ids.filter((_, i) => results[i].status === "fulfilled");
    const failedCount = results.length - succeededIds.length;
    setTrash((prev) => prev.filter((f) => !succeededIds.includes(f.id)));
    setSelectedIds(new Set());
    refresh();
    if (failedCount > 0) {
      setError(`${failedCount} of ${ids.length} file(s) couldn't be restored.`);
    }
  }

  async function handleBatchPermanentDelete() {
    if (!window.confirm(`Permanently delete ${selectedIds.size} file(s)? This can't be undone.`)) return;
    setError("");
    blinkLED();
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(ids.map((id) => api.permanentlyDeleteFile(id)));
    const succeededIds = ids.filter((_, i) => results[i].status === "fulfilled");
    const failedCount = results.length - succeededIds.length;
    setTrash((prev) => prev.filter((f) => !succeededIds.includes(f.id)));
    setSelectedIds(new Set());
    refresh();
    if (failedCount > 0) {
      setError(`${failedCount} of ${ids.length} file(s) couldn't be deleted.`);
    }
  }

  // --- Search + sort ----------------------------------------------------
  const displayedList = useMemo(() => {
    let list = activeList;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((f) => f.name.toLowerCase().includes(q));
    }
    const sorted = [...list].sort((a, b) => {
      let cmp;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "size") cmp = a.size - b.size;
      else cmp = new Date(a.createdAt) - new Date(b.createdAt);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [activeList, search, sortKey, sortDir]);

  const pctUsed = quota && quota.quotaBytes > 0 ? (quota.usedBytes / quota.quotaBytes) * 100 : 0;

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span>●</span> homecloud
        </div>

        <div className="sidebar-user">
          Signed in as
          <strong>{me?.username}</strong>
        </div>

        {quota && <StorageGauge usedBytes={quota.usedBytes} quotaBytes={quota.quotaBytes} />}

        <div className="sidebar-spacer" />

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 12, color: "var(--text-dim)" }}>
          <ActivityLED active={ledOn} />
          drive activity
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <ThemeToggle />
          <Link className="btn btn-ghost" to="/settings" style={{ textAlign: "center", textDecoration: "none" }}>
            Account settings
          </Link>
          {me?.role === "admin" && (
            <Link className="btn btn-ghost" to="/admin" style={{ textAlign: "center", textDecoration: "none" }}>
              Admin panel
            </Link>
          )}
          <button className="btn btn-ghost" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="main-header">
          <h1>Your files</h1>
          <span className="count">
            {tab === "shares" ? shares.length : displayedList.length} item
            {(tab === "shares" ? shares.length : displayedList.length) === 1 ? "" : "s"}
          </span>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {pctUsed >= 90 && (
          <div className="error-banner" style={{ background: "rgba(232,163,61,0.1)", borderColor: "rgba(232,163,61,0.4)", color: "var(--amber)" }}>
            You're using {formatBytes(quota.usedBytes)} of your {formatBytes(quota.quotaBytes)} quota
            ({Math.round(pctUsed)}%). Delete or empty Trash to free up space.
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <button
            className={tab === "files" ? "btn btn-primary" : "btn btn-ghost"}
            style={{ width: "auto", padding: "8px 16px" }}
            onClick={() => setTab("files")}
          >
            Files
          </button>
          <button
            className={tab === "trash" ? "btn btn-primary" : "btn btn-ghost"}
            style={{ width: "auto", padding: "8px 16px" }}
            onClick={() => setTab("trash")}
          >
            Trash
          </button>
          <button
            className={tab === "shares" ? "btn btn-primary" : "btn btn-ghost"}
            style={{ width: "auto", padding: "8px 16px" }}
            onClick={() => setTab("shares")}
          >
            Shared links
          </button>
        </div>

        {tab === "files" && (
          <>
            <Breadcrumb trail={breadcrumb} onNavigate={setCurrentFolderId} />

            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              <button className="btn btn-ghost" style={{ width: "auto", padding: "8px 16px" }} onClick={handleCreateFolder}>
                + New folder
              </button>
            </div>

            <UploadZone
              onUploaded={handleUploaded}
              onActivity={blinkLED}
              onError={(msg) => setError(msg)}
              folderId={currentFolderId}
            />

            <FolderGrid
              folders={folders}
              onOpen={setCurrentFolderId}
              onRename={handleRenameFolder}
              onDelete={handleDeleteFolder}
            />
          </>
        )}

        {(tab === "files" || tab === "trash") && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
              <input
                type="text"
                placeholder="Search filenames…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ ...selectStyle, flex: "1 1 200px" }}
              />
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} style={selectStyle}>
                <option value="date">Sort: Date</option>
                <option value="name">Sort: Name</option>
                <option value="size">Sort: Size</option>
              </select>
              <button
                className="btn btn-ghost"
                style={{ width: "auto", padding: "8px 10px" }}
                onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                title="Toggle sort direction"
              >
                {sortDir === "asc" ? "↑" : "↓"}
              </button>
            </div>

            {selectedIds.size > 0 && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  marginBottom: 16,
                  padding: "10px 14px",
                  background: "var(--panel-raised)",
                  border: "1px solid var(--border)",
                  borderRadius: 6
                }}
              >
                <span style={{ fontSize: 13, color: "var(--text-dim)", marginRight: 8 }}>
                  {selectedIds.size} selected
                </span>
                {tab === "files" ? (
                  <>
                    <button className="btn btn-ghost" style={{ width: "auto", padding: "6px 12px", fontSize: 12 }} onClick={handleBatchDownload}>
                      Download as zip
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ width: "auto", padding: "6px 12px", fontSize: 12 }}
                      onClick={() => setMoveTarget({ ids: Array.from(selectedIds), label: `${selectedIds.size} file(s)` })}
                    >
                      Move to…
                    </button>
                    <button className="btn-danger-ghost" onClick={handleBatchDelete}>
                      Delete
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-ghost" style={{ width: "auto", padding: "6px 12px", fontSize: 12 }} onClick={handleBatchRestore}>
                      Restore
                    </button>
                    <button className="btn-danger-ghost" onClick={handleBatchPermanentDelete}>
                      Delete forever
                    </button>
                  </>
                )}
              </div>
            )}

            <FileTable
              files={displayedList}
              mode={tab === "trash" ? "trash" : "active"}
              onDelete={handleDelete}
              onRestore={handleRestore}
              onPermanentDelete={handlePermanentDelete}
              onActivity={blinkLED}
              onShare={tab === "files" ? (file) => setShareFile(file) : undefined}
              onMove={tab === "files" ? (file) => setMoveTarget({ ids: [file.id], label: file.name }) : undefined}
              onError={setError}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
            />          </>
        )}

        {tab === "shares" && (
          shares.length === 0 ? (
            <div className="empty-state">
              <span className="glyph">[ ]</span>
              No active share links. Share a file from the Files tab to create one.
            </div>
          ) : (
            <table className="file-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Expires</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shares.map((s) => (
                  <tr key={s.id}>
                    <td className="file-name">{s.fileName}</td>
                    <td className="file-meta">{s.expiresAt ? formatDate(s.expiresAt) : "Never"}</td>
                    <td className="file-meta">{formatDate(s.createdAt)}</td>
                    <td>
                      <div className="file-actions">
                        <button
                          className="btn btn-ghost"
                          style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(api.shareUrl(s.token));
                            } catch {
                              window.prompt("Copy this link:", api.shareUrl(s.token));
                            }
                          }}
                        >
                          Copy link
                        </button>
                        <button className="btn-danger-ghost" onClick={() => handleRevokeShare(s.id)}>
                          Revoke
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </main>

      {shareFile && (
        <ShareDialog
          file={shareFile}
          onClose={() => setShareFile(null)}
          onShared={() => {
            if (tab === "shares") refreshShares();
          }}
        />
      )}

      {moveTarget && (
        <MoveDialog title={`Move ${moveTarget.label}`} onClose={() => setMoveTarget(null)} onMove={performMove} />
      )}
    </div>
  );
}
