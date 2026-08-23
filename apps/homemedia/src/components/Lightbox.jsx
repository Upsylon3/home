import { useCallback, useEffect, useState } from "react";
import { api, fetchImageBlob } from "../api.js";
import AuthImage from "./AuthImage.jsx";
import { XGlyph, ChevronLeftGlyph, ChevronRightGlyph, StarGlyph, InfoGlyph } from "./icons.jsx";

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatShutter(seconds) {
  if (!seconds) return null;
  return seconds < 1 ? `1/${Math.round(1 / seconds)}s` : `${seconds}s`;
}

function LightboxVideo({ fileId }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    fetchImageBlob(api.fullImageUrl(fileId)).then((url) => {
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      objectUrl = url;
      setSrc(url);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);

  if (!src) return <div className="lightbox-video-loading">Loading video…</div>;
  // eslint-disable-next-line jsx-a11y/media-has-caption -- personal home videos, no caption tracks exist to attach
  return <video src={src} controls autoPlay className="lightbox-video" />;
}

// files/index/onIndexChange, rather than a single file, so prev/next
// navigation can move through the same list the grid is already showing
// without the caller needing to manage two pieces of state.
export default function Lightbox({ files, index, onClose, onIndexChange, onToggleFavorite, extraAction }) {
  const file = files[index];
  const [showInfo, setShowInfo] = useState(false);
  const [exif, setExif] = useState(null);
  const [exifLoading, setExifLoading] = useState(false);

  const goPrev = useCallback(() => {
    if (index > 0) onIndexChange(index - 1);
  }, [index, onIndexChange]);

  const goNext = useCallback(() => {
    if (index < files.length - 1) onIndexChange(index + 1);
  }, [index, files.length, onIndexChange]);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goPrev, goNext, onClose]);

  useEffect(() => {
    setExif(null);
    setShowInfo(false);
  }, [file?.id]);

  useEffect(() => {
    if (!showInfo || !file || exif !== null || file.kind !== "image") return;
    setExifLoading(true);
    api
      .exif(file.id)
      .then(({ data }) => setExif(data.exif || {}))
      .catch(() => setExif({}))
      .finally(() => setExifLoading(false));
  }, [showInfo, file, exif]);

  if (!file) return null;

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-media">
          {file.kind === "image" ? (
            <AuthImage src={api.fullImageUrl(file.id)} alt={file.name} className="lightbox-image" />
          ) : (
            <LightboxVideo fileId={file.id} />
          )}
        </div>

        {index > 0 && (
          <button className="lightbox-nav lightbox-nav-prev" onClick={goPrev} aria-label="Previous">
            <ChevronLeftGlyph size={22} />
          </button>
        )}
        {index < files.length - 1 && (
          <button className="lightbox-nav lightbox-nav-next" onClick={goNext} aria-label="Next">
            <ChevronRightGlyph size={22} />
          </button>
        )}

        <div className="lightbox-toolbar">
          <span className="lightbox-filename">{file.name}</span>
          <div className="lightbox-actions">
            {extraAction}
            <button
              className={`icon-btn${file.favorited ? " active" : ""}`}
              onClick={() => onToggleFavorite(file)}
              aria-label="Toggle favorite"
            >
              <StarGlyph size={16} filled={file.favorited} />
            </button>
            <button
              className={`icon-btn${showInfo ? " active" : ""}`}
              onClick={() => setShowInfo((s) => !s)}
              aria-label="Show info"
            >
              <InfoGlyph size={16} />
            </button>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <XGlyph size={16} />
            </button>
          </div>
        </div>

        {showInfo && (
          <aside className="lightbox-info-panel">
            <h3>Details</h3>
            <dl className="exif-list">
              <dt>Name</dt>
              <dd>{file.name}</dd>
              <dt>Date</dt>
              <dd>{new Date(file.createdAt).toLocaleString()}</dd>
              <dt>Size</dt>
              <dd>{formatBytes(file.size)}</dd>

              {exifLoading && <dd className="exif-loading">Loading metadata…</dd>}
              {exif?.Make && (
                <>
                  <dt>Camera</dt>
                  <dd>
                    {exif.Make} {exif.Model || ""}
                  </dd>
                </>
              )}
              {exif?.LensModel && (
                <>
                  <dt>Lens</dt>
                  <dd>{exif.LensModel}</dd>
                </>
              )}
              {exif?.FNumber && (
                <>
                  <dt>Aperture</dt>
                  <dd>ƒ/{exif.FNumber}</dd>
                </>
              )}
              {exif?.ExposureTime && (
                <>
                  <dt>Shutter</dt>
                  <dd>{formatShutter(exif.ExposureTime)}</dd>
                </>
              )}
              {exif?.ISO && (
                <>
                  <dt>ISO</dt>
                  <dd>{exif.ISO}</dd>
                </>
              )}
              {exif?.FocalLength && (
                <>
                  <dt>Focal length</dt>
                  <dd>{exif.FocalLength}mm</dd>
                </>
              )}
              {exif?.gps && (
                <>
                  <dt>Location</dt>
                  <dd>
                    {exif.gps.latitude.toFixed(5)}, {exif.gps.longitude.toFixed(5)}
                  </dd>
                </>
              )}
            </dl>
          </aside>
        )}
      </div>
    </div>
  );
}
