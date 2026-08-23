import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { setToken } from "../api.js";
import { ImageGlyph, StarGlyph, GridGlyph, GearGlyph } from "./icons.jsx";
import ThemeToggle from "./ThemeToggle.jsx";

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
          <ImageGlyph size={16} /> HomeMedia
        </div>

        <nav>
          <ul className="nav-list">
            <li>
              <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
                <ImageGlyph size={15} /> Library
              </NavLink>
            </li>
            <li>
              <NavLink to="/favorites" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
                <StarGlyph size={15} /> Favorites
              </NavLink>
            </li>
            <li>
              <NavLink to="/albums" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
                <GridGlyph size={15} /> Albums
              </NavLink>
            </li>
          </ul>

          <hr className="nav-divider" />

          <ul className="nav-list">
            <li>
              <NavLink to="/settings" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
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
          <div className="topbar-brand">HomeMedia</div>
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
          <ImageGlyph size={18} />
          Library
        </NavLink>
        <NavLink to="/favorites" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <StarGlyph size={18} />
          Favorites
        </NavLink>
        <NavLink to="/albums" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <GridGlyph size={18} />
          Albums
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <GearGlyph size={18} />
          Settings
        </NavLink>
      </nav>
    </div>
  );
}
