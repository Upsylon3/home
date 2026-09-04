import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles/index.css";

// This app is served under the /cloud/ path prefix (see gateway/nginx.conf
// and this app's own vite.config.js `base: "/cloud/"`), not at the domain
// root. `basename` tells React Router to treat "/cloud" as the app's own
// root, so a route defined as path="/settings" correctly matches the
// browser URL "/cloud/settings" instead of matching nothing and falling
// through to the catch-all redirect. Without this, refreshing the page,
// opening a bookmark, or following a direct link to anything other than
// exactly "/cloud/" bounces the user out to Home — the routes never see
// the "/cloud" part of the URL and never match.
//
// `import.meta.env.BASE_URL` is set by Vite from that same `base` config
// value, so the two can never drift out of sync with each other.
const basename = import.meta.env.BASE_URL;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// Only register the service worker in the production build. In dev mode
// (npm run dev) Vite's own hot-reloading already handles this, and a
// caching service worker would just get in the way of seeing live edits.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    // Must be registered at a path under "/cloud/", not the hardcoded
    // root "/sw.js" — a root-absolute request for "/sw.js" would be
    // routed by the gateway to whatever serves "/" (Home), never
    // reaching this app's own service worker file at all. `BASE_URL`
    // already ends in a trailing slash ("/cloud/"), so this resolves to
    // exactly "/cloud/sw.js", which nginx.conf's `location = /sw.js`
    // rule serves once the gateway strips the "/cloud/" prefix.
    navigator.serviceWorker.register(`${basename}sw.js`).catch(() => {
      // Non-fatal: the app still works fully without the service worker,
      // it just won't be installable as a PWA.
    });
  });
}
