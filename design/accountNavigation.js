// Canonical HOME account destination; copied by design/sync-assets.sh.
// The static demo supplies its hash-router URL at build time. Never add tokens.
export const homeAccountUrl = import.meta.env.VITE_HOME_ACCOUNT_URL ||
  (import.meta.env.DEV ? 'http://localhost:5174/settings' : '/settings');
