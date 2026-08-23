import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { NoteGlyph } from "./icons.jsx";

function timeAgo(iso) {
  // SQLite's datetime('now') is space-separated UTC — not strict
  // ISO-8601 — same parsing note as the rest of this project's clients.
  const date = new Date(`${iso.replace(" ", "T")}Z`);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

export default function NoteListView({ title, filterParams, emptyMessage }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api.notes
      .list({ ...filterParams, search: search || undefined })
      .then(({ data }) => {
        if (!cancelled) setNotes(data.notes);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // filterParams is a fresh object each render from the caller — stringify
    // it so this effect only re-runs when the actual filter values change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filterParams), search]);

  return (
    <main className="page">
      <div className="page-header">
        <h1 className="page-title">{title}</h1>
        <div className="page-toolbar">
          <input
            className="search-input"
            placeholder="Search notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="loading-state">Loading notes…</div>
      ) : notes.length === 0 ? (
        <div className="empty-state">
          <div className="glyph">
            <NoteGlyph size={28} />
          </div>
          <p>{emptyMessage || (search ? "No notes match your search." : "No notes here yet.")}</p>
        </div>
      ) : (
        <div className="note-list">
          {notes.map((note) => (
            <Link key={note.id} to={`/notes/${note.id}`} className="note-card">
              <div className="note-card-title-row">
                <span className="note-card-title">{note.title}</span>
                <span className="note-card-date">{timeAgo(note.updatedAt)}</span>
              </div>
              {note.excerpt && <p className="note-card-excerpt">{note.excerpt}</p>}
              {note.tags.length > 0 && (
                <div className="note-card-tags">
                  {note.tags.map((tag) => (
                    <span key={tag} className="note-card-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
