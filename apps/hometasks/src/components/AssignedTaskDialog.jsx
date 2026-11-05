import { useState } from 'react';
import Modal from './Modal.jsx';
export default function AssignedTaskDialog({ task, onComplete, onDecline, onClose }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function run(action) {
    setBusy(true); setError('');
    try { await action(); onClose(); }
    catch (error) { setError(error.message); setBusy(false); }
  }
  return <Modal title="Assigned task" onClose={onClose}>
    <h3>{task.title}</h3>
    <p>From {task.owner.username} · {task.isDone ? 'Completed' : 'Open'}</p>
    <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{task.notes || 'No notes.'}</p>
    <p>{task.dueDate ? `Due ${task.dueDate}` : 'No due date'} · {task.priority} priority</p>
    <p className="field-hint">You can complete or decline this task. Its owner controls edits, reopening and deletion. Their project and reminders stay private.</p>
    {task.repeat !== 'none' && <p className="field-hint">Completing creates the next repeat, assigned to you. Declining removes only this occurrence.</p>}
    {error && <p role="alert" className="error-banner">{error}</p>}
    {!task.isDone && <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => run(onComplete)}>Complete task</button>}
    <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={() => run(onDecline)}>Decline this assignment</button>
  </Modal>;
}
