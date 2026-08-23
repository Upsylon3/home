import { useMemo } from "react";
import PhotoTile from "./PhotoTile.jsx";
import { ImageGlyph } from "./icons.jsx";

function monthLabel(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "Unknown date";
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

// Timeline grouping is purely a presentation concern — the backend just
// hands back a flat, sorted list (see homemedia-backend/src/library.js) —
// so it happens here rather than being baked into the API response.
export default function PhotoGrid({ files, onOpen, onToggleFavorite, emptyMessage }) {
  const groups = useMemo(() => {
    const map = new Map();
    for (const file of files) {
      const key = monthLabel(file.createdAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(file);
    }
    return Array.from(map.entries());
  }, [files]);

  if (files.length === 0) {
    return (
      <div className="empty-state">
        <div className="glyph">
          <ImageGlyph size={28} />
        </div>
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="photo-timeline">
      {groups.map(([label, groupFiles]) => (
        <section key={label} className="photo-timeline-group">
          <h3 className="photo-timeline-heading">{label}</h3>
          <div className="photo-grid">
            {groupFiles.map((file) => (
              <PhotoTile
                key={file.id}
                file={file}
                onOpen={() => onOpen(file)}
                onToggleFavorite={() => onToggleFavorite(file)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
