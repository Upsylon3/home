import { describeDue } from "../dates.js";

// One task in a list: a checkbox, the title, and small labels.
//
// This component only DISPLAYS. It doesn't talk to the server; it calls
// `onToggle` / `onOpen` and lets the page decide what happens. (Components
// that only show things and report clicks are easy to reason about.)
//
// Props:
//   task         the task object from the API
//   today        "YYYY-MM-DD" in the person's local time
//   projectName  optional: shown as a label (omitted when already inside that project)
//   onToggle     called with the task when the checkbox is clicked
//   onOpen       called with the task when the title is clicked (opens the editor)
export default function TaskRow({ task, today, projectName, onToggle, onOpen }) {
  const due = task.isDone ? null : describeDue(task.dueDate, today);

  return (
    <li className={`task-row${task.isDone ? " is-done" : ""}`}>
      {/* The label is invisible but read aloud by screen readers. */}
      <input
        type="checkbox"
        className="task-check"
        checked={task.isDone}
        onChange={() => onToggle(task)}
        aria-label={task.isDone ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
      />
      <div>
        <button type="button" className="task-title" onClick={() => onOpen(task)}>
          {task.title}
        </button>
        {(due || task.priority !== "none" || projectName) && (
          <div className="task-meta">
            {due && <span className={`chip is-${due.tone}`}>{due.text}</span>}
            {task.priority !== "none" && <span className={`chip is-${task.priority}`}>{task.priority} priority</span>}
            {projectName && <span className="chip">{projectName}</span>}
          </div>
        )}
      </div>
    </li>
  );
}
