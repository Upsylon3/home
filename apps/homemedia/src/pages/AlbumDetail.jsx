import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import PhotoGrid from "../components/PhotoGrid.jsx";
import Lightbox from "../components/Lightbox.jsx";
import Modal from "../components/Modal.jsx";
import AuthImage from "../components/AuthImage.jsx";
import { TrashGlyph } from "../components/icons.jsx";

function AddPhotosModal({ album, existingIds, onClose, onAdded }) {
  const [library, setLibrary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .library({})
      .then(({ data }) => setLibrary(data.files.filter((f) => !existingIds.has(f.id))))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [existingIds]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAdd() {
    if (selected.size === 0) return;
    setSaving(true);
    setError("");
    try {
      await api.albums.addItems(album.id, Array.from(selected));
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Add photos to "${album.name}"`} onClose={onClose}>
      {error && <div className="error-banner">{error}</div>}
      {loading ? (
        <div className="loading-state">Loading your library…</div>
      ) : library.length === 0 ? (
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
          Everything in your library is already in this album.
        </p>
      ) : (
        <>
          <div className="photo-picker-grid">
            {library.map((file) => (
              <button
                key={file.id}
                type="button"
                className={`photo-picker-tile${selected.has(file.id) ? " selected" : ""}`}
                onClick={() => toggle(file.id)}
              >
                {file.kind === "image" ? (
                  <AuthImage
                    src={api.thumbnailUrl(file.id)}
                    alt={file.name}
                    className="photo-tile-img"
                    placeholder={<div className="photo-tile-placeholder" />}
                  />
                ) : (
                  <div className="photo-tile-video-placeholder" />
                )}
              </button>
            ))}
          </div>
          <button
            className="btn btn-primary btn-block"
            style={{ marginTop: 14 }}
            disabled={selected.size === 0 || saving}
            onClick={handleAdd}
          >
            {saving ? "Adding…" : `Add ${selected.size || ""} photo${selected.size === 1 ? "" : "s"}`}
          </button>
        </>
      )}
    </Modal>
  );
}

export default function AlbumDetail() {
  const { albumId } = useParams();
  const navigate = useNavigate();
  const [album, setAlbum] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [{ data: albumData }, { data: libraryData }] = await Promise.all([
        api.albums.get(albumId),
        api.library({ albumId })
      ]);
      setAlbum(albumData.album);
      setNameDraft(albumData.album.name);
      setFiles(libraryData.files);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId]);

  async function handleToggleFavorite(file) {
    try {
      if (file.favorited) await api.unfavorite(file.id);
      else await api.favorite(file.id);
      setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, favorited: !f.favorited } : f)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRemoveFromAlbum(file) {
    try {
      await api.albums.removeItem(albumId, file.id);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      setLightboxIndex(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRename(e) {
    e.preventDefault();
    const name = nameDraft.trim();
    if (!name || name === album.name) {
      setRenaming(false);
      return;
    }
    try {
      const { data } = await api.albums.rename(albumId, name);
      setAlbum(data.album);
      setRenaming(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${album.name}"? The photos themselves stay right where they are in HomeCloud.`)) {
      return;
    }
    try {
      await api.albums.remove(albumId);
      navigate("/albums");
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <div className="loading-state">Loading album…</div>;
  if (!album) return <div className="error-banner">{error || "Album not found."}</div>;

  return (
    <main className="page">
      <div className="page-header">
        {renaming ? (
          <form onSubmit={handleRename} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              className="search-input"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              autoFocus
              onBlur={handleRename}
            />
          </form>
        ) : (
          <h1 className="page-title" onClick={() => setRenaming(true)} title="Click to rename" style={{ cursor: "text" }}>
            {album.name}
          </h1>
        )}
        <div className="page-toolbar">
          <button className="btn btn-primary" style={{ width: "auto", padding: "8px 16px" }} onClick={() => setShowPicker(true)}>
            Add photos
          </button>
          <button className="btn-danger-ghost" onClick={handleDelete}>
            Delete album
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <PhotoGrid
        files={files}
        onOpen={(file) => setLightboxIndex(files.findIndex((f) => f.id === file.id))}
        onToggleFavorite={handleToggleFavorite}
        emptyMessage="No photos in this album yet — add some to get started."
      />

      {lightboxIndex !== null && (
        <Lightbox
          files={files}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
          onToggleFavorite={handleToggleFavorite}
          extraAction={
            <button
              className="icon-btn"
              onClick={() => handleRemoveFromAlbum(files[lightboxIndex])}
              aria-label="Remove from this album"
              title="Remove from this album"
            >
              <TrashGlyph size={16} />
            </button>
          }
        />
      )}

      {showPicker && (
        <AddPhotosModal
          album={album}
          existingIds={new Set(files.map((f) => f.id))}
          onClose={() => setShowPicker(false)}
          onAdded={() => {
            setShowPicker(false);
            load();
          }}
        />
      )}
    </main>
  );
}
