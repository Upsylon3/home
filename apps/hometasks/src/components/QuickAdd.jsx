import { useState } from "react";

// The "add a task" bar at the top of a list.
//
// It keeps its own little bit of state (what's typed so far) and, on submit,
// hands a ready-made task object to `onAdd`. The page does the real work and
// returns normally on success or throws on failure; we only clear the title
// when it worked, so a failed add never loses what someone typed.
//
// Props:
//   defaultDueDate  pre-filled date ("" for none), e.g. today on the Today page
//   onAdd(task)     async function that creates the task
export default function QuickAdd({ defaultDueDate = "", onAdd }) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [priority, setPriority] = useState("none");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault(); // stop the browser's own page-reload on submit
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onAdd({ title: trimmed, dueDate: dueDate || null, priority });
      // Back to the starting values, so the next task doesn't inherit this
      // one's date or priority.
      setTitle("");
      setDueDate(defaultDueDate);
      setPriority("none");
    } catch {
      // The page shows the error message; we just keep the typed title.
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="quick-add" onSubmit={handleSubmit}>
      <input
        className="input quick-add-title"
        placeholder="Add a task…"
        aria-label="New task title"
        maxLength={200}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        className="input"
        type="date"
        aria-label="Due date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
      />
      <select className="input" aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
        <option value="none">No priority</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
      <button className="btn btn-primary" type="submit" disabled={busy || !title.trim()}>
        Add
      </button>
    </form>
  );
}
