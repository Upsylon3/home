import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import PhotoGrid from "../components/PhotoGrid.jsx";
import Lightbox from "../components/Lightbox.jsx";

export default function Library() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState(""); // "" | "image" | "video"
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (type) params.type = type;
      if (search) params.search = search;
      const { data } = await api.library(params);
      setFiles(data.files);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [type, search]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleToggleFavorite(file) {
    setError("");
    try {
      if (file.favorited) await api.unfavorite(file.id);
      else await api.favorite(file.id);
      setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, favorited: !f.favorited } : f)));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="page">
      <div className="page-header">
        <h1 className="page-title">Library</h1>
        <div className="page-toolbar">
          <input
            className="search-input"
            placeholder="Search by filename…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="segmented">
            <button className={type === "" ? "active" : ""} onClick={() => setType("")}>
              All
            </button>
            <button className={type === "image" ? "active" : ""} onClick={() => setType("image")}>
              Photos
            </button>
            <button className={type === "video" ? "active" : ""} onClick={() => setType("video")}>
              Videos
            </button>
          </div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="loading-state">Loading your library…</div>
      ) : (
        <PhotoGrid
          files={files}
          onOpen={(file) => setLightboxIndex(files.findIndex((f) => f.id === file.id))}
          onToggleFavorite={handleToggleFavorite}
          emptyMessage={
            search
              ? "No photos or videos match your search."
              : "No photos or videos yet — anything you upload to HomeCloud shows up here automatically."
          }
        />
      )}

      {lightboxIndex !== null && (
        <Lightbox
          files={files}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
          onToggleFavorite={handleToggleFavorite}
        />
      )}
    </main>
  );
}
