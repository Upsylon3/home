import { useEffect, useRef, useState } from 'react';
import { videoPosters } from '../videoPosters.js';
import { PlayGlyph } from './icons.jsx';
import { getToken } from '../api.js';

export default function VideoPoster({ file, decorative = false }) {
  const element = useRef(null);
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let disposed = false, requested = false;
    setUrl(null);
    const load = () => {
      if (requested) return; requested = true;
      videoPosters.get(file).then(value => { if (!disposed) setUrl(value); }).catch(() => {});
    };
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(rows => {
      if (rows.some(row => row.isIntersecting)) { observer.disconnect(); load(); }
    }) : null;
    if (observer) observer.observe(element.current); else load();
    return () => { disposed = true; observer?.disconnect(); if (!getToken()) videoPosters.clear(); };
  }, [file.id, file.size, file.createdAt, file.mimetype]);
  return <span ref={element} className="photo-tile-video-placeholder" aria-hidden={decorative || undefined}>
    {url ? <img src={url} alt={decorative ? '' : `${file.name} video preview`} className="photo-tile-img" /> : <PlayGlyph size={28} />}
  </span>;
}
