import { useEffect, useState, useCallback } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api, setToken } from "../api.js";
import { NoteGlyph, StarGlyph, TrashGlyph, GearGlyph, PlusGlyph } from "./icons.jsx";
import AppIcon from "./AppIcon.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import FolderTree from "./FolderTree.jsx";

export default function Layout({ user, onLogout }) {
  const navigate = useNavigate();
  const [folders, setFolders] = useState([]);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [error, setError] = useState("");

  const loadFolders = useCallback(async () => {
    try {
      const { data } = await api.folders.all();
      setFolders(data.folders);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  async function handleNewNote() {
    try {
      const { data } = await api.notes.create({});
      navigate(`/notes/${data.note.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreateFolder(e) {
    e.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;
    try {
      await api.folders.create(name, null);
      setNewFolderName("");
      setCreatingFolder(false);
      loadFolders();
    } catch (err) {
      setError(err.message);
    }
  }

  function handleLogout() {
    setToken(null);
    onLogout();
    navigate("/login");
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <AppIcon name="homenotes" size={16} /> HomeNotes
        </div>

        <button className="btn btn-primary" style={{ margin: "4px 0 14px" }} onClick={handleNewNote}>
          <PlusGlyph size={14} /> New note
        </button>

        <nav>
          <ul className="nav-list">
            <li>
              <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
                <NoteGlyph size={15} /> All Notes
              </NavLink>
            </li>
            <li>
              <NavLink to="/favorites" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
                <StarGlyph size={15} /> Favorites
              </NavLink>
            </li>
            <li>
              <NavLink to="/trash" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
                <TrashGlyph size={15} /> Trash
              </NavLink>
            </li>
          </ul>

          <hr className="nav-divider" />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px" }}>
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-dim)", textTransform: "uppercase" }}>
              Folders
            </span>
            <button
              type="button"
              onClick={() => setCreatingFolder((v) => !v)}
              aria-label="New folder"
              style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer" }}
            >
              <PlusGlyph size={13} />
            </button>
          </div>

          {creatingFolder && (
            <form onSubmit={handleCreateFolder} style={{ padding: "0 8px 8px" }}>
              <input
                className="search-input"
                style={{ width: "100%", fontSize: 12 }}
                placeholder="Folder name…"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                autoFocus
                onBlur={() => !newFolderName && setCreatingFolder(false)}
              />
            </form>
          )}

          <FolderTree folders={folders} />
        </nav>

        <div className="sidebar-spacer" />

        <div className="account-chip">
          <strong>{user.username}</strong>
          <div>
            <button className="btn-ghost btn btn-sm" style={{ marginTop: 10 }} onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <div className="topbar-brand">
            <AppIcon name="homenotes" size={18} /> HomeNotes
          </div>
          <div className="topbar-actions">
            <ThemeToggle className="icon-btn" iconOnly />
            <NavLink to="/settings" className="icon-btn" aria-label="Settings">
              <GearGlyph />
            </NavLink>
          </div>
        </header>

        {error && (
          <div className="error-banner" style={{ margin: "16px 24px 0" }}>
            {error}
          </div>
        )}

        <Outlet context={{ user, folders, reloadFolders: loadFolders }} />
      </div>

      <nav className="bottom-nav">
        <NavLink to="/" end className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <NoteGlyph size={18} />
          Notes
        </NavLink>
        <NavLink to="/favorites" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <StarGlyph size={18} />
          Favorites
        </NavLink>
        <NavLink to="/trash" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <TrashGlyph size={18} />
          Trash
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <GearGlyph size={18} />
          Settings
        </NavLink>
      </nav>
    </div>
  );
}
