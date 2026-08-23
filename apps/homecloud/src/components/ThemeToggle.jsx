import { useEffect, useState } from "react";
import { getStoredPreference, setPreference } from "../theme.js";

// Cycles system → light → dark → system on click, showing the icon for
// whatever's *currently active* (not the state it'll switch to next) so
// someone glancing at it can tell which theme they're actually looking
// at right now. "System" gets its own icon rather than silently looking
// like whichever theme the OS happens to resolve to, since otherwise
// there'd be no way to tell "following the OS" apart from "explicitly
// picked" at a glance.
const ICONS = { light: "☀", dark: "☾", system: "◐" };
const LABELS = { light: "Light", dark: "Dark", system: "Auto" };
const NEXT = { system: "light", light: "dark", dark: "system" };

export default function ThemeToggle({ className = "btn btn-ghost", iconOnly = false }) {
  const [preference, setPreferenceState] = useState(getStoredPreference);

  useEffect(() => {
    setPreference(preference);
  }, [preference]);

  // If we're following the system and the OS theme changes mid-session
  // (e.g. sunset kicks in), re-apply so the app follows along live.
  useEffect(() => {
    if (preference !== "system" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setPreference("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  return (
    <button
      type="button"
      className={className}
      onClick={() => setPreferenceState(NEXT[preference])}
      aria-label={`Theme: ${LABELS[preference]}. Click to change.`}
      title={`Theme: ${LABELS[preference]} (click to change)`}
    >
      <span aria-hidden="true">{ICONS[preference]}</span>
      {!iconOnly && <> {LABELS[preference]}</>}
    </button>
  );
}
