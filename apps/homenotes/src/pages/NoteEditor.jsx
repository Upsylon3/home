import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBeforeUnload, useBlocker, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { createNoteSaveQueue } from '../noteSaveQueue.js';
import { renderMarkdownToSafeHtml } from "../markdown.js";
import { api } from "../api.js";
import { StarGlyph, TrashGlyph, PaperclipGlyph, HistoryGlyph, FolderGlyph, TagGlyph } from "../components/icons.jsx";

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
  return <Editor key={noteId} noteId={noteId} />;
}

function Editor({ noteId }) {
  const navigate = useNavigate();
  const { folders } = useOutletContext();

  const [note, setNote] = useState(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState([]);
  const [tagDraft, setTagDraft] = useState("");
  const [mode, setMode] = useState("write"); // "write" | "preview"
  const [saveState, setSaveState] = useState("idle"); // idle | pending | saving | saved | error
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [versions, setVersions] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [templateNotice, setTemplateNotice] = useState('');

  const latest = useRef({ title: "", content: "" });
  const loadGeneration = useRef(0);
  const queue = useMemo(() => createNoteSaveQueue({
    update: async fields => (await api.notes.update(noteId, fields)).data.note,
    onSaved: setNote,
    onState: (state, message) => { setSaveState(state); setError(message); }
  }), [noteId]);
  useEffect(() => { queue.resume(); return () => queue.dispose(); }, [queue]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    currentLocation.pathname !== nextLocation.pathname && queue.hasUnsaved());
  useBeforeUnload(useCallback(event => {
    if (queue.hasUnsaved()) { event.preventDefault(); event.returnValue = ''; }
  }, [queue]));
  useEffect(() => {
    function beforeLogout(event) {
      if (queue.hasUnsaved() && !window.confirm('Discard unsaved note changes and sign out?')) event.preventDefault();
    }
    window.addEventListener('homenotes:before-logout', beforeLogout);
    return () => window.removeEventListener('homenotes:before-logout', beforeLogout);
  }, [queue]);

  const loadNote = useCallback(async (metadataOnly = false) => {
    const generation = ++loadGeneration.current;
    setError("");
    try {
      const { data } = await api.notes.get(noteId);
      if (generation !== loadGeneration.current) return;
      setNote(data.note);
      if (metadataOnly) return;
      setTitle(data.note.title);
      setContent(data.note.content);
      setTags(data.note.tags);
      latest.current = { title: data.note.title, content: data.note.content };
    } catch (err) {
      if (generation === loadGeneration.current) setError(err.message);
    }
  }, [noteId]);

  useEffect(() => {
    loadNote();
    setShowHistory(false);
    setShowAttachments(false);
    setVersions(null);
    return () => { loadGeneration.current++; };
  }, [loadNote]);

  function handleTitleChange(value) {
    setTitle(value);
    latest.current.title = value;
    queue.edit({ title: value, content: latest.current.content });
  }

  function handleContentChange(value) {
    setContent(value);
    latest.current.content = value;
    queue.edit({ title: latest.current.title, content: value });
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
    if (restoring || creatingTemplate) return;
    const name = tagDraft.trim();
    if (!name || tags.some((t) => t.toLowerCase() === name.toLowerCase())) {
      setTagDraft("");
      return;
    }
    const nextTags = [...tags, name];
    setTags(nextTags);
    setTagDraft("");
    queue.edit({ tags: nextTags });
  }

  function removeTag(name) {
    if (restoring || creatingTemplate) return;
    const nextTags = tags.filter((t) => t !== name);
    setTags(nextTags);
    queue.edit({ tags: nextTags });
  }

  async function handleDelete() {
    if (restoring) return;
    if (!window.confirm(`Move "${title || "Untitled"}" to trash?`)) return;
    setRestoring(true);
    try {
      if (!await queue.flush()) return;
      await api.notes.remove(noteId);
      navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setRestoring(false);
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
    setRestoring(true);
    try {
      if (!await queue.flush()) return;
      const { data } = await api.notes.restoreVersion(noteId, versionId);
      setNote(data.note);
      setTitle(data.note.title);
      setContent(data.note.content);
      setTags(data.note.tags);
      latest.current = { title: data.note.title, content: data.note.content };
      const { data: versionData } = await api.notes.versions(noteId);
      setVersions(versionData.versions);
    } catch (err) {
      setError(err.message);
    } finally {
      setRestoring(false);
    }
  }

  async function handleAttachmentUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    try {
      await api.notes.uploadAttachment(noteId, form);
      loadNote(true);
    } catch (err) {
      setError(err.message);
    } finally {
      e.target.value = "";
    }
  }

  async function removeAttachment(fileId) {
    try {
      await api.notes.removeAttachment(noteId, fileId);
      loadNote(true);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!note) {
    return error ? <div className="loading-state"><p role="alert">{error}</p><button className="btn btn-ghost" onClick={() => loadNote()}>Retry loading note</button></div> : <div className="loading-state">Loading note…</div>;
  }

  const saveLabel = { idle: "", pending: "Unsaved changes", saving: "Saving…", saved: "Saved", error: "Couldn't save" }[saveState];

  return (
    <div className="note-editor">
      {error && <div className="error-banner" role="alert">{error}</div>}
      {templateNotice && <p role="status">{templateNotice}</p>}
      {showTemplateForm ? <form aria-label="Save note as template" onSubmit={async e => {
        e.preventDefault();
        if (creatingTemplate || restoring) return;
        setCreatingTemplate(true); setTemplateNotice('');
        try {
          if (!await queue.flush()) return;
          await api.templates.create(noteId, templateName.trim());
          setShowTemplateForm(false); setTemplateName('');
          setTemplateNotice('Template saved. Open Templates to start a new note.');
        } catch (err) { setError(err.message); }
        finally { setCreatingTemplate(false); }
      }}>
        <div className="field"><label htmlFor="template-name">Template name</label>
          <input id="template-name" required maxLength={100} value={templateName} disabled={creatingTemplate} onChange={e => setTemplateName(e.target.value)} /></div>
        <p>Copies the saved title, Markdown and tags. Attachments, folder, favorites and history stay with this note.</p>
        <button className="btn btn-primary btn-sm" disabled={creatingTemplate || restoring}>Save template</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={creatingTemplate} onClick={() => { setShowTemplateForm(false); setTemplateName(''); }}>Cancel template</button>
      </form> : <button className="btn btn-ghost btn-sm" disabled={restoring} onClick={() => { setShowTemplateForm(true); setTemplateName(title || 'Untitled'); setTemplateNotice(''); }}>Save as template</button>}
      {blocker.state === 'blocked' && <section role="alertdialog" aria-labelledby="unsaved-note-title" aria-describedby="unsaved-note-description" className="panel">
        <h2 id="unsaved-note-title">Unsaved note changes</h2>
        <p id="unsaved-note-description">Save your changes before leaving, or stay here to keep editing. Failed saves remain in this editor for retry. A save already sent to the server may still complete.</p>
        <button className="btn btn-primary" autoFocus disabled={leaving} onClick={async () => {
          setLeaving(true);
          if (await queue.flush()) blocker.proceed();
          setLeaving(false);
        }}>Save and leave</button>
        <button className="btn btn-ghost" disabled={leaving} onClick={() => blocker.reset()}>Keep editing</button>
        <button className="btn btn-danger-ghost" disabled={leaving} onClick={() => { queue.dispose(); blocker.proceed(); }}>Discard queued changes and leave</button>
      </section>}

      <input
        className="note-editor-title"
        aria-label="Note title"
        disabled={restoring || creatingTemplate}
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
            aria-label="Note content"
            disabled={restoring || creatingTemplate}
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            placeholder="Start writing in Markdown…"
          />
        ) : (
          // eslint-disable-next-line react/no-danger -- output is sanitized by renderMarkdownToSafeHtml (DOMPurify) — see that function's header comment
          <div className="note-editor-preview" dangerouslySetInnerHTML={{ __html: renderMarkdownToSafeHtml(content) }} />
        )}
      </div>

      <div className="note-editor-meta-row">
        <span className="note-editor-save-state" role="status">{saveLabel}</span>
        {saveState === 'error' && <button className="btn btn-ghost btn-sm" onClick={() => queue.flush()}>Retry saving</button>}

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
                <button className="btn btn-ghost btn-sm" disabled={restoring || creatingTemplate} onClick={() => restoreVersion(v.id)}>
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
