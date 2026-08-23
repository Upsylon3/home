import { useEffect, useState } from "react";
import { fetchImageBlob } from "../api.js";

// Plain <img src> can't carry an Authorization header (see api.js's
// fetchImageBlob for why token-in-URL isn't used instead), so every
// thumbnail/full-image view in HomeMedia goes through this instead of a
// bare <img>. Revokes its object URL on unmount/src-change so a long
// gallery session doesn't leak memory one photo at a time.
export default function AuthImage({ src, alt = "", className, style, onLoad, onError, placeholder = null }) {
  const [objectUrl, setObjectUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let currentUrl = null;
    setFailed(false);
    setObjectUrl(null);

    fetchImageBlob(src)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        currentUrl = url;
        setObjectUrl(url);
        onLoad?.();
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          onError?.();
        }
      });

    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [src]);

  if (failed || !objectUrl) return placeholder;
  return <img src={objectUrl} alt={alt} className={className} style={style} />;
}
