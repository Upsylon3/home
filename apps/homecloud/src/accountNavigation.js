// The demo supplies its hash-router URL at build time. Never transfer tokens in URLs.
export const homeAccountUrl = import.meta.env.VITE_HOME_ACCOUNT_URL ||
  (import.meta.env.DEV ? 'http://localhost:5174/settings' : '/settings');
