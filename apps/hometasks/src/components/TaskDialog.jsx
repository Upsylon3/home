import { useState } from "react";
import Modal from "./Modal.jsx";
import { REPEAT_OPTIONS } from "../repeat.js";

// The pop-up for editing one task: every field, plus delete.
//
// Props:
//   task        the task being edited
//   projects    list of the person's projects (for the project dropdown)
//   today       "YYYY-MM-DD" in the person's local time (used to pre-fill a due date)
//   onSave      async (patch) => saves the changed fields
//   onDelete    async () => deletes the task
//   onClose     closes the dialog
export default function TaskDialog({ task, projects, today, onSave, onDelete, onClose }) {
  // Each field starts from the task's current value. Form inputs always deal
  // in text, so ids and "no due date" are turned into strings here and back
  // into numbers/null when saving.
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [priority, setPriority] = useState(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate || "");
  const [repeat, setRepeat] = useState(task.repeat);
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

  // A repeating task counts forward from its due date, so it needs one.
  // Choosing a repeat on a task with no date fills in today, instead of making
  // the person discover the rule from an error message.
  function handleRepeatChange(value) {
    setRepeat(value);
    if (value !== "none" && !dueDate) setDueDate(today);
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
        repeat,
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
          <label htmlFor="task-repeat">Repeat</label>
          <select id="task-repeat" value={repeat} onChange={(e) => handleRepeatChange(e.target.value)}>
            {REPEAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {repeat !== "none" && (
            <p className="field-hint">When you tick it off, the next one is created automatically. Choose "Doesn't repeat" to stop.</p>
          )}
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
