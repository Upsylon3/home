// Mirrors apps/homecloud/src/theme.js exactly, including the storage key
// — deliberately the same key rather than an app-specific one, so a
// person's light/dark choice carries over for free between every app
// behind the gateway (see docs/ARCHITECTURE.md), instead of needing to
// be set separately in each one.
const STORAGE_KEY = "homecloud-theme";

export function getStoredPreference() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
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
