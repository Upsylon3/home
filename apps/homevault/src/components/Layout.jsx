import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { setToken } from "../api.js";
import { useVault } from "../vaultContext.jsx";
import { KeyGlyph, GearGlyph, PlusGlyph } from "../components/icons.jsx";
import AppIcon from "../components/AppIcon.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";

export default function Layout({ user, onLogout }) {
  const navigate = useNavigate();
  const { lock } = useVault();

  function handleLogout() {
    setToken(null);
    onLogout();
    navigate("/login");
  }

  function handleLockNow() {
    lock();
    // No navigate() needed — App.jsx's isUnlocked check re-renders to
    // the Unlock screen as soon as the vault context clears the key.
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <AppIcon name="homevault" size={16} /> HomeVault
        </div>

        <button className="btn btn-primary" style={{ margin: "4px 0 14px" }} onClick={() => navigate("/items/new")}>
          <PlusGlyph size={14} /> New item
        </button>

        <nav>
          <ul className="nav-list">
            <li>
              <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
                <KeyGlyph size={15} /> All items
              </NavLink>
            </li>
          </ul>
        </nav>

        <div className="sidebar-spacer" />

        <div className="account-chip">
          <strong>{user.username}</strong>
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <button className="btn-ghost btn btn-sm" onClick={handleLockNow}>
              Lock now
            </button>
            <button className="btn-ghost btn btn-sm" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <div className="topbar-brand">
            <AppIcon name="homevault" size={18} /> HomeVault
          </div>
          <div className="topbar-actions">
            <ThemeToggle className="icon-btn" iconOnly />
            <button className="icon-btn" aria-label="Lock now" title="Lock now" onClick={handleLockNow}>
              <KeyGlyph size={16} />
            </button>
            <NavLink to="/settings" className="icon-btn" aria-label="Settings">
              <GearGlyph />
            </NavLink>
          </div>
        </header>

        <Outlet />
      </div>

      <nav className="bottom-nav">
        <NavLink to="/" end className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <KeyGlyph size={18} />
          Items
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <GearGlyph size={18} />
          Settings
        </NavLink>
      </nav>
    </div>
  );
}
