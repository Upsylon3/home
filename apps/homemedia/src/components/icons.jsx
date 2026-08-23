// HOME_ARTISTIC_DIRECTION.md §11: icons should be simple, geometric,
// consistent, outlined. Hand-rolled as plain inline SVG rather than pulling
// in an icon library — Rule 4 (no speculative dependencies) applies to
// frontend packages too, and four small outlined glyphs don't justify one.
// Every icon shares the same stroke weight (1.6) and 20x20 viewBox so they
// sit consistently at any size.

const common = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};

export function HomeGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <path d="M3 9.5 10 3l7 6.5" />
      <path d="M5 8.5V16a1 1 0 0 0 1 1h3v-4.5h2V17h3a1 1 0 0 0 1-1V8.5" />
    </svg>
  );
}

export function GridGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <rect x="3" y="3" width="6" height="6" rx="1.2" />
      <rect x="11" y="3" width="6" height="6" rx="1.2" />
      <rect x="3" y="11" width="6" height="6" rx="1.2" />
      <rect x="11" y="11" width="6" height="6" rx="1.2" />
    </svg>
  );
}

export function GearGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 3.2v1.7M10 15.1v1.7M16.8 10h-1.7M4.9 10H3.2M14.8 5.2l-1.2 1.2M6.4 13.6l-1.2 1.2M14.8 14.8l-1.2-1.2M6.4 6.4 5.2 5.2" />
    </svg>
  );
}

export function BellGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <path d="M6 8a4 4 0 0 1 8 0c0 3.2 1 4.2 1 4.2H5S6 11.2 6 8Z" />
      <path d="M8.4 15a1.7 1.7 0 0 0 3.2 0" />
    </svg>
  );
}

export function SunGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <circle cx="10" cy="10" r="3.4" />
      <path d="M10 2.6v2M10 15.4v2M17.4 10h-2M4.6 10h-2M15.2 4.8l-1.4 1.4M6.2 13.8l-1.4 1.4M15.2 15.2l-1.4-1.4M6.2 6.2 4.8 4.8" />
    </svg>
  );
}

export function MoonGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <path d="M14.8 12.2A6 6 0 1 1 7.8 5.2a5 5 0 0 0 7 7Z" />
    </svg>
  );
}

// Represents "follow the system" — a half-lit dial rather than the sun or
// moon themselves, so it reads as its own third state at a glance instead
// of looking like a variant of one of the other two.
export function AutoGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <circle cx="10" cy="10" r="6.6" />
      <path d="M10 3.4v13.2" />
    </svg>
  );
}

export function ImageGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <rect x="2.5" y="4" width="15" height="12" rx="1.4" />
      <circle cx="7.2" cy="8.4" r="1.4" />
      <path d="M2.9 14.6 7.5 10l3 3 2.4-2.4 4.2 4.2" />
    </svg>
  );
}

export function StarGlyph(props) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={props.size || 18}
      height={props.size || 18}
      {...common}
      fill={props.filled ? "currentColor" : "none"}
    >
      <path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7 2.2-4.6Z" />
    </svg>
  );
}

export function PlayGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common} fill="currentColor">
      <path d="M6.5 4.5v11l9-5.5-9-5.5Z" stroke="none" />
    </svg>
  );
}

export function XGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <path d="M5 5l10 10M15 5 5 15" />
    </svg>
  );
}

export function ChevronLeftGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <path d="M12.5 4.5 7 10l5.5 5.5" />
    </svg>
  );
}

export function ChevronRightGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <path d="M7.5 4.5 13 10l-5.5 5.5" />
    </svg>
  );
}

export function InfoGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9.2v4.6M10 6.6v.1" />
    </svg>
  );
}

export function TrashGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <path d="M4.5 6h11M8 6V4.6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6m-7.5 0 .7 9.2a1.4 1.4 0 0 0 1.4 1.3h5.8a1.4 1.4 0 0 0 1.4-1.3L15.5 6" />
    </svg>
  );
}
