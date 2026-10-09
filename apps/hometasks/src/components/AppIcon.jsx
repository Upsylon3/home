// AppIcon.jsx
//
// Renders one of the Home ecosystem's app icons INLINE (not via <img src>),
// so `currentColor` actually follows the surrounding theme and hover state.
// An <img src="/icons/homecloud.svg"> can't be recolored by CSS — the
// browser treats an <img>'s source as an opaque external resource, so
// `color: ...` on a parent element has no effect on what's inside it. The
// only way to get a themeable icon is to put its actual <svg>/<path> markup
// directly in the page's DOM, which is all this component does.
//
// The plain files under design/icons/*.svg (synced to each frontend's
// public/icons/ by design/sync-assets.sh) are still useful — browser
// favicons, the PWA manifest, anywhere outside a themed React tree — they
// just can't be *this* component's rendering path.
//
// See docs/DESIGN_SYSTEM.md's "Icon system" section for the design spec
// this implements: one shared rounded-square "doorway" frame, reused by
// every app with its own glyph inside.
//
// Usage:
//   import AppIcon from "./AppIcon.jsx";
//   <AppIcon name="homecloud" size={20} />
//
// `name` matches an app's `slug` in HomeCore's application registry (see
// homecore/src/homecore/seed.js) — pass a.slug straight from whatever the
// app-list API returns and it just works.

// The shared frame every icon traces first: a rounded square with a small
// notch cut into the bottom-center edge (the "doorway"). Keeping this as
// one constant, rather than repeating the path string per icon, is what
// guarantees every app's icon shares the exact same silhouette.
const FRAME_PATH =
  "M15,6 L33,6 A9,9 0 0 1 42,15 L42,33 A9,9 0 0 1 33,42 " +
  "L30,42 L30,34 A2,2 0 0 0 28,32 L20,32 A2,2 0 0 0 18,34 " +
  "L18,42 L15,42 A9,9 0 0 1 6,33 L6,15 A9,9 0 0 1 15,6 Z";

// Each app's glyph — the shape drawn INSIDE the frame above. `null` for
// "home" itself, since Home's icon is the undecorated frame with nothing
// inside it (see DESIGN_SYSTEM.md: "the undecorated Home mark on its
// own"). Keys here are the exact `slug` values HomeCore's registry uses.
const GLYPHS = {
  home: null,

  // Cloud outline — three rounded bumps sitting on a flat base.
  homecloud: (
    <path d="M17,27 a4,4 0 0 1 0.6,-7.96 A5.5,5.5 0 0 1 28,17.2 a4.5,4.5 0 0 1 6.6,4.3 A3.6,3.6 0 0 1 34,27 Z" />
  ),

  // Lens ring + iris hexagon — a camera lens viewed head-on.
  homemedia: (
    <>
      <circle cx="24" cy="21" r="8.2" />
      <path d="M24,15.2 29,18.1 29,23.9 24,26.8 19,23.9 19,18.1 Z" />
    </>
  ),

  // A page with its top-right corner folded down, plus two lines of text.
  homenotes: (
    <>
      <path d="M16,14 H28 L32,18 V29 H16 Z" />
      <path d="M28,14 V18 H32" />
      <path d="M19.5,22 H28.5 M19.5,25.5 H26" />
    </>
  ),

  // A checked checkbox beside two list lines.
  hometasks: (
    <>
      <rect x="15.5" y="16" width="9" height="9" rx="2" />
      <path d="M17.5,20.5 19.5,22.5 22.5,18.5" />
      <path d="M28,17.5 H33 M28,20.5 H33 M28,23.5 H31" />
    </>
  ),

  // Two opposing curved arrows — a refresh/sync circle.
  homesync: (
    <>
      <path d="M18,17.5 A7.5,7.5 0 0 1 31,21" />
      <path d="M31,15.5 V21 H25.5" />
      <path d="M30,26.5 A7.5,7.5 0 0 1 17,23" />
      <path d="M17,28.5 V23 H22.5" />
    </>
  ),

  // A heartbeat / pulse line.
  homemonitor: <path d="M15.5,22 H19 L21,17 24,27 26.5,20 28,22 H32.5" />,

  // A padlock — shackle arc, body, keyhole.
  homevault: (
    <>
      <path d="M19,20 V17.5 a5,5 0 0 1 10,0 V20" />
      <rect x="16.5" y="20" width="15" height="10.5" rx="2.2" />
      <circle cx="24" cy="24.5" r="1.4" fill="currentColor" stroke="none" />
      <path d="M24,25.9 V27.8" />
    </>
  ),

  // Four connected nodes — a small network, deliberately NOT a
  // sparkle/star (see DESIGN_SYSTEM.md's note on avoiding that cliche).
  homeai: (
    <>
      <path d="M18,18 30,18 M18,18 24,28 M30,18 24,28 M18,18 30,28" />
      <circle cx="18" cy="18" r="2" fill="currentColor" stroke="none" />
      <circle cx="30" cy="18" r="2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="28" r="2" fill="currentColor" stroke="none" />
      <circle cx="30" cy="28" r="2" fill="currentColor" stroke="none" />
    </>
  ),
};

export default function AppIcon({ name, size = 20, className }) {
  const glyph = GLYPHS[name];
  // An app slug we don't have a glyph for yet (a future app, or a typo)
  // still renders the plain frame rather than nothing — matches
  // ARCHITECTURE.md's "graceful degradation" principle: showing something
  // consistent beats a blank gap or a crash.
  const showGlyph = name !== "home" && glyph;

  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={className} aria-hidden="true">
      <path
        d={FRAME_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showGlyph && (
        <g fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          {glyph}
        </g>
      )}
    </svg>
  );
}
