import { useEffect, useState } from "react";
import { getStoredPreference, setPreference } from "../theme.js";
import { SunGlyph, MoonGlyph, AutoGlyph } from "./icons.jsx";

// See ../../home/src/components/ThemeToggle.jsx and
// ../../frontend/src/components/ThemeToggle.jsx — identical behavior,
// kept as a separate copy since these apps don't share a component
// library (see README's monorepo notes on this being deferred, not
// forgotten). This copy reuses Home's SVG icon set as-is.
const ICON_COMPONENTS = { light: SunGlyph, dark: MoonGlyph, system: AutoGlyph };
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

  const Icon = ICON_COMPONENTS[preference];

  return (
    <button
      type="button"
      className={className}
      onClick={() => setPreferenceState(NEXT[preference])}
      aria-label={`Theme: ${LABELS[preference]}. Click to change.`}
      title={`Theme: ${LABELS[preference]} (click to change)`}
    >
      <Icon size={iconOnly ? 17 : 15} />
      {!iconOnly && <> {LABELS[preference]}</>}
    </button>
  );
}
