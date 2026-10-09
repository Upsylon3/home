import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api, setToken } from "../api.js";
import { todayString } from "../dates.js";
import { TaskGlyph, CalendarGlyph, UpcomingGlyph, CheckGlyph, FolderGlyph, GearGlyph, PlusGlyph } from "./icons.jsx";
import AppIcon from "./AppIcon.jsx";
import ThemeToggle from "./ThemeToggle.jsx";

// A helper so every nav link gets the "active" class on the current page.
const linkClass = ({ isActive }) => `nav-link${isActive ? " active" : ""}`;

// The frame around every signed-in page: sidebar (desktop), top bar, bottom
// nav (phone). It also owns the data the sidebar needs (projects and the
// summary counts) and shares it with pages through <Outlet context>, so a
// page can ask for a refresh after it changes a task.
export default function Layout({ user, onLogout }) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [summary, setSummary] = useState({ open: 0, overdue: 0, dueToday: 0 });
  const [today, setToday] = useState(todayString);
  const [error, setError] = useState("");
  const [addingProject, setAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  // Re-reads the project list and the counts. useCallback keeps the function
  // identity stable, so effects that depend on it don't re-run needlessly.
  const reloadSidebar = useCallback(async () => {
    try {
      const [projectsResult, summaryResult] = await Promise.all([api.projects.list(), api.summary(todayString())]);
      setProjects(projectsResult.data.projects);
      setSummary(summaryResult.data);
      setToday(todayString());
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    reloadSidebar();
  }, [reloadSidebar]);

  // If the tab was left open past midnight, "today" is now wrong. Whenever
  // the person comes back to the tab, refresh the date and the counts.
  useEffect(() => {
    function handleVisible() {
      if (document.visibilityState === "visible") reloadSidebar();
    }
    document.addEventListener("visibilitychange", handleVisible);
    return () => document.removeEventListener("visibilitychange", handleVisible);
  }, [reloadSidebar]);

  async function handleCreateProject(e) {
    e.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    try {
      const { data } = await api.projects.create(name);
      setNewProjectName("");
      setAddingProject(false);
      await reloadSidebar();
      navigate(`/projects/${data.project.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleLogout() {
    setToken(null);
    onLogout();
    navigate("/login");
  }

  const dueSoonCount = summary.dueToday + summary.overdue;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <AppIcon name="hometasks" size={16} /> HomeTasks
        </div>

        <nav>
          <ul className="nav-list">
            <li>
              <NavLink to="/" end className={linkClass}>
                <CalendarGlyph size={15} /> Today
                {dueSoonCount > 0 && (
                  <span className={`nav-count${summary.overdue > 0 ? " is-alert" : ""}`}>{dueSoonCount}</span>
                )}
              </NavLink>
            </li>
            <li>
              <NavLink to="/upcoming" className={linkClass}>
                <UpcomingGlyph size={15} /> Upcoming
              </NavLink>
            </li>
            <li>
              <NavLink to="/all" className={linkClass}>
                <TaskGlyph size={15} /> All tasks
                {summary.open > 0 && <span className="nav-count">{summary.open}</span>}
              </NavLink>
            </li>
            <li>
              <NavLink to="/done" className={linkClass}>
                <CheckGlyph size={15} /> Done
              </NavLink>
            </li>
          </ul>

          <hr className="nav-divider" />

          <div className="nav-heading">
            <span>Projects</span>
            <button type="button" onClick={() => setAddingProject((v) => !v)} aria-label="New project">
              <PlusGlyph size={13} />
            </button>
          </div>

          {addingProject && (
            <form onSubmit={handleCreateProject} style={{ padding: "0 8px 8px" }}>
              <input
                className="search-input"
                style={{ width: "100%", fontSize: 12 }}
                placeholder="Project name…"
                aria-label="Project name"
                maxLength={60}
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                autoFocus
                onBlur={() => !newProjectName && setAddingProject(false)}
              />
            </form>
          )}

          <ul className="nav-list">
            {projects.map((project) => (
              <li key={project.id}>
                <NavLink to={`/projects/${project.id}`} className={linkClass}>
                  <FolderGlyph size={15} /> {project.name}
                  {project.openCount > 0 && <span className="nav-count">{project.openCount}</span>}
                </NavLink>
              </li>
            ))}
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
            <AppIcon name="hometasks" size={18} /> HomeTasks
          </div>
          <div className="topbar-actions">
            <ThemeToggle className="icon-btn" iconOnly />
            <NavLink to="/settings" className="icon-btn" aria-label="Settings">
              <GearGlyph />
            </NavLink>
          </div>
        </header>

        {error && (
          <div className="error-banner" role="alert" style={{ margin: "16px 24px 0" }}>
            {error}
          </div>
        )}

        <Outlet context={{ user, projects, summary, today, reloadSidebar }} />
      </div>

      <nav className="bottom-nav">
        <NavLink to="/" end className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <CalendarGlyph size={18} />
          Today
        </NavLink>
        <NavLink to="/upcoming" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <UpcomingGlyph size={18} />
          Upcoming
        </NavLink>
        <NavLink to="/all" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <TaskGlyph size={18} />
          All
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `bottom-nav-item${isActive ? " active" : ""}`}>
          <GearGlyph size={18} />
          Settings
        </NavLink>
      </nav>
    </div>
  );
}
