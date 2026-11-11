import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import AlbumCover from '../components/AlbumCover.jsx';
import { GridGlyph } from "../components/icons.jsx";

export default function Albums() {
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [coverFiles, setCoverFiles] = useState(new Map());
  const [coversUnavailable, setCoversUnavailable] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.albums.list();
      setAlbums(data.albums);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const controller = new AbortController(); let active = true;
    const timeout = setTimeout(() => controller.abort(), 5000);
    // Optional Cloud metadata selects the right decoder. Album names/counts
    // remain usable if preview metadata is unavailable.
    api.library({}, controller.signal).then(({ data }) => {
      if (active) setCoverFiles(new Map(data.files.map(file => [file.id, file])));
    }).catch(() => { if (active) setCoversUnavailable(true); }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError("");
    try {
      const { data } = await api.albums.create(name);
      setAlbums((prev) => [data.album, ...prev]);
      setNewName("");
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="page">
      <div className="page-header">
        <h1 className="page-title">Albums</h1>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {coversUnavailable && <p role="status">Cover previews are unavailable. Albums are still available.</p>}

      <form className="album-create-row" onSubmit={handleCreate}>
        <input
          className="search-input"
          placeholder="New album name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button className="btn btn-primary" style={{ width: "auto", padding: "8px 16px" }} disabled={creating}>
          {creating ? "Creating…" : "Create album"}
        </button>
      </form>

      {loading ? (
        <div className="loading-state">Loading albums…</div>
      ) : albums.length === 0 ? (
        <div className="empty-state">
          <div className="glyph">
            <GridGlyph size={28} />
          </div>
          <p>No albums yet — create one above to start grouping photos together.</p>
        </div>
      ) : (
        <div className="album-grid">
          {albums.map((album) => (
            <Link key={album.id} to={`/albums/${album.id}`} className="album-card">
              <div className="album-card-cover">
                {album.coverFileId ? (
                  <AlbumCover file={coverFiles.get(album.coverFileId)} />
                ) : (
                  <div className="album-card-cover-placeholder">
                    <GridGlyph size={22} />
                  </div>
                )}
              </div>
              <div className="album-card-name">{album.name}</div>
              <div className="album-card-count">
                {album.itemCount} {album.itemCount === 1 ? "item" : "items"}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
