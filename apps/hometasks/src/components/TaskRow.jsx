import { describeDue } from "../dates.js";
import { describeRepeat } from "../repeat.js";

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
  const repeats = describeRepeat(task.repeat); // null for a normal task

  return (
    <li className={`task-row${task.isDone ? " is-done" : ""}`}>
      {/* The label is invisible but read aloud by screen readers. */}
      <input
        type="checkbox"
        className="task-check"
        checked={task.isDone}
        disabled={task.access === 'assignee' && task.isDone}
        title={task.access === 'assignee' && task.isDone ? 'The owner can reopen this task.' : undefined}
        onChange={() => onToggle(task)}
        aria-label={task.isDone ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
      />
      <div>
        <button type="button" className="task-title" onClick={() => onOpen(task)}>
          {task.title}
        </button>
        {(due || repeats || task.reminderAt || task.assignee || task.priority !== "none" || projectName) && (
          <div className="task-meta">
            {due && <span className={`chip is-${due.tone}`}>{due.text}</span>}
            {task.reminderAt && !task.isDone && <span className="chip">{task.reminderState === "sent" ? "Reminder sent" : task.reminderState === "suppressed" ? "Reminder not sent" : `Remind ${new Date(task.reminderAt).toLocaleString()}`}</span>}
            {repeats && <span className="chip">{repeats}</span>}
            {task.priority !== "none" && <span className={`chip is-${task.priority}`}>{task.priority} priority</span>}
            {projectName && <span className="chip">{projectName}</span>}
            {task.assignee && <span className="chip">{task.access === 'assignee' ? `From ${task.owner.username}` : `Assigned to ${task.assignee.username}`}</span>}
          </div>
        )}
      </div>
    </li>
  );
}
