import { useEffect, useState } from "react";
import { api } from "../api.js";
import PhotoGrid from "../components/PhotoGrid.jsx";
import Lightbox from "../components/Lightbox.jsx";

export default function Favorites() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lightboxIndex, setLightboxIndex] = useState(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.library({ favorite: "true" });
      setFiles(data.files);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleToggleFavorite(file) {
    setError("");
    try {
      // Un-favoriting here should drop it from this page immediately,
      // rather than leaving a now-unfavorited photo sitting in Favorites
      // until the next reload.
      await api.unfavorite(file.id);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      setLightboxIndex(null);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="page">
      <div className="page-header">
        <h1 className="page-title">Favorites</h1>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="loading-state">Loading your favorites…</div>
      ) : (
        <PhotoGrid
          files={files}
          onOpen={(file) => setLightboxIndex(files.findIndex((f) => f.id === file.id))}
          onToggleFavorite={handleToggleFavorite}
          emptyMessage="Nothing favorited yet — tap the star on any photo or video to save it here."
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
