import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { api, setToken } from "../api.js";
import { GridGlyph, GearGlyph } from "./icons.jsx";
import AppIcon from "./AppIcon.jsx";
import NotificationBell from "./NotificationBell.jsx";
import ThemeToggle from "./ThemeToggle.jsx";

export default function Layout({ user, onLogout }) {
  const [apps, setApps] = useState([]);

  useEffect(() => {
    api.apps
      .list()
      .then(({ data }) => setApps(data.applications))
      .catch(() => {
        // The sidebar just won't list external apps if this fails; the
        // rest of Home (Dashboard, Settings) still works independently.
      });
  }, []);

  function handleLogout() {
    setToken(null);
    onLogout();
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <AppIcon name="home" size={16} /> Home
        </div>

        <nav>
          <ul className="nav-list">
            <li>
              <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
                <AppIcon name="home" size={15} /> Home
              </NavLink>
            </li>
            {apps
              .filter((a) => a.enabled)
              .map((a) => (
                <li key={a.slug}>
                  <a className="nav-link" href={a.baseUrl || "#"} target="_blank" rel="noreferrer">
                    <AppIcon name={a.slug} size={15} /> {a.name}
                  </a>
                </li>
              ))}
          </ul>

          <hr className="nav-divider" />

          <ul className="nav-list">
            <li>
              <NavLink to="/apps" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
                <GridGlyph size={15} /> Apps
              </NavLink>
            </li>
            <li>
              <NavLink to="/settings" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
                <GearGlyph size={15} /> Settings
              </NavLink>
            </li>
          </ul>
        </nav>

        <div className="sidebar-spacer" />

        <div className="account-chip">
          <strong>{user.displayName || user.username}</strong>
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
            <AppIcon name="home" size={18} /> Home
          </div>
          <div className="topbar-actions">
            <ThemeToggle className="icon-btn" iconOnly />
            <NotificationBell />
            <NavLink to="/settings" className="icon-btn" aria-label="Settings">
              <GearGlyph />
            </NavLink>
          </div>
        </header>

        <Outlet context={{ user, onLogout: handleLogout }} />
      </div>

      <nav className="bottom-nav">
        <NavLink to="/" end className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <AppIcon name="home" size={18} />
          Home
        </NavLink>
        <NavLink to="/apps" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <GridGlyph size={18} />
          Apps
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <GearGlyph size={18} />
          Settings
        </NavLink>
      </nav>
    </div>
  );
}
