import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { setToken } from "../api.js";
import { OverviewGlyph, GearGlyph } from "./icons.jsx";
import AppIcon from "./AppIcon.jsx";
import ThemeToggle from "./ThemeToggle.jsx";

const linkClass = ({ isActive }) => `nav-link${isActive ? " active" : ""}`;

// The frame around every signed-in page: sidebar (desktop), top bar, and a
// bottom nav on phones. HomeMonitor is a single dashboard plus Settings, so
// the navigation is short.
export default function Layout({ user, onLogout }) {
  const navigate = useNavigate();

  function handleLogout() {
    setToken(null);
    onLogout();
    navigate("/login");
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <AppIcon name="homemonitor" size={16} /> HomeMonitor
        </div>
        <nav>
          <ul className="nav-list">
            <li>
              <NavLink to="/" end className={linkClass}>
                <OverviewGlyph size={15} /> Overview
              </NavLink>
            </li>
            <li>
              <NavLink to="/settings" className={linkClass}>
                <GearGlyph size={15} /> Settings
              </NavLink>
            </li>
          </ul>
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
            <AppIcon name="homemonitor" size={18} /> HomeMonitor
          </div>
          <div className="topbar-actions">
            <ThemeToggle className="icon-btn" iconOnly />
            <NavLink to="/settings" className="icon-btn" aria-label="Settings">
              <GearGlyph />
            </NavLink>
          </div>
        </header>
        <Outlet context={{ user }} />
      </div>

      <nav className="bottom-nav">
        <NavLink to="/" end className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <OverviewGlyph size={18} />
          Overview
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <GearGlyph size={18} />
          Settings
        </NavLink>
      </nav>
    </div>
  );
}
