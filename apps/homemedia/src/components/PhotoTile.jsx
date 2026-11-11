import AuthImage from "./AuthImage.jsx";
import VideoPoster from './VideoPoster.jsx';
import { api } from "../api.js";
import { StarGlyph, PlayGlyph, MusicGlyph } from "./icons.jsx";

export default function PhotoTile({ file, onOpen, onToggleFavorite }) {
  return (
    <div className="photo-tile">
      <button type="button" className="photo-tile-open" onClick={onOpen} aria-label={`Open ${file.name}`}>
      {file.kind === "image" ? (
        <AuthImage
          src={api.thumbnailUrl(file.id)}
          alt={file.name}
          className="photo-tile-img"
          placeholder={<div className="photo-tile-placeholder" />}
        />
      ) : file.kind === "audio" ? (
        // Music has no picture to preview, so the tile shows a note and the
        // file name — otherwise a grid of songs would be a wall of identical icons.
        <div className="photo-tile-video-placeholder photo-tile-audio">
          <MusicGlyph size={28} />
          <span className="photo-tile-audio-name">{file.name}</span>
        </div>
      ) : (
        <VideoPoster file={file} />
      )}
      </button>

      <button
        type="button"
        className={`photo-tile-favorite${file.favorited ? " active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        aria-label={file.favorited ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={file.favorited}
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
