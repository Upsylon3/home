import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { marked } from "marked";
import { api } from "../api.js";
import { StarGlyph, TrashGlyph, PaperclipGlyph, HistoryGlyph, FolderGlyph, TagGlyph } from "../components/icons.jsx";

const AUTOSAVE_DELAY_MS = 1500;

function timeAgo(iso) {
  const date = new Date(`${iso.replace(" ", "T")}Z`);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

export default function NoteEditor() {
  const { noteId } = useParams();
  const navigate = useNavigate();
  const { folders } = useOutletContext();

  const [note, setNote] = useState(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState([]);
  const [tagDraft, setTagDraft] = useState("");
  const [mode, setMode] = useState("write"); // "write" | "preview"
  const [saveState, setSaveState] = useState("idle"); // "idle" | "saving" | "saved" | "error"
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [versions, setVersions] = useState(null);

  const saveTimeout = useRef(null);
  const latest = useRef({ title: "", content: "" });

  const loadNote = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.notes.get(noteId);
      setNote(data.note);
      setTitle(data.note.title);
      setContent(data.note.content);
      setTags(data.note.tags);
      latest.current = { title: data.note.title, content: data.note.content };
    } catch (err) {
      setError(err.message);
    }
  }, [noteId]);

  useEffect(() => {
    loadNote();
    setShowHistory(false);
    setShowAttachments(false);
    setVersions(null);
    return () => clearTimeout(saveTimeout.current);
  }, [loadNote]);

  const save = useCallback(
    async (fields) => {
      setSaveState("saving");
      try {
        const { data } = await api.notes.update(noteId, fields);
        setNote(data.note);
        setSaveState("saved");
      } catch (err) {
        setError(err.message);
        setSaveState("error");
      }
    },
    [noteId]
  );

  function scheduleAutosave(fields) {
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => save(fields), AUTOSAVE_DELAY_MS);
  }

  function handleTitleChange(value) {
    setTitle(value);
    latest.current.title = value;
    scheduleAutosave({ title: value, content: latest.current.content });
  }

  function handleContentChange(value) {
    setContent(value);
    latest.current.content = value;
    scheduleAutosave({ title: latest.current.title, content: value });
  }

  async function toggleFavorite() {
    if (!note) return;
    try {
      const { data } = await api.notes.update(noteId, { isFavorite: !note.isFavorite });
      setNote(data.note);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleMoveToFolder(e) {
    const value = e.target.value;
    const folderId = value === "" ? null : Number(value);
    try {
      const { data } = await api.notes.update(noteId, { folderId });
      setNote(data.note);
    } catch (err) {
      setError(err.message);
    }
  }

  function addTag(e) {
    e.preventDefault();
    const name = tagDraft.trim();
    if (!name || tags.some((t) => t.toLowerCase() === name.toLowerCase())) {
      setTagDraft("");
      return;
    }
    const nextTags = [...tags, name];
    setTags(nextTags);
    setTagDraft("");
    save({ tags: nextTags });
  }

  function removeTag(name) {
    const nextTags = tags.filter((t) => t !== name);
    setTags(nextTags);
    save({ tags: nextTags });
  }

  async function handleDelete() {
    if (!window.confirm(`Move "${title || "Untitled"}" to trash?`)) return;
    try {
      await api.notes.remove(noteId);
      navigate("/");
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadVersions() {
    setShowAttachments(false);
    setShowHistory((v) => !v);
    if (versions === null) {
      try {
        const { data } = await api.notes.versions(noteId);
        setVersions(data.versions);
      } catch (err) {
        setError(err.message);
      }
    }
  }

  async function restoreVersion(versionId) {
    if (!window.confirm("Restore this version? The current text will be saved as a version too, so nothing is lost.")) return;
    try {
      const { data } = await api.notes.restoreVersion(noteId, versionId);
      setNote(data.note);
      setTitle(data.note.title);
      setContent(data.note.content);
      const { data: versionData } = await api.notes.versions(noteId);
      setVersions(versionData.versions);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAttachmentUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    try {
      await api.notes.uploadAttachment(noteId, form);
      loadNote();
    } catch (err) {
      setError(err.message);
    } finally {
      e.target.value = "";
    }
  }

  async function removeAttachment(fileId) {
    try {
      await api.notes.removeAttachment(noteId, fileId);
      loadNote();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!note) {
    return <div className="loading-state">Loading note…</div>;
  }

  const saveLabel = { idle: "", saving: "Saving…", saved: "Saved", error: "Couldn't save" }[saveState];

  return (
    <div className="note-editor">
      {error && <div className="error-banner">{error}</div>}

      <input
        className="note-editor-title"
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        placeholder="Untitled"
      />

      <div className="note-editor-toolbar">
        <div className="segmented">
          <button className={mode === "write" ? "active" : ""} onClick={() => setMode("write")}>
            Write
          </button>
          <button className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}>
            Preview
          </button>
        </div>

        <div className="note-editor-toolbar-actions">
          <button
            className={`icon-btn${note.isFavorite ? " active" : ""}`}
            onClick={toggleFavorite}
            aria-label="Toggle favorite"
            title="Favorite"
          >
            <StarGlyph size={15} filled={note.isFavorite} />
          </button>
          <button
            className={`icon-btn${showAttachments ? " active" : ""}`}
            onClick={() => {
              setShowHistory(false);
              setShowAttachments((v) => !v);
            }}
            aria-label="Attachments"
            title="Attachments"
          >
            <PaperclipGlyph size={15} />
          </button>
          <button
            className={`icon-btn${showHistory ? " active" : ""}`}
            onClick={loadVersions}
            aria-label="Version history"
            title="Version history"
          >
            <HistoryGlyph size={15} />
          </button>
          <button className="icon-btn" onClick={handleDelete} aria-label="Delete note" title="Move to trash">
            <TrashGlyph size={15} />
          </button>
        </div>
      </div>

      <div className="note-editor-body">
        {mode === "write" ? (
          <textarea
            className="note-editor-textarea"
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            placeholder="Start writing in Markdown…"
          />
        ) : (
          // eslint-disable-next-line react/no-danger -- rendering the note's own Markdown is the entire point of a preview pane; content is the person's own, never third-party HTML
          <div className="note-editor-preview" dangerouslySetInnerHTML={{ __html: marked.parse(content || "") }} />
        )}
      </div>

      <div className="note-editor-meta-row">
        <span className="note-editor-save-state">{saveLabel}</span>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <FolderGlyph size={13} />
          <select
            value={note.folderId ?? ""}
            onChange={handleMoveToFolder}
            style={{
              background: "var(--panel)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontSize: 12,
              padding: "4px 6px"
            }}
          >
            <option value="">No folder</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>

        <form onSubmit={addTag} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <TagGlyph size={13} />
          {tags.map((tag) => (
            <span key={tag} className="tag-chip" onClick={() => removeTag(tag)} title="Click to remove">
              {tag} ×
            </span>
          ))}
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            placeholder="Add tag…"
            style={{ background: "none", border: "none", color: "var(--text)", fontSize: 12, width: 80 }}
          />
        </form>
      </div>

      {showHistory && (
        <aside className="side-panel">
          <h3>Version history</h3>
          {versions === null ? (
            <p style={{ color: "var(--text-dim)", fontSize: 13 }}>Loading…</p>
          ) : versions.length === 0 ? (
            <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
              No earlier versions yet — one is saved automatically the next time you make a meaningful edit.
            </p>
          ) : (
            versions.map((v) => (
              <div key={v.id} className="version-item">
                <div className="version-item-date">{timeAgo(v.createdAt)}</div>
                <div className="version-item-preview">{v.content.slice(0, 140) || "(empty)"}</div>
                <button className="btn btn-ghost btn-sm" onClick={() => restoreVersion(v.id)}>
                  Restore this version
                </button>
              </div>
            ))
          )}
        </aside>
      )}

      {showAttachments && (
        <aside className="side-panel">
          <h3>Attachments</h3>
          {note.attachments.length === 0 ? (
            <p style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 16 }}>No attachments yet.</p>
          ) : (
            note.attachments.map((a) => (
              <div key={a.fileId} className="attachment-item">
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                <button className="btn-danger-ghost" onClick={() => removeAttachment(a.fileId)}>
                  Remove
                </button>
              </div>
            ))
          )}
          <label
            className="btn btn-ghost btn-sm"
            style={{ display: "block", textAlign: "center", marginTop: 12, cursor: "pointer" }}
          >
            Add attachment
            <input type="file" onChange={handleAttachmentUpload} style={{ display: "none" }} />
          </label>
        </aside>
      )}
    </div>
  );
}
