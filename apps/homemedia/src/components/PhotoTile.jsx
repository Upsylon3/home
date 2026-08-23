import AuthImage from "./AuthImage.jsx";
import { api } from "../api.js";
import { StarGlyph, PlayGlyph } from "./icons.jsx";

export default function PhotoTile({ file, onOpen, onToggleFavorite }) {
  return (
    <div className="photo-tile" onClick={onOpen}>
      {file.kind === "image" ? (
        <AuthImage
          src={api.thumbnailUrl(file.id)}
          alt={file.name}
          className="photo-tile-img"
          placeholder={<div className="photo-tile-placeholder" />}
        />
      ) : (
        <div className="photo-tile-video-placeholder">
          <PlayGlyph size={28} />
        </div>
      )}

      <button
        className={`photo-tile-favorite${file.favorited ? " active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        aria-label={file.favorited ? "Remove from favorites" : "Add to favorites"}
      >
        <StarGlyph size={14} filled={file.favorited} />
      </button>

      {file.kind === "video" && (
        <div className="photo-tile-kind-badge" aria-hidden="true">
          <PlayGlyph size={11} />
        </div>
      )}
    </div>
  );
}
