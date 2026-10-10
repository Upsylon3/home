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

export function AutoGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <circle cx="10" cy="10" r="6.6" />
      <path d="M10 3.4v13.2" />
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

// A heartbeat line: the HomeMonitor mark in the Login screen and nav.
export function PulseGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <path d="M2.5 10.5h3.5l2-5 3 10 2-5h4.5" />
    </svg>
  );
}

// Four tiles: the "overview" mark.
export function OverviewGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </svg>
  );
}
