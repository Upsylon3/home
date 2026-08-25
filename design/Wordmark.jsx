// Wordmark.jsx
//
// The Home icon+text lockup, inline (same currentColor reasoning as
// AppIcon.jsx — see that file's header comment). Mirrors
// design/icons/wordmark.svg exactly; if you change one, change both.
//
// Usage: <Wordmark height={16} />

const FRAME_PATH =
  "M15,6 L33,6 A9,9 0 0 1 42,15 L42,33 A9,9 0 0 1 33,42 " +
  "L30,42 L30,34 A2,2 0 0 0 28,32 L20,32 A2,2 0 0 0 18,34 " +
  "L18,42 L15,42 A9,9 0 0 1 6,33 L6,15 A9,9 0 0 1 15,6 Z";

export default function Wordmark({ height = 24, className }) {
  // The source viewBox is 168x48 (3.5:1) — scale width to match whatever
  // height is requested so callers only need to think about one number.
  const width = Math.round(height * (168 / 48));

  return (
    <svg viewBox="0 0 168 48" width={width} height={height} className={className} aria-hidden="true">
      <path
        d={FRAME_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x="56"
        y="32"
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif"
        fontSize="27"
        fontWeight="600"
        letterSpacing="-0.3"
        fill="currentColor"
      >
        Home
      </text>
    </svg>
  );
}
