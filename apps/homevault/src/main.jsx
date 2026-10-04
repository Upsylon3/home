import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "@fontsource/fredoka/latin-500.css";
import "@fontsource/fredoka/latin-600.css";
// Fonts are bundled from npm packages (@fontsource) instead of loaded from
// Google's servers: Home must work with no internet, and this way the
// person's browser never phones a third party just to draw a page.
// tokens.css is a COPY of design/tokens.css (see design/sync-assets.sh).
// It must be imported BEFORE index.css so the variables exist by the time
// index.css uses them.
import "./styles/tokens.css";
import "./styles/index.css";
// Shared buttons/cards/checkboxes (copy of design/components.css). Imported
// AFTER index.css on purpose: on a tie, the shared rule wins.
import "./styles/components.css";

// This app is served under the /vault/ path prefix (see gateway/nginx.conf
// and this app's own vite.config.js `base: "/vault/"`), not at the domain
// root. `basename` tells React Router to treat "/vault" as the app's own
// root — see apps/homenotes/src/main.jsx's identical comment for the
// full explanation of why this matters.
//
// base is only the gateway's /vault/ prefix in production — in dev this
// app's own Vite server IS the origin, so base stays "/" there.
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
