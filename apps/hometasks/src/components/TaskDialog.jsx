import { useState } from "react";
import Modal from "./Modal.jsx";

// The pop-up for editing one task: every field, plus delete.
//
// Props:
//   task        the task being edited
//   projects    list of the person's projects (for the project dropdown)
//   onSave      async (patch) => saves the changed fields
//   onDelete    async () => deletes the task
//   onClose     closes the dialog
export default function TaskDialog({ task, projects, onSave, onDelete, onClose }) {
  // Each field starts from the task's current value. Form inputs always deal
  // in text, so ids and "no due date" are turned into strings here and back
  // into numbers/null when saving.
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [priority, setPriority] = useState(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate || "");
  const [projectId, setProjectId] = useState(task.projectId === null ? "" : String(task.projectId));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action) {
    setBusy(true);
    setError("");
    try {
      await action();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) {
      setError("A task needs a title.");
      return;
    }
    run(() =>
      onSave({
        title: title.trim(),
        notes,
        priority,
        dueDate: dueDate || null, // empty box -> null clears the date
        projectId: projectId === "" ? null : Number(projectId)
      })
    );
  }

  return (
    <Modal title="Edit task" onClose={onClose}>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="task-title">Title</label>
          <input id="task-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>

        <div className="field">
          <label htmlFor="task-notes">Notes</label>
          <textarea id="task-notes" value={notes} maxLength={5000} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="task-due">Due date</label>
            <input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="task-priority">Priority</label>
            <select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="none">None</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="task-project">Project</label>
          <select id="task-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          Save
        </button>
      </form>

      {/* Deleting is permanent (tasks have no Trash), so it takes two clicks. */}
      {confirmingDelete ? (
        <div className="confirm-row">
          <button className="btn btn-sm" type="button" disabled={busy} onClick={() => run(onDelete)}>
            Yes, delete it
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setConfirmingDelete(false)}>
            Keep it
          </button>
        </div>
      ) : (
        <div className="confirm-row">
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setConfirmingDelete(true)}>
            Delete task
          </button>
        </div>
      )}
    </Modal>
  );
}
