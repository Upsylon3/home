// retro.js — the "retro intensity" setting: Off, Subtle or Full.
//
// WHAT IT DOES
// Picks how strongly the Atari styling shows. It is separate from the
// light/dark theme: you can have dark + Full, light + Off, any mix.
//   off     the new warm colors and fonts only. No stripes, no woodgrain,
//           no raised-key buttons. Calm, modern, minimal.
//   subtle  the default. Stripes, woodgrain hero, raised keys.
//   full    everything louder: taller stripes, deeper keys, and CRT
//           scanlines + a darkened-edge effect on the dashboard hero.
//
// HOW IT WORKS (the same pattern as theme.js)
// 1. The choice is saved in localStorage under ONE shared key. Because
//    every app is served from the same address behind the gateway, a
//    choice made in one app carries over to all of them.
// 2. It is applied by writing data-retro="off|subtle|full" on the <html>
//    element. CSS then reacts with selectors like
//        :root[data-retro="off"] .stripe-band { display: none; }
// 3. index.html also has a tiny inline script that sets the attribute
//    BEFORE the first paint, so the page never flashes the wrong level.
//
// !! This file is a copy. Edit design/retro.js, then ./design/sync-assets.sh

const STORAGE_KEY = "home-retro";

// The three levels, in the order they appear in the settings control.
// `hint` is the one-line explanation shown under the control.
export const RETRO_LEVELS = [
  { value: "off", label: "Off", hint: "Warm colors only. No stripes, woodgrain or raised buttons." },
  { value: "subtle", label: "Subtle", hint: "Stripes, a woodgrain header and raised buttons. The default." },
  { value: "full", label: "Full", hint: "Louder stripes and deeper buttons, plus CRT scanlines on the dashboard header." },
];

// Read the saved level. Anything unexpected (nothing saved, an old or
// edited value, storage blocked in private browsing) falls back to "subtle".
export function getRetro() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "off" || value === "full" ? value : "subtle";
  } catch {
    return "subtle";
  }
}

// Put the level on <html> so the CSS can see it.
export function applyRetro(level) {
  document.documentElement.setAttribute("data-retro", level);
}

// Save AND apply. "subtle" is the default, so we remove the saved value
// instead of storing it: a clean storage means "never changed".
export function setRetro(level) {
  try {
    if (level === "subtle") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // Ignore: it still applies for this visit even if it can't be saved.
  }
  applyRetro(level);
  return level;
}
