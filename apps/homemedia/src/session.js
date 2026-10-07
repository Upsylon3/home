// The ONE place every Home frontend reads and writes the signed-in
// person's login token. Source of truth is design/session.js; each app
// gets a copy at src/session.js from design/sync-assets.sh — edit it
// here, never in an app (the next sync would overwrite it).
//
// Why this exists: the gateway puts every app on one browser origin
// (http://host:8080/...), and browsers share localStorage per origin — so
// sharing a login only needed every app to use the SAME key. They didn't:
// each kept its own (home_token, homecloud_token, homemedia_token, ...),
// so each app asked you to sign in again even though they all talk to the
// same HomeCore. One shared key is the whole fix; no new mechanism needed.
//
// Security note: this changes nothing about the threat model. Any script
// running on the shared origin could already read every app's token
// whatever the key was called (see docs/SECURITY.md, "Shared-origin XSS").

const SHARED_KEY = "home_session_token";

// The per-app keys used before this file existed. Read once for migration
// and removed on sign-out, so nobody is thrown back to a login screen by
// the upgrade, and an old token can't linger after signing out.
const LEGACY_KEYS = ["home_token", "homecloud_token", "homemedia_token", "homenotes_token", "homevault_token"];

function clearLegacy() {
  for (const key of LEGACY_KEYS) localStorage.removeItem(key);
}

export function getToken() {
  try {
    const shared = localStorage.getItem(SHARED_KEY);
    if (shared) return shared;

    // First run after the upgrade: adopt whichever old per-app token
    // exists, then delete all the old ones so there is only one copy.
    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy) {
        localStorage.setItem(SHARED_KEY, legacy);
        clearLegacy();
        return legacy;
      }
    }
  } catch {
    // Storage blocked (some private-browsing modes): behave as signed out.
  }
  return null;
}

// Pass null to sign out. Signing out here signs out of every app, which is
// what "one login" means.
export function setToken(token) {
  try {
    if (token) localStorage.setItem(SHARED_KEY, token);
    else localStorage.removeItem(SHARED_KEY);
    clearLegacy();
  } catch {
    // Storage blocked: nothing we can persist.
  }
}
