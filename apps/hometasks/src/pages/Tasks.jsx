import { useEffect, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { api } from "../api.js";
import { greeting } from "../dates.js";
import QuickAdd from "../components/QuickAdd.jsx";
import TaskRow from "../components/TaskRow.jsx";
import TaskDialog from "../components/TaskDialog.jsx";

// ONE page component that shows five different "views" of the same task list.
// The `view` prop (set in App.jsx) says which:
//   today     tasks that are overdue or due today        (with the woodgrain header)
//   upcoming  tasks due after today
//   all       every open task
//   done      finished tasks, newest first
//   project   the open tasks of one project (id comes from the address)
// Sharing one component keeps the add / tick / edit / delete behavior
// identical everywhere, instead of five copies that slowly drift apart.

const VIEW_TITLES = { upcoming: "Upcoming", all: "All tasks", done: "Done" };

const EMPTY_MESSAGES = {
  today: "Nothing due today. Add a task above, or enjoy the quiet.",
  upcoming: "Nothing scheduled after today.",
  all: "No open tasks. Add one above.",
  done: "Nothing finished yet. Tick a task off and it will show up here.",
  project: "No open tasks in this project yet."
};

export default function Tasks({ view }) {
  // Shared by Layout.jsx through <Outlet context>.
  const { user, projects, summary, today, reloadSidebar } = useOutletContext();
  const { projectId } = useParams(); // only present on the project view
  const navigate = useNavigate();

  const [tasks, setTasks] = useState(null); // null means "still loading"
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // the task open in the dialog, if any
  const [searchText, setSearchText] = useState(""); // what is typed in the box
  const [query, setQuery] = useState(""); // the typed text, after a short pause
  const [version, setVersion] = useState(0); // bump this number to reload the list
  const [renaming, setRenaming] = useState(null); // text of the rename box, or null
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const project = view === "project" ? projects.find((p) => String(p.id) === projectId) : null;
  const showSearch = view === "all" || view === "done" || view === "project";

  // Switching views starts fresh: show "Loading…", clear the search box.
  useEffect(() => {
    setTasks(null);
    setSearchText("");
    setQuery("");
    setRenaming(null);
    setConfirmingDelete(false);
    setError("");
  }, [view, projectId]);

  // "Debounce": wait until the person pauses typing for a quarter of a second
  // before searching, so we don't send a request for every single keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchText.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchText]);

  // Load the tasks whenever the view, the search or the version changes.
  useEffect(() => {
    // If the person switches views while a request is in flight, the old
    // answer must not overwrite the new view. `cancelled` guards against that.
    let cancelled = false;

    async function load() {
      try {
        let loaded;
        if (view === "today") {
          // Two questions to the server: overdue, and due today.
          const [overdue, dueToday] = await Promise.all([
            api.tasks.list({ due: "overdue", today }),
            api.tasks.list({ due: "today", today })
          ]);
          loaded = [...overdue.data.tasks, ...dueToday.data.tasks];
        } else {
          const params = { search: query };
          if (view === "upcoming") Object.assign(params, { due: "upcoming", today });
          if (view === "done") params.status = "done";
          if (view === "project") params.projectId = projectId;
          loaded = (await api.tasks.list(params)).data.tasks;
        }
        if (!cancelled) {
          setTasks(loaded);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setTasks([]);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [view, projectId, query, today, version]);

  // After any change: reload this list AND the sidebar counts.
  async function refresh() {
    setVersion((v) => v + 1);
    await reloadSidebar();
  }

  async function handleToggle(task) {
    try {
      if (task.isDone) await api.tasks.reopen(task.id);
      else await api.tasks.complete(task.id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  // QuickAdd calls this. Throwing makes QuickAdd keep what was typed.
  async function handleAdd(fields) {
    try {
      const body = { ...fields };
      if (view === "project") body.projectId = Number(projectId);
      await api.tasks.create(body);
      await refresh();
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }

  async function handleRenameProject(e) {
    e.preventDefault();
    try {
      await api.projects.rename(projectId, renaming);
      setRenaming(null);
      await reloadSidebar();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteProject() {
    try {
      await api.projects.remove(projectId);
      await reloadSidebar();
      navigate("/all");
    } catch (err) {
      setError(err.message);
    }
  }

  // id -> name, so a task can show which project it belongs to.
  const projectNames = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  function renderRows(list) {
    return (
      <ul className="task-list">
        {list.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            today={today}
            projectName={view === "project" ? null : projectNames[task.projectId]}
            onToggle={handleToggle}
            onOpen={setEditing}
          />
        ))}
      </ul>
    );
  }

  function renderBody() {
    if (tasks === null) return <p className="loading-state">Loading…</p>;
    if (tasks.length === 0) {
      return (
        <div className="empty-state">
          <p>{query ? "No tasks match that search." : EMPTY_MESSAGES[view]}</p>
        </div>
      );
    }
    if (view === "today") {
      // Split the one list into two labelled sections.
      const overdue = tasks.filter((t) => t.dueDate < today);
      const dueToday = tasks.filter((t) => t.dueDate >= today);
      return (
        <>
          {overdue.length > 0 && (
            <section className="task-section">
              <h2 className="task-section-title">Overdue · {overdue.length}</h2>
              {renderRows(overdue)}
            </section>
          )}
          {dueToday.length > 0 && (
            <section className="task-section">
              <h2 className="task-section-title">Due today · {dueToday.length}</h2>
              {renderRows(dueToday)}
            </section>
          )}
        </>
      );
    }
    return renderRows(tasks);
  }

  // ----- the header: the woodgrain "desk top" on Today, a plain title elsewhere -----
  let header;
  if (view === "today") {
    const tone = summary.overdue > 0 ? "degraded" : "healthy";
    const dateText = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    header = (
      <header className="hero woodgrain">
        <div className="hero-plate">
          <p className="page-eyebrow">HomeTasks · {dateText}</p>
          <h1 className="page-title hero-title">
            {greeting()}, {user.displayName || user.username}
          </h1>
          {/* role="status": screen readers announce this line when it changes */}
          <p className="hero-status" role="status">
            <span className={`status-dot ${tone}`} aria-hidden="true" />
            {summary.dueToday} due today · {summary.overdue} overdue · {summary.open} open
          </p>
          <div className="stripe-band hero-stripes" aria-hidden="true" />
        </div>
      </header>
    );
  } else {
    const title = view === "project" ? (project ? project.name : "Project") : VIEW_TITLES[view];
    header = (
      <div className="page-header">
        <h1 className="page-title">{title}</h1>
        {view === "project" && project && (
          <div>
            {renaming !== null ? (
              <form className="page-actions" onSubmit={handleRenameProject}>
                <input
                  className="input"
                  style={{ maxWidth: 240 }}
                  aria-label="Project name"
                  maxLength={60}
                  value={renaming}
                  onChange={(e) => setRenaming(e.target.value)}
                  autoFocus
                />
                <button className="btn btn-primary btn-sm" type="submit">
                  Save
                </button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => setRenaming(null)}>
                  Cancel
                </button>
              </form>
            ) : confirmingDelete ? (
              <div className="page-actions">
                <span className="panel-desc" style={{ margin: 0, alignSelf: "center" }}>
                  Delete this project? Its tasks stay; they just lose the project.
                </span>
                <button className="btn btn-sm" type="button" onClick={handleDeleteProject}>
                  Yes, delete
                </button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => setConfirmingDelete(false)}>
                  Keep it
                </button>
              </div>
            ) : (
              <div className="page-actions">
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => setRenaming(project.name)}>
                  Rename
                </button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => setConfirmingDelete(true)}>
                  Delete project
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="page">
      {header}

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {/* key resets QuickAdd's typed text when you move to another view */}
      {view !== "done" && (
        <QuickAdd key={`${view}-${projectId}`} defaultDueDate={view === "today" ? today : ""} onAdd={handleAdd} />
      )}

      {showSearch && (
        <div className="page-toolbar" style={{ marginTop: 0, marginBottom: 18 }}>
          <input
            className="search-input"
            placeholder="Search tasks…"
            aria-label="Search tasks"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          {/* Also the way to reach a project on a phone, where the sidebar is hidden. */}
          {view !== "done" && (
            <select
              className="input"
              style={{ width: "auto" }}
              aria-label="Show project"
              value={view === "project" ? projectId : ""}
              onChange={(e) => navigate(e.target.value ? `/projects/${e.target.value}` : "/all")}
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {renderBody()}

      {editing && (
        <TaskDialog
          task={editing}
          projects={projects}
          onSave={async (patch) => {
            await api.tasks.update(editing.id, patch);
            await refresh();
          }}
          onDelete={async () => {
            await api.tasks.remove(editing.id);
            await refresh();
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  );
}
