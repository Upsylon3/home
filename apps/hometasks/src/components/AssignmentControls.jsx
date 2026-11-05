import { useState } from 'react';
import { api } from '../api.js';
export default function AssignmentControls({ task, disabled, onChanged }) {
  const [username, setUsername] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function change(target) {
    setBusy(true); setError('');
    try {
      const { data } = await api.tasks.assign(task.id, target, task.assignmentVersion);
      await onChanged(data.task); setUsername('');
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="assignment-title" style={{ marginTop: 20 }}>
    <h3 id="assignment-title">Assignment</h3>
    <p className="field-hint">Shares this task’s saved title, notes, dates and future edits with one person. Your project, other tasks and personal reminders stay private. They can read, complete or decline; you keep edit, reopen and delete control.</p>
    {task.repeat !== 'none' && <p className="field-hint">The next repeat keeps its assignee. Each occurrence can be unassigned or declined separately.</p>}
    {disabled && <p role="status">Save your task changes before changing assignment.</p>}
    <p role="status">{task.assignee ? `Assigned to ${task.assignee.username}` : 'Not assigned. Only you can access this task.'}</p>
    {error && <p role="alert" className="error-banner">{error}</p>}
    <form onSubmit={event => { event.preventDefault(); if (username.trim()) change(username.trim()); }}>
      <div className="field"><label htmlFor="assignee-username">Exact username</label>
        <input id="assignee-username" value={username} disabled={disabled || busy} autoComplete="off" maxLength={32}
          onChange={event => setUsername(event.target.value)} />
      </div>
      <button type="submit" className="btn btn-primary btn-block" disabled={disabled || busy || !username.trim()}>{busy ? 'Checking account…' : 'Assign and share task'}</button>
    </form>
    {task.assignee && <button type="button" className="btn btn-ghost btn-block" disabled={disabled || busy} onClick={() => change(null)}>Remove assignment</button>}
  </section>;
}
