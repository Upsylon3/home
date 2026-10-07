// Decides whether a HomeCloud file counts as a photo, a video or a piece of
// music — the three things HomeMedia shows. Kept in its own tiny module
// (instead of inside library.js, where it started life as a two-line
// function) because three different places now need the same answer: the
// library listing, the thumbnail route and the upload folder logic.
//
// Why we look at the filename as well as the mimetype:
// HomeCloud stores whatever mimetype the browser reported at upload time,
// and browsers report an EMPTY mimetype for formats they don't recognise
// (very common on Windows for .mkv, .flac, .m4a, .opus). HomeCloud then
// saves those as "application/octet-stream". Judging by mimetype alone
// meant such files silently never appeared in the library, with no error
// anywhere — the file was there, HomeMedia just couldn't tell what it was.
// The extension is a fallback, never an override: a real "image/..."
// mimetype always wins.

const EXTENSION_KINDS = {
  // photos (gif is deliberately here: it is an image, and the viewer shows
  // the original file so it keeps animating — see Lightbox.jsx)
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image",
  avif: "image", bmp: "image", tif: "image", tiff: "image", heic: "image",
  // video
  mp4: "video", m4v: "video", mov: "video", webm: "video", mkv: "video",
  avi: "video", ogv: "video",
  // music
  mp3: "audio", m4a: "audio", aac: "audio", flac: "audio", wav: "audio",
  ogg: "audio", oga: "audio", opus: "audio"
};

const KINDS = ["image", "video", "audio"];

function extensionOf(name) {
  const dot = String(name || "").lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

// Returns "image" | "video" | "audio", or null if this isn't media at all.
function kindOfFile({ mimetype, name }) {
  const top = String(mimetype || "").split("/")[0];
  if (KINDS.includes(top)) return top;
  return EXTENSION_KINDS[extensionOf(name)] || null;
}

module.exports = { KINDS, kindOfFile };
