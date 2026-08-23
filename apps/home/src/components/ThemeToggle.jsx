import { useEffect, useState } from "react";
import { getStoredPreference, setPreference } from "../theme.js";
import { SunGlyph, MoonGlyph, AutoGlyph } from "./icons.jsx";

// See ../../frontend/src/components/ThemeToggle.jsx — identical behavior,
// kept as a separate copy since the two frontends don't share a component
// library (see README's monorepo notes on this being deferred, not
// forgotten). This copy uses Home's SVG icon set instead of frontend's
// plain-text style, matching how each app already presents itself.
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
