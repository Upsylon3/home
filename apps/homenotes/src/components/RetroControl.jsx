import { useRef, useState } from "react";
import { RETRO_LEVELS, getRetro, setRetro } from "../retro.js";

// RetroControl.jsx — a three-choice selector (Off / Subtle / Full).
//
// !! This file is a copy. Edit design/RetroControl.jsx, then run
// !! ./design/sync-assets.sh
//
// ACCESSIBILITY, because a custom control has to rebuild what a native one
// gives for free. This is a "radio group": exactly one choice is selected.
//   role="radiogroup" / role="radio" / aria-checked  tell screen readers so.
//   Tab moves INTO the group once (only the selected choice is tabbable,
//   this is called a "roving tabindex"), and the arrow keys move between
//   choices, exactly like real radio buttons.
// The look lives in .segmented (design/components.css).
export default function RetroControl() {
  const [level, setLevel] = useState(getRetro);
  const buttons = useRef([]); // refs so we can move keyboard focus

  function choose(value) {
    setRetro(value); // saves it AND applies it to the page right away
    setLevel(value);
  }

  function handleKeyDown(event, index) {
    // Right/Down = next choice, Left/Up = previous. The "+ length ... %
    // length" wraps around at the ends (after Full comes Off again).
    let delta = 0;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") delta = 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") delta = -1;
    if (delta === 0) return;

    event.preventDefault(); // stop the arrow key scrolling the page
    const next = (index + delta + RETRO_LEVELS.length) % RETRO_LEVELS.length;
    choose(RETRO_LEVELS[next].value);
    buttons.current[next]?.focus();
  }

  const current = RETRO_LEVELS.find((l) => l.value === level);

  return (
    <div>
      <div className="segmented" role="radiogroup" aria-label="Retro intensity">
        {RETRO_LEVELS.map((l, i) => (
          <button
            key={l.value}
            ref={(el) => (buttons.current[i] = el)}
            type="button"
            role="radio"
            aria-checked={level === l.value}
            tabIndex={level === l.value ? 0 : -1}
            className="segmented-option"
            onClick={() => choose(l.value)}
            onKeyDown={(e) => handleKeyDown(e, i)}
          >
            {l.label}
          </button>
        ))}
      </div>
      <p className="segmented-hint">{current.hint}</p>
    </div>
  );
}
