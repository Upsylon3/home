import { useEffect, useState } from "react";
import { api } from "../api.js";
import { TrashGlyph } from "../components/icons.jsx";

export default function Trash() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.notes.trash();
      setNotes(data.notes);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleRestore(id) {
    setError("");
    try {
      await api.notes.restore(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handlePermanentDelete(id, title) {
    if (!window.confirm(`Permanently delete "${title}"? This can't be undone.`)) return;
    setError("");
    try {
      await api.notes.removePermanent(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="page">
      <div className="page-header">
        <h1 className="page-title">Trash</h1>
        <p className="page-subtitle">Deleted notes stay here until you remove them for good.</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="loading-state">Loading trash…</div>
      ) : notes.length === 0 ? (
        <div className="empty-state">
          <div className="glyph">
            <TrashGlyph size={28} />
          </div>
          <p>Trash is empty.</p>
        </div>
      ) : (
        <div className="note-list">
          {notes.map((note) => (
            <div
              key={note.id}
              className="note-card"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="note-card-title">{note.title}</div>
                {note.excerpt && <p className="note-card-excerpt">{note.excerpt}</p>}
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => handleRestore(note.id)}>
                  Restore
                </button>
                <button className="btn-danger-ghost" onClick={() => handlePermanentDelete(note.id, note.title)}>
                  Delete forever
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
