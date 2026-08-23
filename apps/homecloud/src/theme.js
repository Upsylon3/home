// Theme preference: 'light' | 'dark' | 'system'. Stored as the literal
// string a person picked, so if their OS preference changes later while
// they're set to "system", the app follows it — only an explicit choice
// of light or dark overrides that.
//
// The actual first application of this (so there's no flash of the wrong
// theme before React even mounts) happens in an inline script in
// index.html — this module is what everything *after* that first paint
// uses to read/change it. See index.html for why that part isn't here.
const STORAGE_KEY = "homecloud-theme";

export function getStoredPreference() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    // Private browsing / storage disabled — fall back silently rather
    // than breaking the app over a cosmetic preference.
    return "system";
  }
}

export function getSystemTheme() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function resolveTheme(preference) {
  return preference === "system" ? getSystemTheme() : preference;
}

export function applyTheme(preference) {
  const resolved = resolveTheme(preference);
  document.documentElement.setAttribute("data-theme", resolved);
  return resolved;
}

export function setPreference(preference) {
  try {
    if (preference === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, preference);
    }
  } catch {
    // Ignore — the theme still applies for this session even if it can't persist.
  }
  return applyTheme(preference);
}
