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

export function PlusGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <path d="M10 4.5v11M4.5 10h11" />
    </svg>
  );
}

export function SearchGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <circle cx="8.7" cy="8.7" r="5" />
      <path d="M15.5 15.5 12.4 12.4" />
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

export function FolderGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h3.6l1.4 1.8h6A1.5 1.5 0 0 1 17 7.3v7.2A1.5 1.5 0 0 1 15.5 16h-11A1.5 1.5 0 0 1 3 14.5Z" />
    </svg>
  );
}

// A checkbox with a list beside it: the "all tasks" mark.
export function TaskGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <rect x="3" y="4" width="5" height="5" rx="1" />
      <path d="m4.2 6.6 1.1 1.1 1.7-2" />
      <path d="M11 6.5h6M11 13.5h6" />
      <rect x="3" y="11" width="5" height="5" rx="1" />
    </svg>
  );
}

// A calendar page with a "today" square.
export function CalendarGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <rect x="3" y="4.5" width="14" height="12.5" rx="1.5" />
      <path d="M3 8.5h14M7 3v3M13 3v3" />
      <rect x="6.5" y="11" width="3" height="3" rx="0.5" />
    </svg>
  );
}

// A plain tick: the "done" mark.
export function CheckGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <path d="m4.5 10.5 3.5 3.5 7.5-8" />
    </svg>
  );
}

// A calendar with a forward arrow: the "upcoming" mark.
export function UpcomingGlyph(props) {
  return (
    <svg viewBox="0 0 20 20" width={props.size || 18} height={props.size || 18} {...common}>
      <rect x="3" y="4.5" width="14" height="12.5" rx="1.5" />
      <path d="M3 8.5h14M7 3v3M13 3v3" />
      <path d="M7.5 13h5m-2-2 2 2-2 2" />
    </svg>
  );
}
