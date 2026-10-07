import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { MusicGlyph } from "./icons.jsx";

// Shows ONE file at full size: a photo (including animated GIFs), a video,
// or a song. It replaces the old approach of downloading the entire file
// into memory before showing anything — see homemedia-backend/src/stream.js
// for why that never worked well and how streaming fixes it.
//
// How it works, in plain words:
//   1. Ask HomeMedia for a "ticket" (a short-lived link for this one file).
//   2. Give that link straight to <img>, <video> or <audio>. The browser
//      then streams it itself: playback starts immediately and seeking works.
//
// GIFs are the reason photos go through this too: a GIF only animates if
// the browser gets the ORIGINAL file. The grid thumbnails are JPEGs (one
// still frame); here we show the real thing.
export default function MediaView({ file }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  // How many times we've already tried a fresh ticket for this file. A
  // ticket can legitimately die (server restart, long idle) — one silent
  // retry fixes that. Without a limit a genuinely broken file would retry
  // forever, which is the exact "loading forever" bug this replaces.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    setAttempt(0);
    api
      .mediaTicket(file.id)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [file.id]);

  const handleError = useCallback(() => {
    if (attempt >= 1) {
      setFailed(true);
      return;
    }
    setAttempt(attempt + 1);
    api
      .mediaTicket(file.id)
      .then(setUrl)
      .catch(() => setFailed(true));
  }, [attempt, file.id]);

  if (failed) {
    return (
      <div className="lightbox-message" role="alert">
        Couldn't load this file. It may have been deleted or your browser may not support its format.
      </div>
    );
  }
  if (!url) return <div className="lightbox-message">Loading…</div>;

  // key={url}: a new ticket means a new element, so the browser starts
  // fresh instead of reusing a half-failed one.
  if (file.kind === "video") {
    // eslint-disable-next-line jsx-a11y/media-has-caption -- personal home videos, no caption tracks exist to attach
    return <video key={url} src={url} controls autoPlay playsInline className="lightbox-video" onError={handleError} />;
  }
  if (file.kind === "audio") {
    return (
      <div className="lightbox-audio">
        <MusicGlyph size={56} />
        <div className="lightbox-audio-name">{file.name}</div>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- music has no captions */}
        <audio key={url} src={url} controls autoPlay onError={handleError} />
      </div>
    );
  }
  return <img key={url} src={url} alt={file.name} className="lightbox-image" onError={handleError} />;
}
