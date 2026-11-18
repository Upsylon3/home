import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

export default function Templates() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  async function load() {
    setError('');
    try { setTemplates((await api.templates.list()).data.templates); }
    catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, []);
  async function start(template) {
    setBusy(template.id); setError('');
    try { const { data } = await api.templates.start(template.id); navigate(`/notes/${data.note.id}`); }
    catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }
  async function remove(template) {
    if (!window.confirm(`Remove template "${template.name}"? Notes already created from it will be kept.`)) return;
    setBusy(template.id); setError('');
    try { await api.templates.remove(template.id); setTemplates(current => current.filter(item => item.id !== template.id)); }
    catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }
  return <main className="page">
    <header className="page-header"><h1 className="page-title">Templates</h1>
      <p>Save a note as a personal template, then start independent notes with its title, Markdown and tags.</p>
      <p>Folders, favorites, attachments and version history are not copied. You can keep up to 100 templates.</p>
    </header>
    {error && <div role="alert" className="error-banner">{error} <button className="btn btn-ghost btn-sm" onClick={load}>Retry loading templates</button></div>}
    {templates === null ? !error && <p role="status">Loading templates…</p> : templates.length === 0 ?
      <p>No templates yet. Open a note and choose Save as template.</p> : <div className="note-list">
        {templates.map(template => <section className="panel" style={{ overflowWrap: 'anywhere', minWidth: 0 }} key={template.id} aria-label={`Template ${template.name}`}>
          <h2>{template.name}</h2><p>Note title: {template.title}</p>
          {template.tags.length > 0 && <p>Tags: {template.tags.join(', ')}</p>}
          <button className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => start(template)}>New note from template</button>
          <button className="btn btn-danger-ghost" disabled={busy !== null} onClick={() => remove(template)}>Remove template</button>
        </section>)}
      </div>}
  </main>;
}
